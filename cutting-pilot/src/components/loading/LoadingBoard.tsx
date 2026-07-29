"use client";
// src/components/loading/LoadingBoard.tsx
// Floor/office TV board: every active loading bay visible at once, no scroll, no rotation.
// Polls GET /v2/api/loading-board every 30s and swaps data in place; on fetch error it keeps
// the last-good render and shows a subtle indicator instead of ever blanking the wall.
//
// Self-contained TV hardening (mirrors /v2/schedule's technique, deliberately NOT imported from
// components/schedule/ — see BACKLOG.md follow-up to extract a shared components/tv/ later):
// a FreshnessClock and a periodic logo sweep, both local to this file. Keyframes live in the
// inline <style> tag below (no other file is touched). Pixel-shift removed in P304 (motion
// discomfort) on both TV boards — freshness clock + logo sweep are unaffected.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import BayTile from "./BayTile";

const POLL_MS = 30_000;
// Independent of POLL_MS — only recomputes the relative age shown in FreshnessClock.
const CLOCK_TICK_MS = 15_000;
// A handful of missed 30s polls before the clock goes amber.
const STALE_AGE_THRESHOLD_MS = 2 * 60 * 1000;
const LOGO_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const LOGO_SWEEP_DURATION_MS = 3_800;

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

function LogoSweep() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), LOGO_SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="hidden min-[1024px]:block fixed inset-0 z-30 overflow-hidden pointer-events-none motion-reduce:hidden"
    >
      <img
        key={tick}
        alt=""
        src="/logo/xpanda.png"
        className="xp-loading-sweep absolute top-1/2 h-[18vh] w-auto opacity-90 drop-shadow-lg"
        style={{ animationDuration: `${LOGO_SWEEP_DURATION_MS}ms` }}
      />
    </div>
  );
}

// Scoped keyframes for this board only — deliberately not shared with components/schedule/.
const TV_HARDENING_STYLE = `
  .xp-loading-sweep {
    animation-name: xp-loading-sweep-kf;
    animation-timing-function: ease-in-out;
    animation-fill-mode: forwards;
  }
  @keyframes xp-loading-sweep-kf {
    0% { transform: translate(-20vw, -50%); opacity: 0; }
    8% { opacity: 1; }
    92% { opacity: 1; }
    100% { transform: translate(120vw, -50%); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .xp-loading-sweep { animation: none !important; }
  }
`;

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

  const tvStyle = <style>{TV_HARDENING_STYLE}</style>;

  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-bg overflow-hidden">
        {tvStyle}
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
        {tvStyle}
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
      {tvStyle}
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="Loading · v2"
        currentPath="/v2/loading"
        autoHide
      />

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div className="absolute inset-0 flex flex-col">
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

      <LogoSweep />
    </div>
  );
}
