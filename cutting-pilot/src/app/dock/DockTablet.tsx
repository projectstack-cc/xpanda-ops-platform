"use client";
// src/app/dock/DockTablet.tsx
// dock-10: the Dock Tablet page (/v2/dock?bays=24,25) -- a full-screen, light-only, TV-styled
// view of one or two bays for the tablet mounted at them. Every mutation + modal is the dock
// board's own (useDockActions + DockModalHost); permissions are the same as DockBoard's.
// Fetch + refetch after every mutation, 15s poll (skipped while anything is open).
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Columns2 } from "lucide-react";
import Modal from "@/components/Modal";
import DockModalHost from "@/components/loading/DockModalHost";
import DockBayPanel from "@/components/loading/tablet/DockBayPanel";
import DockBayPicker from "@/components/loading/tablet/DockBayPicker";
import { DOCK_TABLET as P } from "@/components/loading/tablet/palette";
import { useDockActions } from "@/components/loading/useDockActions";
import type { DockAssignment, DockBay } from "@/components/loading/dockTypes";

// Same key as dock-08's in-board pair view, so tablets already set up keep their pair.
const LD_PAIR_BAYS_KEY = "ld_pair_bays_v1";
const POLL_MS = 15000;
const LIVE_WINDOW_MS = 2 * 60 * 1000;
const TRAILER_EDITABLE = ["not_started", "loading", "loaded"];

interface DockTabletProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

// Unique positive integers, at most 2, in chosen order.
function cleanPairList(list: unknown[]): number[] {
  return Array.from(new Set(list.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))).slice(0, 2);
}

export default function DockTablet({ isAdmin, permissions }: DockTabletProps) {
  const canManage = isAdmin || permissions?.["logistics.loading.manage"]?.edit === true;
  const canEditLoading = isAdmin || permissions?.["logistics.loading"]?.edit === true;
  const searchParams = useSearchParams();

  const [bays, setBays] = useState<DockBay[]>([]);
  const [assignments, setAssignments] = useState<DockAssignment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const hasGoodDataRef = useRef(false);

  const [pairBayNumbers, setPairBayNumbers] = useState<number[]>([]);
  const [pairResolved, setPairResolved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moreTarget, setMoreTarget] = useState<{ a: DockAssignment; rect: DOMRect } | null>(null);
  const [trailerTarget, setTrailerTarget] = useState<DockAssignment | null>(null);
  const [trailerDraft, setTrailerDraft] = useState("");
  // Clock: null until mount so SSR and the first client render agree.
  const [now, setNow] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const [baysRes, assignRes] = await Promise.all([
        fetch("/v2/api/loading-bays"),
        fetch("/v2/api/loading-assignments"),
      ]);
      // A 401 could be a stray one-off; confirm against the auth endpoint (LoadingBoard.tsx's rule)
      // before showing "Signed out".
      if (baysRes.status === 401 || assignRes.status === 401) {
        let confirmedGone = true;
        try {
          const me = await fetch("/api/auth/me");
          confirmedGone = !me.ok;
        } catch {
          confirmedGone = false;
        }
        if (confirmedGone) setSignedOut(true);
        else if (!hasGoodDataRef.current) setLoadError("Reconnecting…");
        return;
      }
      const [baysJson, assignJson] = await Promise.all([baysRes.json(), assignRes.json()]);
      if (!baysRes.ok || !assignRes.ok || !baysJson.ok || !assignJson.ok) {
        throw new Error(baysJson.error || assignJson.error || "load failed");
      }
      setBays(baysJson.bays ?? []);
      setAssignments(assignJson.assignments ?? []);
      hasGoodDataRef.current = true;
      setLoadError(null);
      setSignedOut(false);
      setLastSuccessAt(Date.now());
    } catch {
      // Keep showing the last good data; the Live dot goes amber on its own.
      if (!hasGoodDataRef.current) setLoadError("Couldn't load the dock. Retrying…");
    } finally {
      setLoaded(true);
    }
  }, []);

  const actions = useDockActions({ assignments, load, canManage, canEditLoading });
  const { cardHandlers, actionError } = actions;

  useEffect(() => {
    load();
  }, [load]);

  // Resolve the pair once on mount: ?bays= wins, else this device's localStorage, else picker.
  useEffect(() => {
    const fromUrl = searchParams.get("bays");
    if (fromUrl) {
      setPairBayNumbers(cleanPairList(fromUrl.split(",")));
    } else {
      try {
        const raw = localStorage.getItem(LD_PAIR_BAYS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed)) setPairBayNumbers(cleanPairList(parsed));
      } catch {
        // no stored pair -- the picker opens
      }
    }
    setPairResolved(true);
    // Mount-only: the URL is read once; later changes come from the picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clock + Live-indicator tick.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  const pairBays = pairBayNumbers
    .map((n) => bays.find((b) => b.bay_number === n && b.is_active))
    .filter((b): b is DockBay => !!b);
  const showPicker =
    !signedOut && (pickerOpen || (pairResolved && loaded && hasGoodDataRef.current && pairBays.length === 0));

  // 15s poll, skipped while the tab is hidden or anything is open. Read through a ref so the
  // interval is created once.
  const pollBlockedRef = useRef(false);
  useEffect(() => {
    pollBlockedRef.current =
      actions.anyModalOpen || showPicker || moreTarget !== null || trailerTarget !== null || signedOut;
  });
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden || pollBlockedRef.current) return;
      load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // More popover: close on Escape (outside taps hit the backdrop below).
  useEffect(() => {
    if (!moreTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreTarget(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreTarget]);

  function handleChoosePair(bayNumbers: number[]) {
    setPairBayNumbers(bayNumbers);
    setPickerOpen(false);
    try {
      localStorage.setItem(LD_PAIR_BAYS_KEY, JSON.stringify(bayNumbers));
    } catch {
      // best-effort persistence only
    }
    try {
      // Literal commas so a kiosk start URL / home-screen shortcut reads `bays=24,25`.
      window.history.replaceState(null, "", `/v2/dock?bays=${bayNumbers.join(",")}`);
    } catch {
      // best-effort URL update only
    }
  }

  function handleMore(a: DockAssignment, anchor: HTMLElement) {
    setMoreTarget({ a, rect: anchor.getBoundingClientRect() });
  }

  const title =
    pairBays.length === 2
      ? `Bays ${pairBays[0].bay_number} & ${pairBays[1].bay_number}`
      : pairBays.length === 1
        ? `Bay ${pairBays[0].bay_number}`
        : "No bays selected";
  const live = lastSuccessAt !== null && now !== null && now.getTime() - lastSuccessAt < LIVE_WINDOW_MS;
  const dateLabel = now ? `${now.toLocaleDateString("en-US", { weekday: "short" })} ${now.getMonth() + 1}/${now.getDate()}` : "";
  const clockLabel = now ? now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

  const moreItems: { label: string; onClick: () => void }[] = [];
  if (moreTarget) {
    const a = moreTarget.a;
    const onBay = !!a.bay_id && TRAILER_EDITABLE.includes(a.loading_status);
    if (onBay) {
      moreItems.push({
        label: "Edit trailer #",
        onClick: () => {
          setTrailerDraft(a.trailer_number ?? "");
          setTrailerTarget(a);
        },
      });
      moreItems.push({ label: "Move to yard", onClick: () => cardHandlers.onMoveToYard(a) });
      moreItems.push({ label: "Send back to queue", onClick: () => cardHandlers.onSendBackToQueue(a) });
    }
    if (a.loading_status === "loaded") {
      moreItems.push({ label: "Mark in transit", onClick: () => cardHandlers.onAdvance(a, "in_transit") });
    }
  }

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden" style={{ background: P.pageBg }}>
      <header
        className="shrink-0 flex items-center justify-between gap-4"
        style={{ height: 64, background: P.headerBg, color: P.headerInk, padding: "0 24px" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span aria-hidden="true" style={{ width: 10, height: 28, borderRadius: 3, background: P.brand }} />
          <span
            className="uppercase font-semibold whitespace-nowrap"
            style={{ fontSize: 15, letterSpacing: ".08em", color: P.headerMuted }}
          >
            xPanda Dock
          </span>
          <span className="font-bold truncate" style={{ fontSize: 22 }}>
            {title}
          </span>
        </div>
        <div className="flex items-center gap-5 shrink-0">
          <span className="font-mono" style={{ fontSize: 15, color: P.headerMuted }}>
            {dateLabel}
          </span>
          <span className="font-mono font-semibold tabular-nums" style={{ fontSize: 26 }}>
            {clockLabel}
          </span>
          <span className="flex items-center gap-2" style={{ fontSize: 13, color: P.headerMuted }}>
            <span
              aria-hidden="true"
              style={{ width: 8, height: 8, borderRadius: 9999, background: live ? P.liveDot : P.reconnectDot }}
            />
            {live ? "Live" : "Reconnecting…"}
          </span>
          {!signedOut && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="grid items-center gap-2 font-semibold cursor-pointer"
              style={{
                gridTemplateColumns: "auto auto",
                height: 44,
                padding: "0 14px",
                borderRadius: 10,
                background: P.headerBtnBg,
                border: `1px solid ${P.headerBtnBorder}`,
                color: P.headerInk,
                fontSize: 15,
              }}
            >
              <Columns2 size={18} aria-hidden="true" />
              Change bays
            </button>
          )}
        </div>
      </header>

      {actionError && !signedOut && (
        <div
          role="alert"
          className="shrink-0 mx-4 mt-4 rounded border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] px-4 py-3"
          style={{ fontSize: 17 }}
        >
          {actionError}
        </div>
      )}

      {signedOut ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center px-4">
          <div className="font-bold" style={{ fontSize: 30, color: P.ink }}>
            Signed out
          </div>
          <div style={{ fontSize: 17, color: P.muted }}>Sign back in to keep this screen updating.</div>
          <a
            href="/login.html"
            className="inline-flex items-center justify-center font-semibold"
            style={{
              height: 56,
              padding: "0 32px",
              borderRadius: 10,
              background: P.headerBg,
              color: P.headerInk,
              fontSize: 18,
            }}
          >
            Sign in
          </a>
        </div>
      ) : !loaded || (loadError && !hasGoodDataRef.current) ? (
        <div className="flex-1 flex items-center justify-center" style={{ fontSize: 20, color: P.muted }}>
          {loadError ?? "Loading dock…"}
        </div>
      ) : (
        <main
          className="flex-1 min-h-0 grid"
          style={{
            gap: 16,
            padding: 16,
            gridTemplateColumns: pairBays.length === 2 ? "repeat(2, minmax(0,1fr))" : "minmax(0,1fr)",
            gridTemplateRows: "minmax(0,1fr)",
          }}
        >
          {pairBays.map((bay) => (
            <DockBayPanel
              key={bay.id}
              bay={bay}
              assignments={assignments}
              cardHandlers={cardHandlers}
              canManage={canManage}
              onMore={handleMore}
            />
          ))}
        </main>
      )}

      {moreTarget && (
        <div className="fixed inset-0 z-40" onClick={() => setMoreTarget(null)}>
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className="fixed flex flex-col overflow-hidden"
            style={{
              top: Math.min(moreTarget.rect.bottom + 8, window.innerHeight - (56 * moreItems.length + 16)),
              right: Math.max(window.innerWidth - moreTarget.rect.right, 8),
              minWidth: 240,
              background: P.surface,
              border: `1px solid ${P.btnBorder}`,
              borderRadius: 12,
              boxShadow: "var(--shadow-md)",
            }}
          >
            {moreItems.length === 0 ? (
              <div className="px-4 flex items-center" style={{ height: 56, fontSize: 16, color: P.muted }}>
                No actions for this load
              </div>
            ) : (
              moreItems.map((item, i) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreTarget(null);
                    item.onClick();
                  }}
                  className="text-left px-4 font-semibold cursor-pointer"
                  style={{
                    height: 56,
                    fontSize: 17,
                    color: P.ink,
                    borderTop: i > 0 ? `1px solid ${P.cardBorder}` : undefined,
                  }}
                >
                  {item.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <Modal isOpen={trailerTarget !== null} onClose={() => setTrailerTarget(null)} title="Edit trailer #">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!trailerTarget) return;
            cardHandlers.onTrailerChange(trailerTarget, trailerDraft.trim());
            setTrailerTarget(null);
          }}
          className="space-y-4"
        >
          <input
            type="text"
            value={trailerDraft}
            onChange={(e) => setTrailerDraft(e.target.value)}
            autoFocus
            autoComplete="off"
            aria-label="Trailer number"
            className="w-full min-h-[56px] px-3 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text font-mono"
            style={{ fontSize: 22 }}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setTrailerTarget(null)}
              className="min-h-[56px] px-5 rounded border border-[var(--card-border)] bg-[var(--card-bg)] text-base font-semibold text-text cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="min-h-[56px] px-5 rounded bg-[var(--primary-bg)] text-[var(--primary-text)] text-base font-semibold cursor-pointer"
            >
              Save
            </button>
          </div>
        </form>
      </Modal>

      <DockModalHost
        modals={actions.modals}
        bays={bays}
        assignments={assignments}
        pullJobDefaultBayId={null}
        onReload={() => load()}
      />

      {showPicker && (
        <DockBayPicker
          bays={bays}
          initial={pairBays.map((b) => b.bay_number)}
          canCancel={pairBays.length > 0}
          onConfirm={handleChoosePair}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
