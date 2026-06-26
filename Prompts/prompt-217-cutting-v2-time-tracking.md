# Prompt 216 — Cutting v2: per-line / per-job time tracking (true cutting time on the board)

> Assumed number **216** (sequence after P215). Easily renamed. **Apply after P215** — no hard
> conflict (P216 anchors on P214-era lines P215 leaves intact), but sequencing keeps the tree clean.

## Agents
**Lead: React Component Agent (§9b)** — time badges, job total, live tick, `lib/time.ts` helpers.
**Coordinate with Next/Cloudflare Platform Agent (§9a)** for the queue-payload aggregation
(`/v2/api/cutting/queue` gains per-line tracked time).

## Required reading (both, before any edit)
- `AGENTS.md`
- `xpanda-ops-agents.md` — §9b and §9a (migration surface only; tokens-only; no hardcoded hex;
  build-must-be-green; session model is the source of truth, `cutting_steps` is dead).
- `agent-react-component.md` — reusable helpers (time formatting lives in one place), tokens-only,
  mono/tabular-nums for numbers, designed states.

## Context
Time tracking is **per line, per job** — true elapsed cutting time, derived from the `cutting_sessions`
records (one clock-in→clock-out = one session; `started_at`, `ended_at`, `status`). For each
(job, line): sum closed-session durations = accumulated tracked time; the currently-open session (if
any) adds live elapsed. Sum across a job's lines = job total.

This surfaces **inline on the board** (where the work happens), not on a separate report:
- a tracked-time badge on each `LineRow` (the running line ticks live, tinted), and
- a **job total** in the detail header.

**Time only this prompt.** Units/hour is intentionally deferred: `qty_done_delta` is sparse
(optional at clock-out) and `qty_target` is still NULL (no BOM), so per-hour rates would be
misleading until pieces-completed entry is routine. Recorded in Backlog.

## Scope decisions (LOCKED)
- Compute tracked seconds **server-side** in the queue route via `SUM(julianday(ended_at) -
  julianday(started_at)) * 86400` over **closed** sessions, grouped by (job_id, line). Add
  `tracked_seconds` + `open_started_at` to each line in the payload. No migration, no new route.
- Live display = `tracked_seconds + (open ? now − open_started_at : 0)`, **minute resolution**, 30s
  client tick. Running line's badge uses the info token; idle uses muted.
- No units/hour, no separate throughput page this prompt (both → Backlog).
- No change to clock-in/out/complete routes, middleware, or any session-write path.

## Scope (files)
Migration surface ONLY: `cutting-pilot/`.
- **NEW:** `src/lib/time.ts` (`lineLiveSeconds`, `formatDuration` — single source, no duplication)
- **EDIT:** `src/app/api/cutting/queue/route.ts` (§9a — grouped duration query + 2 fields per line)
- **EDIT:** `src/app/cutting/types.ts` (`tracked_seconds`, `open_started_at` on `CuttingLine`)
- **EDIT:** `src/app/cutting/LineRow.tsx` (`now` prop + time badge)
- **EDIT:** `src/app/cutting/CuttingBoard.tsx` (`now` state + 30s tick, job total, pass `now`)
Do NOT touch: any route other than queue, middleware, session writes, `Sheet.tsx`, modals, legacy.

---

## Task 1 — NEW `src/lib/time.ts`

```ts
// Time-tracking helpers for the cutting board. Single source — do not inline these elsewhere.

// D1 datetime strings are UTC 'YYYY-MM-DD HH:MM:SS'. Convert to epoch ms.
function parseUtc(ts: string): number {
  return Date.parse(ts.replace(" ", "T") + "Z");
}

// Total tracked seconds for a line = accumulated closed-session time (from the server)
// plus the currently-running session's elapsed (if any), measured against `nowMs`.
export function lineLiveSeconds(
  line: { tracked_seconds: number; open_started_at: string | null },
  nowMs: number
): number {
  let s = line.tracked_seconds || 0;
  if (line.open_started_at) {
    const startMs = parseUtc(line.open_started_at);
    if (!Number.isNaN(startMs)) s += Math.max(0, (nowMs - startMs) / 1000);
  }
  return s;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
```

## Task 2 — `queue/route.ts` (§9a)

2a. Surface the open session's start time. Anchor (exact, once):
```ts
      `SELECT id, job_id, line, operator_name
       FROM cutting_sessions
       WHERE status = 'open' AND job_id IN (${placeholders})`
```
Replace with:
```ts
      `SELECT id, job_id, line, operator_name, started_at
       FROM cutting_sessions
       WHERE status = 'open' AND job_id IN (${placeholders})`
```

2b. Carry `started_at` through the open-session map. Anchor (exact, once):
```ts
    const openByKey = new Map<string, { session_id: string; operator_name: string }>();
    for (const row of (openSessionRows.results || [])) {
      openByKey.set(`${row.job_id}:${row.line}`, {
        session_id: row.id,
        operator_name: row.operator_name,
      });
    }
```
Replace with:
```ts
    const openByKey = new Map<
      string,
      { session_id: string; operator_name: string; started_at: string }
    >();
    for (const row of (openSessionRows.results || [])) {
      openByKey.set(`${row.job_id}:${row.line}`, {
        session_id: row.id,
        operator_name: row.operator_name,
        started_at: row.started_at,
      });
    }
```

2c. Aggregate closed-session durations. Anchor (exact, once):
```ts
    const queue = jobs.map((job: any) => {
```
Insert IMMEDIATELY BEFORE it:
```ts
    // Per-line tracked time (closed sessions only) — true time tracking.
    // jobIds + placeholders already in scope from the queries above.
    const durationRows = await DB.prepare(
      `SELECT job_id, line,
              COALESCE(SUM((julianday(ended_at) - julianday(started_at)) * 86400), 0) AS tracked_seconds
       FROM cutting_sessions
       WHERE status = 'closed' AND job_id IN (${placeholders})
       GROUP BY job_id, line`
    ).bind(...jobIds).all<any>();

    const durByKey = new Map<string, number>();
    for (const row of (durationRows.results || [])) {
      durByKey.set(`${row.job_id}:${row.line}`, Math.round(Number(row.tracked_seconds) || 0));
    }

```

2d. Emit the two new fields per line. Anchor (exact, once):
```ts
          last_handoff_note: handoffByKey.get(key) || "",
```
Replace with:
```ts
          last_handoff_note: handoffByKey.get(key) || "",
          tracked_seconds: durByKey.get(key) || 0,
          open_started_at: open?.started_at ?? null,
```

## Task 3 — `types.ts`

Anchor (exact, once):
```ts
  last_handoff_note: string;
```
Replace with:
```ts
  last_handoff_note: string;
  tracked_seconds: number;
  open_started_at: string | null;
```

## Task 4 — `LineRow.tsx`

4a. Import helpers. Anchor (exact, once):
```ts
import type { CuttingLine } from "./types";
```
Insert AFTER it:
```ts
import { formatDuration, lineLiveSeconds } from "@/lib/time";
```

4b. Add the `now` prop to the interface. Anchor (exact, once):
```ts
  onComplete: (jobId: string, line: string) => void;
```
Replace with:
```ts
  onComplete: (jobId: string, line: string) => void;
  now: number;
```

4c. Destructure it. Anchor (exact, once — the destructure list close):
```ts
  onComplete,
}: Props) {
```
Replace with:
```ts
  onComplete,
  now,
}: Props) {
```

4d. Render the time badge beside the status pill. Anchor (exact, once):
```tsx
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="font-medium text-sm text-text">{lineObj.line}</span>
        <LineStatusPill status={lineObj.line_status} />
      </div>
```
Replace with:
```tsx
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="font-medium text-sm text-text">{lineObj.line}</span>
        <div className="flex items-center gap-2 shrink-0">
          {(() => {
            const secs = lineLiveSeconds(lineObj, now);
            return secs >= 1 ? (
              <span
                className={`font-mono tabular-nums text-xs ${
                  lineObj.open_started_at ? "text-[var(--info-text)]" : "text-muted"
                }`}
                title="Tracked cutting time on this line"
              >
                {formatDuration(secs)}
              </span>
            ) : null;
          })()}
          <LineStatusPill status={lineObj.line_status} />
        </div>
      </div>
```

## Task 5 — `CuttingBoard.tsx`

5a. Import helpers. Anchor (exact, once):
```ts
import type { CuttingJob } from "./types";
```
Insert AFTER it:
```ts
import { formatDuration, lineLiveSeconds } from "@/lib/time";
```

5b. `now` state. Anchor (exact, once):
```ts
  const [search, setSearch] = useState("");
```
Insert AFTER it:
```ts
  const [now, setNow] = useState(() => Date.now());
```

5c. 30s tick. Anchor (exact, once):
```ts
  useEffect(() => {
    fetchQueue();
  }, []);
```
Insert AFTER it:
```ts
  // Tick for live time-tracking display (minute resolution; 30s is plenty).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
```

5d. Job total. Anchor (exact, once):
```ts
  const selectedJob = filteredQueue.find((j) => j.id === selectedJobId) ?? null;
```
Insert AFTER it:
```ts
  const jobTotalSeconds = selectedJob
    ? selectedJob.lines.reduce((sum, l) => sum + lineLiveSeconds(l, now), 0)
    : 0;
```

5e. Show the job total in the detail header. Anchor (exact, once):
```tsx
                      {selectedJob.ship_date ? ` · Ships ${selectedJob.ship_date}` : ""}
                    </p>
```
Replace with:
```tsx
                      {selectedJob.ship_date ? ` · Ships ${selectedJob.ship_date}` : ""}
                    </p>
                    <p className="font-mono tabular-nums text-xs text-muted mt-1">
                      Tracked: {formatDuration(jobTotalSeconds)}
                    </p>
```

5f. Pass `now` to each `LineRow`. Anchor (exact, once):
```tsx
                    onComplete={completeLine}
```
Replace with:
```tsx
                    onComplete={completeLine}
                    now={now}
```

---

## Build verification (MANDATORY — loop until green)
```
cd cutting-pilot
npx tsc --noEmit
npx opennextjs-cloudflare build
```
Both must pass. Do not hand back a non-building tree.

## BACKLOG.md / CHANGELOG.md (same commit)

**CHANGELOG.md** — top of **Manufacturing / Cutting (React pilot)**:
> - **P216** — Cutting v2 per-line/per-job time tracking: the queue payload now aggregates closed
>   `cutting_sessions` durations per (job, line) (`SUM(julianday diff)`) and surfaces `tracked_seconds`
>   + the open session's `open_started_at`. The board shows a tracked-time badge on each line (running
>   line ticks live via a 30s client clock, info-tinted) and a job total in the detail header. Time
>   helpers centralized in `src/lib/time.ts` (`lineLiveSeconds`, `formatDuration`). Time-only;
>   units/hour deferred (qty data still sparse). No migration, no session-write change. `tsc --noEmit`
>   + `cf-build` green.

**BACKLOG.md** — under **Manufacturing / Cutting (React pilot)**, add:
- `[ ] Units/hour throughput once qty entry is routine (qty_done_delta + qty_target) — pair with first-pass yield`
- `[ ] Throughput/time-tracking report surface (per-line bottleneck rollups across jobs/date range) if a separate analytics view is wanted beyond the on-board badges`

Update the existing ERP add-on line for "Throughput / units-per-hour …" to note the on-board
per-line/per-job **time** tracking shipped in P216 and only the **rate** (units/hour) remains.

## Out of scope
- No units/hour, no separate report page, no qty/BOM wiring.
- No edits to clock-in/out/complete routes, middleware, or any session-write path.
- No migration. No legacy-module edits.
