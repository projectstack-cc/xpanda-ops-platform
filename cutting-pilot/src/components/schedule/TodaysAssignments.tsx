"use client";
// src/components/schedule/TodaysAssignments.tsx
// tasks-03: Schedule TV — Today's Assignments panel (NEXT WEEK band, Wed–Fri space). Display only.
// Own poll of GET /v2/api/tasks/board (no ?date → ET today) every 60 s, separate from the schedule
// poll so a tasks failure can never blank the schedule. Keeps the last good render on any error.
//
// Body = a 3-column MEASURED flow (CSS `columns` can't insert the "cont." label): the board is
// flattened into units (shift header / sublabel+first block / block), measured once in a hidden
// one-column-wide measurer, then packed top-to-bottom:
//   - a unit that doesn't fit moves to the next column, preceded by "{label} · cont." (unless it's
//     a shift header); blocks never split
//   - the 2nd shift header always opens a fresh column (if one is left and the current isn't empty)
//   - the no-shift group follows 2nd shift in normal flow
//   - no column left → everything remaining goes in column 3
// Every column renders through AutoScrollColumn, which only crawls on real overflow: column 3 when
// it gets the remainder, or any column holding a single unit taller than the body.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Repeat, Users } from "lucide-react";
import type { BoardResponse, PersonBlock, ShiftGroup, ShiftKey, TaskLine, TeamBlock } from "@/lib/tasks/board";
import AutoScrollColumn from "./AutoScrollColumn";

const POLL_MS = 60_000;
const COLS = 3;

// TV-first sizing — same clamp(…vh…) approach as DayColumn/OrderRow (canvas at 1920×1080:
// names ≈15px, lines ≈13px, slot ≈12px; slot column ≈92px).
const T_NAME = "text-[clamp(0.8125rem,1.4vh,1.375rem)]";
const T_LINE = "text-[clamp(0.75rem,1.2vh,1.125rem)]";
const T_SLOT = "text-[clamp(0.6875rem,1.1vh,1rem)]";
const T_SMALL = "text-[clamp(0.625rem,0.95vh,0.875rem)]";
const SLOT_COL = { gridTemplateColumns: "clamp(5rem,8.5vh,8rem) minmax(0,1fr)" } as const;

type Unit = { key: string; node: React.ReactNode; contLabel: string; isShiftHeader: boolean; forceBreak: boolean };
type Cell = { kind: "unit"; key: string } | { kind: "cont"; key: string; label: string };

/** "2026-11-17" → "Tue 11/17" (UTC math on the YMD — no TZ drift). */
function formatPanelDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  return `${dow} ${Number(m[2])}/${Number(m[3])}`;
}

function shiftTag(shifts: (ShiftKey | null)[]): string {
  const set = Array.from(new Set(shifts.filter((s): s is ShiftKey => s !== null)));
  if (set.length === 0) return "—";
  return set.join(" + ");
}

function StatusBadgeFor({ group }: { group: ShiftGroup }) {
  const base = `shrink-0 rounded px-1.5 py-px font-semibold ${T_SMALL}`;
  if (group.status === "on") return <span className={`${base} bg-[var(--success-bg)] text-[var(--success-text)]`}>On now</span>;
  if (group.status === "upcoming") {
    const start = group.hours?.split(" – ")[0] ?? "";
    return (
      <span className={`${base} border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)]`}>
        Starts <span className="font-mono tabular-nums">{start}</span>
      </span>
    );
  }
  if (group.status === "done") return <span className={`${base} bg-[var(--ghost-bg)] text-[var(--text-muted)]`}>Done</span>;
  return null;
}

function ShiftHeader({ group, empty }: { group: ShiftGroup; empty: boolean }) {
  return (
    <div>
      <div
        className={`flex items-center justify-between gap-2 px-2 py-1 border-b border-[var(--line)] ${
          group.status === "on" ? "bg-[var(--loaded-bg)]" : "bg-[var(--surface-2)]"
        }`}
      >
        <span className="min-w-0 flex items-baseline gap-2">
          <span className={`font-bold uppercase tracking-wide text-text ${T_LINE}`}>{group.label}</span>
          {group.hours && <span className={`font-mono tabular-nums text-muted ${T_SLOT}`}>{group.hours}</span>}
        </span>
        <StatusBadgeFor group={group} />
      </div>
      {empty && <div className={`px-2 py-2 italic text-text-faint ${T_SMALL}`}>No assignments</div>}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className={`px-2 pt-1.5 pb-0.5 font-semibold uppercase tracking-wide text-text-faint ${T_SMALL}`}>{children}</div>
  );
}

function TaskLines({ tasks }: { tasks: TaskLine[] }) {
  return (
    <ul className="mt-0.5 space-y-0.5">
      {tasks.map((t) => (
        <li key={t.id} className="grid items-baseline gap-x-1.5" style={SLOT_COL}>
          <span className={`font-mono tabular-nums text-muted whitespace-nowrap ${T_SLOT}`}>{t.slot_label ?? "—"}</span>
          <span className={`min-w-0 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-text ${T_LINE}`}>
            <span className="font-medium break-words">{t.title}</span>
            {t.invoices.map((inv) => (
              <span
                key={inv}
                className={`rounded border border-[var(--info-border)] px-1 font-mono tabular-nums leading-tight text-[var(--info-text)] ${T_SMALL}`}
              >
                INV {inv}
              </span>
            ))}
            {t.repeatable && (
              <Repeat
                role="img"
                aria-label="Repeatable task"
                className="self-center shrink-0 text-text-faint w-[clamp(0.75rem,1.1vh,1rem)] h-[clamp(0.75rem,1.1vh,1rem)]"
              />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TeamCard({ team }: { team: TeamBlock }) {
  return (
    <div className="px-2 py-1.5 border-b border-[var(--line)] bg-[var(--info-bg)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-1.5">
          <Users aria-hidden="true" className="mt-[0.15em] shrink-0 text-[var(--info-text)] w-[clamp(0.8125rem,1.3vh,1.25rem)] h-[clamp(0.8125rem,1.3vh,1.25rem)]" />
          <div className="min-w-0">
            <div className={`font-bold leading-snug text-text break-words ${T_NAME}`}>{team.names}</div>
            {team.crew_name && <div className={`leading-tight text-[var(--info-text)] ${T_SMALL}`}>{team.crew_name}</div>}
          </div>
        </div>
        <span className={`shrink-0 font-mono tabular-nums text-muted ${T_SMALL}`}>{shiftTag(team.shifts)}</span>
      </div>
      <TaskLines tasks={team.tasks} />
    </div>
  );
}

function PersonCard({ person }: { person: PersonBlock }) {
  return (
    <div className="px-2 py-1.5 border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="flex items-baseline justify-between gap-2">
        <div className={`min-w-0 truncate font-bold text-text ${T_NAME}`}>{person.name}</div>
        <span className={`shrink-0 font-mono tabular-nums text-muted ${T_SMALL}`}>{person.shift ?? "—"}</span>
      </div>
      <TaskLines tasks={person.tasks} />
    </div>
  );
}

function ContLine({ label }: { label: string }) {
  return (
    <div className={`px-2 py-1 border-b border-[var(--line)] bg-[var(--surface-2)] font-semibold uppercase tracking-wide text-muted ${T_SMALL}`}>
      {label} · cont.
    </div>
  );
}

function buildUnits(groups: ShiftGroup[]): Unit[] {
  const units: Unit[] = [];
  groups.forEach((g, gi) => {
    const gk = g.shift ?? "none";
    const empty = g.teams.length === 0 && g.individuals.length === 0;
    units.push({
      key: `h:${gk}`,
      node: <ShiftHeader group={g} empty={empty} />,
      contLabel: g.label,
      isShiftHeader: true,
      forceBreak: g.shift === "2nd" && gi > 0,
    });
    const push = (key: string, node: React.ReactNode) =>
      units.push({ key, node, contLabel: g.label, isShiftHeader: false, forceBreak: false });
    g.teams.forEach((t, i) => {
      const card = <TeamCard team={t} />;
      push(`t:${gk}:${t.key}`, i === 0 ? <><SubLabel>Teams</SubLabel>{card}</> : card);
    });
    g.individuals.forEach((p, i) => {
      const card = <PersonCard person={p} />;
      push(`p:${gk}:${p.user_id}`, i === 0 ? <><SubLabel>Individual</SubLabel>{card}</> : card);
    });
  });
  return units;
}

/** Greedy top-to-bottom pack into COLS columns of height H (see file header). */
function pack(units: Unit[], heights: Map<string, number>, contH: number, H: number): Cell[][] {
  const cols: Cell[][] = Array.from({ length: COLS }, () => []);
  const used = new Array<number>(COLS).fill(0);
  let c = 0;
  for (const u of units) {
    const h = heights.get(u.key) ?? 0;
    if (u.forceBreak && c < COLS - 1 && cols[c].length > 0) c++;
    else if (c < COLS - 1 && cols[c].length > 0 && used[c] + h > H) {
      c++;
      if (!u.isShiftHeader) {
        cols[c].push({ kind: "cont", key: `cont:${u.key}`, label: u.contLabel });
        used[c] += contH;
      }
    }
    cols[c].push({ kind: "unit", key: u.key });
    used[c] += h;
  }
  return cols;
}

export default function TodaysAssignments() {
  const [data, setData] = useState<BoardResponse | null>(null);
  const [stale, setStale] = useState(false);
  const [firstError, setFirstError] = useState<string | null>(null);
  const hasGoodRef = useRef(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/tasks/board", { cache: "no-store" });
      // 503 = the auth layer's D1 lookup blipped — transient. Stale, never an error.
      if (res.status === 503) {
        if (hasGoodRef.current) setStale(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { ok?: boolean } & BoardResponse;
      if (!json || json.ok === false || !Array.isArray(json.groups)) throw new Error("bad payload");
      hasGoodRef.current = true;
      setData({ date: json.date, groups: json.groups, task_count: json.task_count, people_count: json.people_count });
      setStale(false);
      setFirstError(null);
    } catch {
      if (hasGoodRef.current) setStale(true);
      else setFirstError("Today's assignments couldn't be loaded.");
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const id = setInterval(fetchTasks, POLL_MS);
    return () => clearInterval(id);
  }, [fetchTasks]);

  const units = useMemo(() => (data ? buildUnits(data.groups) : []), [data]);
  const nodeByKey = useMemo(() => new Map(units.map((u) => [u.key, u.node])), [units]);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [plan, setPlan] = useState<Cell[][] | null>(null);

  // Measure + pack on data change and on any resize of the panel body or the measured content
  // (font load, viewport change) — same ResizeObserver pattern as AutoScrollColumn.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const measure = measureRef.current;
    if (!body || !measure) return;
    const recompute = () => {
      const H = Math.floor(body.clientHeight);
      const heights = new Map<string, number>();
      measure.querySelectorAll<HTMLElement>("[data-unit]").forEach((el) => {
        heights.set(el.dataset.unit as string, Math.ceil(el.getBoundingClientRect().height));
      });
      const contEl = measure.querySelector<HTMLElement>("[data-cont-sample]");
      const contH = contEl ? Math.ceil(contEl.getBoundingClientRect().height) : 0;
      const next = pack(units, heights, contH, H);
      setPlan((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(body);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [units]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--surface)]">
      <div className="shrink-0 flex items-center justify-between gap-3 px-2 py-0.5 bg-[var(--primary-bg)] text-[var(--primary-text)]">
        <span className="min-w-0 flex items-baseline gap-2 truncate">
          <span className="text-[clamp(0.625rem,0.95vh,0.8125rem)] font-bold uppercase tracking-wide">Today&apos;s Assignments</span>
          <span className="text-[clamp(0.625rem,0.9vh,0.75rem)] opacity-70">Asignaciones de hoy</span>
        </span>
        <span className="shrink-0 flex items-center gap-3 text-[clamp(0.625rem,0.9vh,0.75rem)]">
          {stale && (
            <span className="rounded px-1 font-mono bg-[var(--warn-bg)] text-[var(--warn-text)]">showing last loaded tasks</span>
          )}
          <span className="flex items-center gap-1 opacity-80">
            <Repeat aria-hidden="true" className="w-[clamp(0.625rem,0.9vh,0.875rem)] h-[clamp(0.625rem,0.9vh,0.875rem)]" /> repeatable
          </span>
          <span className="flex items-center gap-1 opacity-80">
            <Users aria-hidden="true" className="w-[clamp(0.625rem,0.9vh,0.875rem)] h-[clamp(0.625rem,0.9vh,0.875rem)]" /> team
          </span>
          {data && <span className="font-mono tabular-nums font-semibold">{formatPanelDate(data.date)}</span>}
        </span>
      </div>

      <div ref={bodyRef} className="relative flex-1 min-h-0 overflow-hidden">
        {!data ? (
          firstError ? (
            <div className={`px-2 py-2 text-text-faint ${T_SMALL}`}>{firstError}</div>
          ) : (
            <div className="absolute inset-0 grid grid-cols-3 gap-px bg-[var(--line)]" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-[var(--surface)] p-2 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-[var(--surface-2)] animate-pulse motion-reduce:animate-none" />
                  <div className="h-10 rounded bg-[var(--surface-2)] animate-pulse motion-reduce:animate-none" />
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            {/* Hidden one-column-wide measurer (each unit measured in isolation). */}
            <div
              ref={measureRef}
              aria-hidden="true"
              className="absolute left-0 top-0"
              style={{ visibility: "hidden", width: `calc((100% - ${COLS - 1}px) / ${COLS})` }}
            >
              <div data-cont-sample="">
                <ContLine label="1st shift" />
              </div>
              {units.map((u) => (
                <div key={u.key} data-unit={u.key}>
                  {u.node}
                </div>
              ))}
            </div>

            <div className="absolute inset-0 grid grid-cols-3 grid-rows-1 gap-px bg-[var(--line)]">
              {(plan ?? [[], [], []]).map((col, ci) => (
                <div key={ci} className="min-h-0 min-w-0 flex flex-col bg-[var(--surface)]">
                  <AutoScrollColumn>
                    {col.map((cell) =>
                      cell.kind === "cont" ? (
                        <ContLine key={cell.key} label={cell.label} />
                      ) : (
                        <div key={cell.key}>{nodeByKey.get(cell.key)}</div>
                      )
                    )}
                  </AutoScrollColumn>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
