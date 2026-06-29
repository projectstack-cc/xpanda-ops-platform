# Prompt 220 — Cutting v2: parts as a docked sidebar (clocked-in line only) + one-session-per-user

> Assumed number **220**. Modifies shipped 219. No migration, no schema change.

## What changes (from 219)
- The parts checklist moves from a top-of-detail panel **into a docked right sidebar** (a real
  side column, not a hovering overlay) that sits beside the line rows and clock buttons.
- The sidebar **only appears once the operator is clocked into this job**, and shows **only their
  clocked-in line's** checklist (no line tabs / line selector).
- **One open session per user, enforced:** you cannot clock into another line (any job) while you
  have an open session — server-side 409 + client-side disabled Clock In.

## Agents
**Lead: React Component Agent (§9b)** — sidebar layout, `PartsPanel` simplification, `LineRow`.
**Next/Cloudflare Platform Agent (§9a)** — clock-in per-user guard.

## Required reading (both)
`AGENTS.md`; `xpanda-ops-agents.md` §9a/§9b; `agent-react-component.md`. Constraints: migration
surface only; tokens-only; no hardcoded hex; build-must-be-green; operator identity from
middleware `X-User-*` headers, never the client body.

## Scope decisions (LOCKED)
- Sidebar is a docked column: right side on md+ (`md:w-80`, `border-l`), stacked below the lines on
  narrow (`border-t`). The whole detail scrolls as one on narrow; lines + sidebar scroll
  independently on md+.
- Sidebar renders only when the current user's open session is on the selected job; it shows that
  one line. No tabs, no `onSelectLine`, no `requiredLines`, no `checklistLine` state.
- Clock-in guard: reject with 409 `already_clocked_in` (returning the line they're on) if the
  operator already has any open session. Client disables Clock In on every other line and toasts the
  reason if the server 409s.
- No migration, no `types.ts` change (the `progress` map + line-item `id` already exist).

## Scope (files)
- **EDIT:** `cutting-pilot/src/app/api/cutting/clock-in/route.ts`
- **EDIT:** `cutting-pilot/src/app/cutting/PartsPanel.tsx` (full rewrite → single-line, no tabs)
- **EDIT:** `cutting-pilot/src/app/cutting/LineRow.tsx`
- **EDIT:** `cutting-pilot/src/app/cutting/CuttingBoard.tsx`

---

## Task 1 — `clock-in/route.ts`: one open session per operator

Anchor (exact, once):
```ts
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
```
Insert IMMEDIATELY AFTER it:
```ts

    // Guard: one open session per operator across the whole board (any job/line).
    const mineOpen = await DB.prepare(
      `SELECT line FROM cutting_sessions
       WHERE operator_id = ? AND status = 'open' LIMIT 1`
    ).bind(operatorId).first<{ line: string }>();
    if (mineOpen) {
      return NextResponse.json(
        { ok: false, error: "already_clocked_in", line: mineOpen.line },
        { status: 409 }
      );
    }
```

## Task 2 — `PartsPanel.tsx`: single-line checklist (full rewrite)
Replace the ENTIRE file with:
```tsx
"use client";
import type { CuttingJob } from "./types";

interface Props {
  job: CuttingJob;
  line: string;
  onToggle: (lineItemId: string, completed: boolean) => void;
  busy: boolean;
}

// Docked parts checklist for a single cutting line (the operator's clocked-in line).
// Cross Cutter / Hole Cutter really work in chunks; until the block-calc BOM is wired, every line
// shows the same parts list and the chunk note below stands in.
export default function PartsPanel({ job, line, onToggle, busy }: Props) {
  const items = job.line_items ?? [];
  const prog = job.progress?.[line] ?? {};
  const doneCount = items.filter((it) => prog[it.id]?.completed).length;

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-surface">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {line} — parts
        </span>
        <span className="font-mono tabular-nums text-xs text-muted">
          {doneCount}/{items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted">No parts on this order.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const checked = !!prog[it.id]?.completed;
            return (
              <li key={it.id}>
                <label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(e) => onToggle(it.id, e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)] cursor-pointer disabled:opacity-50"
                  />
                  <span className="min-w-0 flex-1">
                    {it.part_number && (
                      <span className="font-mono text-sm text-text">{it.part_number} </span>
                    )}
                    {it.description && (
                      <span className={`text-sm ${checked ? "text-muted line-through" : "text-text"}`}>
                        {it.description}
                      </span>
                    )}
                    {it.dimensions && (
                      <span className="block text-xs text-muted mt-0.5">{it.dimensions}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-sm text-muted">
                    {it.quantity ?? "—"}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="m-3 rounded border border-dashed border-border px-3 py-2.5 opacity-70">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Blocks / chunks required — coming soon
        </span>
        <p className="text-xs text-muted mt-1">
          Cross Cutter / Hole Cutter work in chunks; counts list here once the block-calculator BOM is
          wired.
        </p>
      </div>
    </div>
  );
}
```

## Task 3 — `LineRow.tsx`: lock out Clock In when clocked in elsewhere

3a. Prop. Anchor (exact, once):
```ts
  onClockIn: (jobId: string, line: string) => void;
```
Replace with:
```ts
  clockedInElsewhere: boolean;
  onClockIn: (jobId: string, line: string) => void;
```

3b. Destructure. Anchor (exact, once):
```ts
  acting,
  onClockIn,
```
Replace with:
```ts
  acting,
  clockedInElsewhere,
  onClockIn,
```

3c. Disable the Clock In button. Anchor (exact, once):
```tsx
          {!lineObj.open_session_id && (
            <button
              type="button"
              disabled={acting}
              onClick={() => onClockIn(jobId, lineObj.line)}
```
Replace with:
```tsx
          {!lineObj.open_session_id && (
            <button
              type="button"
              disabled={acting || clockedInElsewhere}
              title={
                clockedInElsewhere
                  ? "Finish your current line before clocking into another."
                  : undefined
              }
              onClick={() => onClockIn(jobId, lineObj.line)}
```

## Task 4 — `CuttingBoard.tsx`

4a. Surface the 409. Anchor (exact, once):
```ts
      } else if (data.error === "line_busy") {
        showToast(`${line} is already in use by ${data.operator}.`, false);
      } else {
```
Replace with:
```ts
      } else if (data.error === "line_busy") {
        showToast(`${line} is already in use by ${data.operator}.`, false);
      } else if (data.error === "already_clocked_in") {
        showToast(`Finish your current line (${data.line}) before clocking into another.`, false);
      } else {
```

4b. Drop the `checklistLine` state (keep `checklistBusy`). Anchor (exact, once):
```ts
  const [checklistLine, setChecklistLine] = useState<string | null>(null);
  const [checklistBusy, setChecklistBusy] = useState(false);
```
Replace with:
```ts
  const [checklistBusy, setChecklistBusy] = useState(false);
```

4c. Replace the default-line effect + toggle with the open-session derivation + line-aware toggle.
Anchor (exact, once):
```ts
  // Default the checklist to the operator's open line, else the first required line.
  useEffect(() => {
    if (!selectedJob) {
      setChecklistLine(null);
      return;
    }
    const openLine = selectedJob.lines.find((l) => l.open_session_id)?.line;
    setChecklistLine(openLine || selectedJob.requiredLines[0] || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId]);

  async function toggleChecklistItem(lineItemId: string, completed: boolean) {
    if (!selectedJob || !checklistLine) return;
    setChecklistBusy(true);
    try {
      const res = await fetch("/v2/api/cutting/line-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: selectedJob.id,
          line: checklistLine,
          line_item_id: lineItemId,
          completed,
        }),
      });
      const data = await res.json();
      if (!data.ok) showToast(data.error || "Failed to update.", false);
      await fetchQueue(true);
    } catch {
      showToast("Network error.", false);
    } finally {
      setChecklistBusy(false);
    }
  }
```
Replace with:
```ts
  // The operator's current open session across the whole board (one max — enforced server-side).
  const myOpen = (() => {
    for (const j of queue) {
      const l = j.lines.find(
        (ln) => ln.open_session_id && ln.open_operator_name === userName
      );
      if (l) return { jobId: j.id, line: l.line };
    }
    return null;
  })();
  // The line whose checklist the sidebar shows — only when clocked into THIS job.
  const myLineOnJob =
    myOpen && selectedJob && myOpen.jobId === selectedJob.id ? myOpen.line : null;

  async function toggleChecklistItem(line: string, lineItemId: string, completed: boolean) {
    if (!selectedJob) return;
    setChecklistBusy(true);
    try {
      const res = await fetch("/v2/api/cutting/line-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: selectedJob.id, line, line_item_id: lineItemId, completed }),
      });
      const data = await res.json();
      if (!data.ok) showToast(data.error || "Failed to update.", false);
      await fetchQueue(true);
    } catch {
      showToast("Network error.", false);
    } finally {
      setChecklistBusy(false);
    }
  }
```

4d. Rebuild the detail body as lines + docked sidebar. Anchor (exact, once):
```tsx
              {/* Per-line parts checklist (docked) + line rows */}
              <div className="flex-1 overflow-y-auto">
                {checklistLine && (
                  <div className="p-2 pb-0">
                    <PartsPanel
                      job={selectedJob}
                      line={checklistLine}
                      requiredLines={selectedJob.requiredLines}
                      onSelectLine={setChecklistLine}
                      onToggle={toggleChecklistItem}
                      busy={checklistBusy}
                    />
                  </div>
                )}
                {selectedJob.lines.map((lineObj) => (
                  <LineRow
                    key={lineObj.line}
                    lineObj={lineObj}
                    jobId={selectedJob.id}
                    userName={userName}
                    acting={acting}
                    onClockIn={clockIn}
                    onClockOut={openClockOut}
                    onComplete={completeLine}
                    now={now}
                  />
                ))}
              </div>
```
Replace with:
```tsx
              {/* Line rows + docked parts sidebar (sidebar only once clocked into this job) */}
              <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
                <div className="md:flex-1 md:overflow-y-auto">
                  {selectedJob.lines.map((lineObj) => (
                    <LineRow
                      key={lineObj.line}
                      lineObj={lineObj}
                      jobId={selectedJob.id}
                      userName={userName}
                      acting={acting}
                      clockedInElsewhere={
                        !!myOpen &&
                        !(myOpen.jobId === selectedJob.id && myOpen.line === lineObj.line)
                      }
                      onClockIn={clockIn}
                      onClockOut={openClockOut}
                      onComplete={completeLine}
                      now={now}
                    />
                  ))}
                </div>

                {myLineOnJob && (
                  <aside className="shrink-0 md:w-80 border-t md:border-t-0 md:border-l border-border md:overflow-y-auto">
                    <PartsPanel
                      job={selectedJob}
                      line={myLineOnJob}
                      onToggle={(itemId, completed) =>
                        toggleChecklistItem(myLineOnJob, itemId, completed)
                      }
                      busy={checklistBusy}
                    />
                  </aside>
                )}
              </div>
```

---

## Build verification (MANDATORY — loop until green)
```
cd cutting-pilot
npx tsc --noEmit
npx opennextjs-cloudflare build
```
After 4b/4c there must be **no remaining references** to `checklistLine` / `setChecklistLine` in
`CuttingBoard.tsx`. `useEffect` stays imported (still used by the initial fetch + the time tick). Do
not hand back a non-building tree.

> No migration this prompt. Live validation (the per-user 409, sidebar appearing only after clock-in)
> is Steve's on-host check; local build green is the handoff bar.

## BACKLOG.md / CHANGELOG.md (same commit)

**CHANGELOG.md** — top of **Manufacturing / Cutting (React pilot)**:
> - **P220** — Cutting v2 parts checklist moved into a docked right sidebar (md:w-80, border-l; stacks
>   on narrow) beside the line rows — no overlay. The sidebar shows only once the operator is clocked
>   into the job, and only their clocked-in line (line tabs/selector removed; `PartsPanel` simplified
>   to a single line). Enforced one-open-session-per-user: clock-in route 409s `already_clocked_in`
>   (returns the line in use) if the operator has any open session; `LineRow` disables Clock In on
>   every other line with a reason tooltip; `CuttingBoard` derives the user's open session across the
>   queue. `tsc --noEmit` + `cf-build` green.

**BACKLOG.md** — under **Manufacturing / Cutting (React pilot)**: remove the prior docked-checklist /
line-tab item if listed. (The clock-out qty reconciliation item from P219 stays open.)

## Out of scope
- No line tabs / multi-line checklist; no migration; no qty entry (still the separate later prompt).
- No legacy-module edits.
