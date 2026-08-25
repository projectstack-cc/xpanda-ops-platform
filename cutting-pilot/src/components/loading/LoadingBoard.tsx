"use client";
// src/components/loading/LoadingBoard.tsx
// Floor/office TV board: every active loading bay visible at once, no scroll, no rotation.
// Polls GET /v2/api/loading-board every 30s and swaps data in place; on fetch error it keeps
// the last-good render and shows a subtle indicator instead of ever blanking the wall.
//
// Self-contained TV hardening (mirrors /v2/schedule's technique, deliberately NOT imported from
// components/schedule/ — see BACKLOG.md follow-up to extract a shared components/tv/ later):
// a FreshnessClock, local to this file. Pixel-shift removed in P304 (motion discomfort) on both
// TV boards; logo sweep removed in P306 (same motion-discomfort complaint — it was the only
// motion left after P304). TV-safe edge inset (hardware-overscan accommodation, not a bug fix)
// added in P306 via the shared `--tv-safe-inset` token in globals.css.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import BayTile from "./BayTile";

const POLL_MS = 30_000;
// Independent of POLL_MS — only recomputes the relative age shown in FreshnessClock.
const CLOCK_TICK_MS = 15_000;
// A handful of missed 30s polls before the clock goes amber.
const STALE_AGE_THRESHOLD_MS = 2 * 60 * 1000;

export interface LoadingBoardLoad {
  customer: string | null;
  invoice_number: string | null;
  trailer_number: string | null;
  loading_status: string;
  load_number: number;
  load_count: number | null;
}

export interface LoadingBoardBay {
  bay_id: string;
  bay_number: number;
  label: string;
  loads: LoadingBoardLoad[];
}

interface LoadingBoardResponse {
  generated_at: string;
  board_note?: string;
  bays: LoadingBoardBay[];
}

// Mirrors the server-side cap in src/app/api/loading-board/route.ts.
const NOTES_MAX_LEN = 2000;

interface LoadingBoardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

// Fewer bays get bigger tiles; more bays shrink the minmax floor so auto-fit keeps them on one
// screen instead of wrapping to extra rows. Tuned for the realistic seeded range (11 bays).
function minTileWidthPx(bayCount: number): number {
  if (bayCount <= 6) return 300;
  if (bayCount <= 12) return 220;
  if (bayCount <= 20) return 170;
  return 140;
}

function formatAbsolute(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelative(ageMs: number): string {
  const mins = Math.max(0, Math.floor(ageMs / 60_000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

const AMBER_CLS =
  "px-1.5 py-[1px] rounded bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]";

function FreshnessClock({
  lastSuccessAt,
  fetchStale,
}: {
  lastSuccessAt: Date | null;
  fetchStale: boolean;
}) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const base = "inline-flex items-center gap-1 font-mono tabular-nums text-[10px] leading-tight";

  if (!lastSuccessAt) {
    return (
      <span className={`${base} ${AMBER_CLS}`}>
        <Clock size={11} aria-hidden="true" />
        no data
      </span>
    );
  }

  const ageMs = Date.now() - lastSuccessAt.getTime();
  const stale = fetchStale || ageMs > STALE_AGE_THRESHOLD_MS;

  return (
    <span
      className={[base, stale ? AMBER_CLS : "text-text-faint"].join(" ")}
      title={`Board last updated ${lastSuccessAt.toLocaleString()}`}
    >
      <Clock size={11} aria-hidden="true" />
      {formatRelative(ageMs)} · {formatAbsolute(lastSuccessAt)}
    </span>
  );
}

export default function LoadingBoard({ userName, isAdmin, permissions }: LoadingBoardProps) {
  const [data, setData] = useState<LoadingBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);
  const hasGoodDataRef = useRef(false);

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/loading-board");

      // 503 = the auth layer's D1 lookup blipped — transient, not a session verdict.
      // Never treat it as logged-out; just retry on the next tick.
      if (res.status === 503) {
        if (hasGoodDataRef.current) setStale(true);
        else setError("Reconnecting…");
        return;
      }

      // 401 from a background poll could be a genuinely dead session, or a stray one-off.
      // Confirm against the auth endpoint before showing anything scarier than "stale."
      if (res.status === 401) {
        let confirmedGone = true;
        try {
          const confirmRes = await fetch("/api/auth/me");
          confirmedGone = !confirmRes.ok;
        } catch {
          confirmedGone = false;
        }
        if (!confirmedGone) {
          if (hasGoodDataRef.current) setStale(true);
          else setError("Reconnecting…");
          return;
        }
        setError("Signed out — sign back in to resume.");
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: LoadingBoardResponse = await res.json();
      hasGoodDataRef.current = true;
      setData(json);
      setStale(false);
      setError(null);
      setLastSuccessAt(new Date());
    } catch {
      if (hasGoodDataRef.current) {
        setStale(true);
      } else {
        setError("Couldn't load the loading board.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard();
    const id = setInterval(fetchBoard, POLL_MS);
    return () => clearInterval(id);
  }, [fetchBoard]);

  const canEditNotes = isAdmin || permissions?.["logistics.loading.tv"]?.edit === true;
  const [noteDraft, setNoteDraft] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [noteFocused, setNoteFocused] = useState(false);

  // Only adopt the polled note when the field isn't being actively edited — never clobber an
  // in-progress edit out from under the person typing it.
  useEffect(() => {
    if (noteFocused || noteDirty) return;
    setNoteDraft(data?.board_note ?? "");
  }, [data?.board_note, noteFocused, noteDirty]);

  const handleSaveNote = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/loading-board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: noteDraft }),
      });
      if (res.ok) {
        setNoteDirty(false);
        fetchBoard();
      }
    } catch {
      // Leave dirty — the Save button stays enabled so the user can retry.
    }
  }, [noteDraft, fetchBoard]);

  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-bg overflow-hidden">
        <PlatformHeader
          userName={userName}
          isAdmin={isAdmin}
          permissions={permissions}
          title="Loading · v2"
          currentPath="/v2/loading"
          autoHide
        />
        <div className="flex-1 min-h-0 grid grid-cols-4 gap-2 p-2">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div
              key={i}
              className="bg-[var(--surface)] rounded-lg animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="h-screen flex flex-col bg-bg overflow-hidden">
        <PlatformHeader
          userName={userName}
          isAdmin={isAdmin}
          permissions={permissions}
          title="Loading · v2"
          currentPath="/v2/loading"
          autoHide
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <AlertTriangle size={28} className="text-[var(--warn-text)]" aria-hidden="true" />
          <p className="text-sm text-muted max-w-sm">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchBoard();
            }}
            className="cursor-pointer inline-flex items-center px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium bg-[var(--primary-bg)] text-[var(--primary-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="Loading · v2"
        currentPath="/v2/loading"
        autoHide
      />

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {/* TV-safe inset (not a bug fix): consumer TV/HDMI overscan crops the outer edge of the
            picture on many displays, independent of anything this app renders — confirmed by
            P306 measuring this container pixel-exact against the browser viewport with zero
            clipping. `--tv-safe-inset` (globals.css) pulls the content in from the true edge so
            any hardware crop eats background color, not bay data. Do not "simplify" this back
            to inset-0 thinking it's leftover pixel-shift cruft. */}
        <div className="absolute flex flex-col" style={{ inset: "var(--tv-safe-inset)" }}>
          <div className="shrink-0 flex items-center justify-between px-3 py-0.5 border-b border-[var(--line)] bg-bg">
            <h1 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Loading Dashboard
            </h1>
            <div className="flex items-center gap-2">
              {stale && (
                <span className="font-mono text-[10px] text-[var(--warn-text)]">
                  showing last loaded data
                </span>
              )}
              <FreshnessClock lastSuccessAt={lastSuccessAt} fetchStale={stale} />
            </div>
          </div>

          <div
            className="flex-1 min-h-0 grid gap-2 p-2 overflow-hidden"
            style={{
              gridTemplateColumns: `repeat(auto-fit, minmax(${minTileWidthPx(data.bays.length)}px, 1fr))`,
              gridAutoRows: "1fr",
            }}
          >
            {data.bays.length === 0 ? (
              <div className="col-span-full flex items-center justify-center text-sm text-text-faint italic">
                No active bays.
              </div>
            ) : (
              data.bays.map((bay) => <BayTile key={bay.bay_id} bay={bay} />)
            )}
          </div>

          {(canEditNotes || !!data.board_note?.trim()) && (
            <div className="shrink-0 px-3 py-1 border-t border-[var(--line)] bg-[var(--surface-2)]">
              {canEditNotes ? (
                <div className="flex items-start gap-2">
                  <textarea
                    value={noteDraft}
                    onFocus={() => setNoteFocused(true)}
                    onChange={(e) => {
                      setNoteDraft(e.target.value);
                      setNoteDirty(true);
                    }}
                    onBlur={() => {
                      setNoteFocused(false);
                      if (noteDirty) handleSaveNote();
                    }}
                    rows={2}
                    maxLength={NOTES_MAX_LEN}
                    placeholder="Board note (visible to everyone viewing this board)…"
                    className="flex-1 resize-none rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-[clamp(0.75rem,1.3vh,0.95rem)] px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                  />
                  <button
                    type="button"
                    onClick={handleSaveNote}
                    disabled={!noteDirty}
                    className="shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold bg-[var(--primary-bg)] text-[var(--primary-text)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <p className="text-[clamp(0.8rem,1.5vh,1.05rem)] font-medium text-text whitespace-pre-wrap">
                  {data.board_note}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
