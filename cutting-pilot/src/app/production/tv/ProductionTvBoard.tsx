"use client";
// Production TV board (prod-d-04): one read-only wall display for the molding and expansion areas.
// Headline = what's running right now. Polls GET /v2/api/production/dashboard every 30 s (paused
// while the tab is hidden, immediate refetch on return). All timing uses the endpoint's server_now
// (+ local elapsed between polls) — never the TV's own clock. Labels are English with Spanish
// beneath (static, via translate(); not LangSelect); data values are shown once.
//
// Freshness follows components/loading/LoadingBoard.tsx: 2-min stale threshold since the last good
// poll, 503 = transient (keep old data, show stale), 401 confirmed against /api/auth/me before
// "Signed out". Deliberately NOT components/schedule/FreshnessClock (its 20-min threshold is for
// the shipping-schedule cron) and not a shared components/tv/ extraction (BACKLOG).
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Clock } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import { translate } from "@/lib/i18n";
import { parseUtcTs } from "@/lib/productionHistory";
import { expansionKey, type DashboardData, type ScheduleLineWithProgress } from "@/lib/productionSchedule";

const POLL_MS = 30_000;
const TICK_MS = 5_000;
const STALE_AGE_THRESHOLD_MS = 2 * 60 * 1000;
const MOLDING_IDLE_MIN = 15;
const EXPANSION_IDLE_MIN = 30;
// Copied from components/schedule/ScheduleBoard.tsx (P415 wall-display cursor hide).
const CURSOR_IDLE_MS = 15_000;

// Mirrors SiloGrid's STATE_CLS (not exported there) — BACKLOG: extract one shared mapping.
const SILO_STATE_CLS: Record<string, string> = {
  empty: "bg-[var(--ghost-bg)] text-muted border-border",
  filling: "bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]",
  full: "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-text)]",
  in_use: "bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]",
};
const SILO_STATE_KEY: Record<string, string> = {
  empty: "production.silo.state.empty",
  filling: "production.silo.state.filling",
  full: "production.silo.state.full",
  in_use: "production.silo.state.inUse",
};

const AMBER_CLS = "bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]";

// Bilingual label: English with Spanish beneath. Labels only — never data values.
function bi(key: string) {
  return { en: translate("en", key), es: translate("es", key) };
}
function Bi({ k, vars, className = "" }: { k: string; vars?: Record<string, string | number>; className?: string }) {
  const fill = (s: string) => Object.entries(vars ?? {}).reduce((acc, [n, v]) => acc.replace(`{${n}}`, String(v)), s);
  const l = bi(k);
  return (
    <span className={`inline-flex flex-col leading-tight ${className}`}>
      <span>{fill(l.en)}</span>
      <span className="text-[0.8em] text-muted font-normal">{fill(l.es)}</span>
    </span>
  );
}

const minutesSince = (ts: string | null | undefined, nowMs: number) => {
  const t = parseUtcTs(ts);
  return t === null ? null : Math.max(0, Math.floor((nowMs - t) / 60_000));
};

function etDate(ms: number) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(ms);
}
function etTime(ms: number) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(ms);
}

function Progress({ line }: { line: ScheduleLineWithProgress }) {
  const pct = Math.min(100, (line.done / line.qty) * 100);
  const met = line.done >= line.qty;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[clamp(0.9rem,1.4vw,1.25rem)]">
        <Bi k="production.tv.schedule" className="text-muted" />
        <span className="font-mono tabular-nums font-semibold text-text inline-flex items-center gap-1">
          {met && <Check size={20} className="text-[var(--success-bg)]" aria-hidden="true" />}
          {line.done} / {line.qty}
          {line.kind === "expansion" && line.in_progress > 0 && (
            <Bi k="production.tv.filling" vars={{ n: `+${line.in_progress}` }} className="ml-2 text-muted font-normal" />
          )}
        </span>
      </div>
      <div className="h-3 rounded-full bg-[var(--ghost-bg)] overflow-hidden" role="progressbar" aria-valuenow={line.done} aria-valuemax={line.qty}>
        <div className={met ? "h-full bg-[var(--success-bg)]" : "h-full bg-[var(--brand)]"} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Stat({ k, value }: { k: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <Bi k={k} className="text-[clamp(0.8rem,1.1vw,1rem)] text-muted" />
      <span className="font-mono tabular-nums font-semibold text-text text-[clamp(1.25rem,2.2vw,2.25rem)]">{value}</span>
    </div>
  );
}

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

export default function ProductionTvBoard({ userName, isAdmin, permissions }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"signedOut" | "reconnecting" | "loadFailed" | null>(null);
  const [stale, setStale] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const hasGoodDataRef = useRef(false);
  // server_now − local clock at the last good poll; server time = Date.now() + offset.
  const offsetRef = useRef(0);
  const [, setTick] = useState(0);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/production/dashboard", { cache: "no-store" });
      // 503 = the auth layer's D1 lookup blipped — transient, not a session verdict.
      if (res.status === 503) {
        if (hasGoodDataRef.current) setStale(true);
        else setError("reconnecting");
        return;
      }
      // Confirm a 401 against the auth endpoint before showing anything scarier than "stale".
      if (res.status === 401) {
        let confirmedGone = true;
        try {
          confirmedGone = !(await fetch("/api/auth/me")).ok;
        } catch {
          confirmedGone = false;
        }
        if (!confirmedGone) {
          if (hasGoodDataRef.current) setStale(true);
          else setError("reconnecting");
          return;
        }
        setError("signedOut");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DashboardData = await res.json();
      const serverMs = Date.parse(json.server_now);
      offsetRef.current = Number.isFinite(serverMs) ? serverMs - Date.now() : 0;
      hasGoodDataRef.current = true;
      setData(json);
      setStale(false);
      setError(null);
      setLastSuccessAt(Date.now());
    } catch {
      if (hasGoodDataRef.current) setStale(true);
      else setError("loadFailed");
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll every 30 s while visible; refetch immediately when the tab becomes visible again.
  useEffect(() => {
    fetchBoard();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchBoard();
    }, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") fetchBoard();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchBoard]);

  // Local tick so "N min ago" / idle / clock advance between polls.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Wall-display cursor hide — pattern copied from components/schedule/ScheduleBoard.tsx (P415):
  // class on <html> (beats explicit cursor utilities), zero-delta synthetic moves ignored.
  useEffect(() => {
    const root = document.documentElement;
    const arm = () => {
      cursorTimerRef.current = setTimeout(() => root.classList.add("wall-cursor-hidden"), CURSOR_IDLE_MS);
    };
    const showThenArmHide = (e?: Event) => {
      if (e instanceof PointerEvent && e.type === "pointermove" && e.movementX === 0 && e.movementY === 0) return;
      root.classList.remove("wall-cursor-hidden");
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
      arm();
    };
    arm();
    window.addEventListener("pointermove", showThenArmHide);
    window.addEventListener("keydown", showThenArmHide);
    window.addEventListener("touchstart", showThenArmHide, { passive: true });
    return () => {
      window.removeEventListener("pointermove", showThenArmHide);
      window.removeEventListener("keydown", showThenArmHide);
      window.removeEventListener("touchstart", showThenArmHide);
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
      root.classList.remove("wall-cursor-hidden");
    };
  }, []);

  const header = (
    <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Production · TV" currentPath="/v2/production/tv" autoHide />
  );

  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-bg overflow-hidden">
        {header}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-3 p-3">
          {[0, 1].map((i) => (
            <div key={i} className="bg-[var(--surface)] rounded-lg animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="h-screen flex flex-col bg-bg overflow-hidden">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <AlertTriangle size={36} className="text-[var(--warn-text)]" aria-hidden="true" />
          <Bi k={`production.tv.${error}`} className="text-2xl text-text" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const nowMs = Date.now() + offsetRef.current;
  const moldLines = new Map(data.schedule.molding.map((l) => [l.block_type ?? "", l]));
  const expLines = new Map(data.schedule.expansion.map((l) => [expansionKey(l.bead_supplier, l.bead_type, l.density), l]));
  const openMoldTypes = new Set(data.molding.map((s) => s.block_type ?? ""));
  const openExpKeys = new Set(data.expansion.map((s) => expansionKey(s.bead_supplier, s.bead_type, s.density)));
  const nothingRunning = data.molding.length === 0 && data.expansion.length === 0;
  const ageMs = lastSuccessAt === null ? null : Date.now() - lastSuccessAt;
  const isStale = stale || (ageMs !== null && ageMs > STALE_AGE_THRESHOLD_MS);

  const lineName = (l: ScheduleLineWithProgress) =>
    l.kind === "molding"
      ? l.block_type ?? "—"
      : `${l.bead_supplier ?? "—"} · ${l.bead_type ?? "—"} · ${l.density === null ? "—" : l.density.toFixed(2)} pcf`;

  // Schedule lines with no open card: "Not started" gaps, plus met / partial lines.
  function scheduleRest(lines: ScheduleLineWithProgress[], hasCard: (l: ScheduleLineWithProgress) => boolean) {
    const rest = lines.filter((l) => !hasCard(l));
    if (!rest.length) return null;
    return (
      <ul className="space-y-1">
        {rest.map((l) => {
          const notStarted = !l.running && l.done === 0;
          const met = l.done >= l.qty;
          return (
            <li key={l.id} className="flex items-center justify-between gap-3 border border-border rounded px-3 py-2 bg-[var(--surface-2)] text-[clamp(0.95rem,1.4vw,1.35rem)]">
              <span className={notStarted ? "text-muted" : "text-text font-semibold"}>{lineName(l)}</span>
              <span className="inline-flex items-center gap-3">
                {notStarted ? (
                  <Bi k="production.tv.notStarted" className="text-muted text-right" />
                ) : (
                  <span className="font-mono tabular-nums inline-flex items-center gap-1 text-text">
                    {met && <Check size={18} className="text-[var(--success-bg)]" aria-hidden="true" />}
                    {l.done}
                  </span>
                )}
                <span className="font-mono tabular-nums text-muted">/ {l.qty}</span>
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      {header}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {/* TV-safe inset — same --tv-safe-inset token as the loading / schedule boards (overscan). */}
        <div className="absolute flex flex-col gap-2 overflow-y-auto" style={{ inset: "var(--tv-safe-inset)" }}>
          {/* Top bar */}
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-3 py-1 border-b border-[var(--line)]">
            <div className="flex items-baseline gap-4">
              <span className="text-[clamp(1rem,1.6vw,1.5rem)] font-semibold text-text">{etDate(nowMs)}</span>
              <span className="font-mono tabular-nums text-[clamp(1.25rem,2.2vw,2.25rem)] font-bold text-text">{etTime(nowMs)}</span>
            </div>
            <div className="flex items-center gap-4 text-[clamp(0.8rem,1.1vw,1rem)]">
              {error === "signedOut" && (
                <span className={`px-2 py-1 rounded border ${AMBER_CLS}`}>
                  <Bi k="production.tv.signedOut" />
                </span>
              )}
              {isStale && error !== "signedOut" && (
                <span className={`px-2 py-1 rounded border ${AMBER_CLS}`}>
                  <Bi k={stale ? "production.tv.reconnecting" : "production.tv.showingLast"} />
                </span>
              )}
              <span
                className={[
                  "inline-flex items-center gap-1 font-mono tabular-nums text-xs px-1.5 py-[1px] rounded",
                  isStale ? `border ${AMBER_CLS}` : "text-text-faint",
                ].join(" ")}
                title={lastSuccessAt ? new Date(lastSuccessAt).toLocaleString() : undefined}
              >
                <Clock size={12} aria-hidden="true" />
                {lastSuccessAt ? `${Math.floor((ageMs ?? 0) / 60_000)}m` : <Bi k="production.tv.noData" />}
              </span>
            </div>
          </div>

          {nothingRunning && (
            <div className="shrink-0 flex justify-center py-6">
              <Bi k="production.tv.nothingRunning" className="text-[clamp(2rem,4vw,4rem)] font-bold text-muted text-center" />
            </div>
          )}

          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-3 px-3">
            {/* MOLDING — the headline */}
            <section className="space-y-3 min-w-0">
              <Bi k="production.tv.molding" className="text-[clamp(1.25rem,2vw,2rem)] font-bold text-text uppercase tracking-wide" />
              {data.molding.map((s) => {
                const idleFrom = s.last_block?.created_at ?? s.opened_at;
                const idle = minutesSince(idleFrom, nowMs);
                const amber = idle !== null && idle >= MOLDING_IDLE_MIN;
                const line = moldLines.get(s.block_type ?? "");
                return (
                  <article
                    key={s.session_id}
                    className={["border-2 rounded-lg p-4 space-y-3", amber ? AMBER_CLS : "border-border bg-surface"].join(" ")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h2 className="text-[clamp(2.25rem,5vw,4.5rem)] font-bold leading-none text-text">{s.block_type ?? "—"}</h2>
                      {amber && (
                        <span className="px-3 py-1 rounded border-2 border-[var(--warn-border)] font-semibold text-[clamp(1rem,1.6vw,1.5rem)]">
                          <Bi k="production.tv.idle" vars={{ n: idle ?? 0 }} />
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Stat k="production.tv.silo" value={s.last_block?.silo ?? "—"} />
                      <Stat k="production.tv.lot" value={s.last_block?.lot_no ?? "—"} />
                      <Stat k="production.tv.block" value={s.last_block?.block_no ?? "—"} />
                      <Stat k="production.tv.blocks" value={s.block_count} />
                    </div>
                    <div className="text-[clamp(1rem,1.5vw,1.4rem)] text-text">
                      {s.recipe_version !== null ? (
                        <span className="font-mono tabular-nums">
                          RC {s.recipe_rc_pct_open ?? "—"}% / {s.recipe_rc_speed ?? "—"} · Virgin {s.recipe_virgin_pct_open ?? "—"}% /{" "}
                          {s.recipe_virgin_speed ?? "—"} <span className="text-muted">(v{s.recipe_version})</span>
                        </span>
                      ) : (
                        <Bi k="production.tv.noRecipe" className="text-muted" />
                      )}
                    </div>
                    <Bi
                      k={s.last_block ? "production.tv.lastBlockAgo" : "production.tv.openedAgo"}
                      vars={{ n: minutesSince(idleFrom, nowMs) ?? "—" }}
                      className="text-[clamp(0.95rem,1.3vw,1.25rem)] text-text font-mono tabular-nums"
                    />
                    {line && <Progress line={line} />}
                  </article>
                );
              })}
              {scheduleRest(data.schedule.molding, (l) => openMoldTypes.has(l.block_type ?? ""))}
            </section>

            {/* EXPANSION */}
            <section className="space-y-3 min-w-0">
              <Bi k="production.tv.expansion" className="text-[clamp(1.25rem,2vw,2rem)] font-bold text-text uppercase tracking-wide" />
              {data.expansion.map((s) => {
                const idleFrom = s.last_batch?.created_at ?? s.opened_at;
                const idle = minutesSince(idleFrom, nowMs);
                const amber = idle !== null && idle >= EXPANSION_IDLE_MIN;
                const line = expLines.get(expansionKey(s.bead_supplier, s.bead_type, s.density));
                return (
                  <article
                    key={s.session_id}
                    className={["border-2 rounded-lg p-4 space-y-3", amber ? AMBER_CLS : "border-border bg-surface"].join(" ")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h2 className="text-[clamp(1.5rem,3vw,2.75rem)] font-bold leading-tight text-text">
                        {s.bead_supplier ?? "—"} · {s.bead_type ?? "—"} ·{" "}
                        <span className="font-mono tabular-nums">{s.density === null ? "—" : s.density.toFixed(2)} pcf</span>
                      </h2>
                      {amber && (
                        <span className="px-3 py-1 rounded border-2 border-[var(--warn-border)] font-semibold text-[clamp(1rem,1.6vw,1.5rem)]">
                          <Bi k="production.tv.idle" vars={{ n: idle ?? 0 }} />
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Stat k="production.tv.fillingSilo" value={s.last_batch?.silo ?? "—"} />
                      <Stat k="production.tv.heating" value={s.recipe_heating_time_s === null ? "—" : `${s.recipe_heating_time_s} s`} />
                      <Stat k="production.tv.batches" value={s.batch_count} />
                      <Stat k="production.tv.kg" value={s.total_kg.toFixed(1)} />
                    </div>
                    <Bi
                      k={s.last_batch ? "production.tv.lastBatchAgo" : "production.tv.openedAgo"}
                      vars={{ n: minutesSince(idleFrom, nowMs) ?? "—" }}
                      className="text-[clamp(0.95rem,1.3vw,1.25rem)] text-text font-mono tabular-nums"
                    />
                    {line && <Progress line={line} />}
                  </article>
                );
              })}
              {scheduleRest(data.schedule.expansion, (l) => openExpKeys.has(expansionKey(l.bead_supplier, l.bead_type, l.density)))}
            </section>
          </div>

          {/* SILOS 1–12 */}
          <div className="shrink-0 px-3 pb-2 space-y-1">
            <Bi k="production.tv.silos" className="text-[clamp(0.9rem,1.3vw,1.2rem)] font-bold text-text uppercase tracking-wide" />
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12 gap-2">
              {data.silos.map((s) => {
                const fullMs = s.state === "full" || s.state === "in_use" ? parseUtcTs(s.full_at) : null;
                const st = bi(SILO_STATE_KEY[s.state] ?? "production.silo.state.empty");
                return (
                  <div
                    key={s.silo_no}
                    className={["rounded border px-2 py-1.5 flex flex-col gap-0.5", SILO_STATE_CLS[s.state] ?? SILO_STATE_CLS.empty, s.active ? "" : "opacity-40"].join(" ")}
                  >
                    <span className="flex items-baseline justify-between gap-1">
                      <span className="font-bold text-[clamp(0.9rem,1.2vw,1.2rem)]">{s.label}</span>
                      <span className="text-[0.7rem] font-semibold leading-tight text-right">
                        {st.en}
                        <br />
                        <span className="opacity-80">{st.es}</span>
                      </span>
                    </span>
                    {s.state !== "empty" && (
                      <span className="font-mono tabular-nums text-[0.8rem] leading-tight">
                        {s.lot_no ?? "—"}
                        {s.density !== null ? ` · ${s.density.toFixed(2)}` : ""}
                      </span>
                    )}
                    {fullMs !== null && (
                      <Bi
                        k="production.tv.hoursSinceFull"
                        vars={{ h: ((nowMs - fullMs) / 3_600_000).toFixed(1) }}
                        className="font-mono tabular-nums text-[0.75rem]"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
