# Prompt 219 — Cutting v2: dock the parts sidebar + per-line completion checklist

> Modifies the **shipped** P216 parts slide-over in place. Converts it from a hovering right
> slide-over into a **docked** panel at the top of the detail (coexists with the clock/complete
> buttons — nothing overlays) and into a **per-line checklist**: each cutting line tracks which parts
> it has completed, persisted. **Run the migration in D1 before deploying the worker.**
>
> Out of scope (separate later prompt, your number): the clock-out reconciliation that forces a
> quantity for any unchecked item.

## Agents
**Lead: React Component Agent (§9b)** — repurpose `PartsPanel`, rewire `CuttingBoard`.
**Next/Cloudflare Platform Agent (§9a)** — migration, progress route, queue payload.

## Required reading (both)
- `AGENTS.md`; `xpanda-ops-agents.md` §9a/§9b; `agent-react-component.md`.
- Constraints: migration surface only; tokens-only; no hardcoded hex; build-must-be-green; operator
  identity from middleware `X-User-*` headers, never the client body.

## Domain note (drives the design)
Each cutting line processes the order differently: Cross Cutter cuts blocks into **chunks**, Hole
Cutter drills those chunks, Main Line / Blue Line slice chunks to height = the actual ordered parts,
Laminate laminates. So completion is tracked **per (job, cutting line, part)** — a matrix, one
checklist per line. We only have part line-items today (no chunk counts — that's the block-calc BOM,
not wired), so **every line shows the same parts checklist for now**; the chunk placeholder stays.

## Scope decisions (LOCKED)
- **Docked, not overlay.** Remove the `SlideOver` usage / auto-open / "Parts (N)" button. Render the
  panel inline at the **top of the detail, above the line rows**, inside the existing scroll area.
- **Per-line checklist.** New `cutting_line_progress` table keyed UNIQUE (job_id, line, line_item_id),
  `completed` flag (+ `completed_qty` column reserved for the later clock-out reconciliation).
- **Line selector** in the panel (the job's required lines); defaults to the operator's open
  (clocked-in) line, else the first required line.
- Toggling a checkbox upserts progress and refetches. No qty entry in this prompt.
- `SlideOver.tsx` is left in place (reusable primitive) but is no longer used by cutting.

## Scope (files)
- **NEW:** `DB_Migrations/add-cutting-line-progress.sql`
- **NEW:** `cutting-pilot/src/app/api/cutting/line-item/route.ts`
- **EDIT:** `cutting-pilot/src/app/cutting/PartsPanel.tsx` (full rewrite → docked checklist)
- **EDIT:** `cutting-pilot/src/app/api/cutting/queue/route.ts` (line-item `id` + progress)
- **EDIT:** `cutting-pilot/src/app/cutting/types.ts` (`CuttingLineItem.id`, `CuttingJob.progress`)
- **EDIT:** `cutting-pilot/src/app/cutting/CuttingBoard.tsx` (drop slide-over wiring, dock the panel)

---

## Task 1 — NEW `DB_Migrations/add-cutting-line-progress.sql`
```sql
-- add-cutting-line-progress.sql
-- Per (job, cutting line, part line-item) checklist progress for the v2 cutting board.
-- Each cutting line tracks its own completion of each part on the order.
-- MANUAL STEP: run in the Cloudflare D1 Dashboard Console before deploying the worker.
CREATE TABLE IF NOT EXISTS cutting_line_progress (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL,
  line          TEXT NOT NULL,
  line_item_id  TEXT NOT NULL,
  completed     INTEGER NOT NULL DEFAULT 0,
  completed_qty INTEGER,
  updated_by    TEXT,
  updated_at    TEXT,
  UNIQUE (job_id, line, line_item_id)
);
CREATE INDEX IF NOT EXISTS idx_clp_job ON cutting_line_progress (job_id);
```

## Task 2 — NEW `src/app/api/cutting/line-item/route.ts`
```ts
// POST /v2/api/cutting/line-item — set checklist completion for one (job, line, line_item).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    const operatorName = request.headers.get("X-User-Name") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { job_id, line, line_item_id, completed } = body ?? {};
    if (!job_id || !line || !line_item_id || typeof completed !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "job_id, line, line_item_id, completed are required." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    await DB.prepare(
      `INSERT INTO cutting_line_progress
         (id, job_id, line, line_item_id, completed, completed_qty, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT (job_id, line, line_item_id)
       DO UPDATE SET completed = excluded.completed,
                     updated_by = excluded.updated_by,
                     updated_at = excluded.updated_at`
    ).bind(crypto.randomUUID(), job_id, line, line_item_id, completed ? 1 : 0, operatorId, now).run();

    await DB.prepare(
      `INSERT INTO activity_log
         (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
       VALUES (?, ?, 'update', 'cutting_line_progress', ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      now,
      line_item_id,
      `${operatorName} ${completed ? "checked" : "unchecked"} a part on ${line}`,
      JSON.stringify({ job_id, line, line_item_id, completed }),
      operatorId,
      now
    ).run();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
```

## Task 3 — `PartsPanel.tsx` (full rewrite → docked per-line checklist)
Replace the ENTIRE file with:
```tsx
"use client";
import type { CuttingJob } from "./types";

interface Props {
  job: CuttingJob;
  line: string;
  requiredLines: string[];
  onSelectLine: (line: string) => void;
  onToggle: (lineItemId: string, completed: boolean) => void;
  busy: boolean;
}

// Docked per-line parts checklist (no overlay). Each cutting line tracks its own completion of
// each part on the order. Cross Cutter / Hole Cutter really work in chunks; until the block-calc
// BOM is wired, every line shows the same parts list and the chunk note below stands in.
export default function PartsPanel({
  job,
  line,
  requiredLines,
  onSelectLine,
  onToggle,
  busy,
}: Props) {
  const items = job.line_items ?? [];
  const prog = job.progress?.[line] ?? {};
  const doneCount = items.filter((it) => prog[it.id]?.completed).length;

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-3">
      {/* Line selector */}
      <div className="flex overflow-x-auto border-b border-border bg-[var(--ghost-bg)]">
        {requiredLines.map((ln) => (
          <button
            key={ln}
            type="button"
            onClick={() => onSelectLine(ln)}
            aria-pressed={ln === line}
            className={[
              "shrink-0 px-3 min-h-[44px] text-xs font-semibold border-b-2 cursor-pointer whitespace-nowrap",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]",
              ln === line
                ? "border-[var(--accent)] text-text"
                : "border-transparent text-muted hover:text-text",
            ].join(" ")}
          >
            {ln}
          </button>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {line} — parts
        </span>
        <span className="font-mono tabular-nums text-xs text-muted">
          {doneCount}/{items.length}
        </span>
      </div>

      {/* Checklist */}
      {items.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted">No parts on this order.</p>
      ) : (
        <ul className="divide-y divide-border max-h-72 overflow-y-auto">
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
                      <span
                        className={`text-sm ${checked ? "text-muted line-through" : "text-text"}`}
                      >
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

      {/* Blocks / chunks required — reserved placeholder (fills once block-calc BOM feeds qty_target) */}
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

## Task 4 — `queue/route.ts`

4a. Carry the line-item `id`. Anchor (exact, once):
```ts
      `SELECT job_id, part_number, description, quantity, dimensions
```
Replace with:
```ts
      `SELECT id, job_id, part_number, description, quantity, dimensions
```

4b. Emit `id` in the mapped item. Anchor (exact, once):
```ts
      lineItemsByJob.get(row.job_id)!.push({
        part_number: row.part_number || "",
```
Replace with:
```ts
      lineItemsByJob.get(row.job_id)!.push({
        id: row.id,
        part_number: row.part_number || "",
```

4c. Load progress and attach it per job (rides the `{ ...job }` spread). Anchor (exact, once):
```ts
    const queue = jobs.map((job: any) => {
```
Insert IMMEDIATELY BEFORE it:
```ts
    // Per-line checklist progress: (job, line, line_item) → completed (+ qty, reserved).
    const progressRows = await DB.prepare(
      `SELECT job_id, line, line_item_id, completed, completed_qty
       FROM cutting_line_progress
       WHERE job_id IN (${placeholders})`
    ).bind(...jobIds).all<any>();

    const progressByJob = new Map<
      string,
      Record<string, Record<string, { completed: boolean; completed_qty: number | null }>>
    >();
    for (const row of (progressRows.results || [])) {
      if (!progressByJob.has(row.job_id)) progressByJob.set(row.job_id, {});
      const byLine = progressByJob.get(row.job_id)!;
      if (!byLine[row.line]) byLine[row.line] = {};
      byLine[row.line][row.line_item_id] = {
        completed: !!row.completed,
        completed_qty: row.completed_qty ?? null,
      };
    }
    for (const job of jobs) {
      (job as any).progress = progressByJob.get(job.id) || {};
    }

```

## Task 5 — `types.ts`

5a. Line-item id. Anchor (exact, once):
```ts
export interface CuttingLineItem {
  part_number: string;
```
Replace with:
```ts
export interface CuttingLineItem {
  id: string;
  part_number: string;
```

5b. Job progress. Anchor (exact, once):
```ts
  line_items: CuttingLineItem[];
```
Replace with:
```ts
  line_items: CuttingLineItem[];
  progress: Record<string, Record<string, { completed: boolean; completed_qty: number | null }>>;
```

## Task 6 — `CuttingBoard.tsx`

6a. Drop the unused `Package` icon (the "Parts (N)" button is removed in 6d). Anchor (exact, once):
```ts
import { AlertCircle, Search, X, Package } from "lucide-react";
```
Replace with:
```ts
import { AlertCircle, Search, X } from "lucide-react";
```

6b. Swap slide-over state for checklist state. Anchor (exact, once):
```ts
  const [partsOpen, setPartsOpen] = useState(false);
```
Replace with:
```ts
  const [checklistLine, setChecklistLine] = useState<string | null>(null);
  const [checklistBusy, setChecklistBusy] = useState(false);
```

6c. Default the checklist line + toggle handler. Anchor (exact, once):
```ts
  const jobTotalSeconds = selectedJob
    ? selectedJob.lines.reduce((sum, l) => sum + lineLiveSeconds(l, now), 0)
    : 0;
```
Insert IMMEDIATELY AFTER it:
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

6d. Stop auto-opening the (removed) slide-over on job select. Anchor (exact, once):
```tsx
              onClick={() => {
                const next = selectedJobId === job.id ? null : job.id;
                setSelectedJobId(next);
                setPartsOpen(next !== null);
              }}
```
Replace with:
```tsx
              onClick={() => {
                setSelectedJobId((prev) => (prev === job.id ? null : job.id));
              }}
```

6e. Remove the "Parts (N)" re-open button (keep the dismiss handle). Anchor (exact, once):
```tsx
                  {/* Parts slide-over re-open */}
                  <button
                    type="button"
                    onClick={() => setPartsOpen(true)}
                    className="ml-auto shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1.5 rounded-lg border border-border bg-[var(--ghost-bg)] text-text text-xs font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <Package size={14} aria-hidden="true" />
                    Parts ({selectedJob.line_items.length})
                  </button>
                  {/* Dismiss handle — narrow only; md+ has no sheet close affordance */}
```
Replace with:
```tsx
                  {/* Dismiss handle — narrow only; md+ has no sheet close affordance */}
```

6f. Dock the checklist above the line rows. Anchor (exact, once):
```tsx
              {/* Line rows */}
              <div className="flex-1 overflow-y-auto">
                {selectedJob.lines.map((lineObj) => (
```
Replace with:
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
```

6g. Remove the old slide-over render. Anchor (exact, once):
```tsx
      {/* Parts slide-over — opens on job select */}
      <PartsPanel
        job={selectedJob}
        isOpen={partsOpen && !!selectedJob}
        onClose={() => setPartsOpen(false)}
      />

```
Replace with: (nothing — delete the block, including the trailing blank line)

---

## Build verification (MANDATORY — loop until green)
```
cd cutting-pilot
npx tsc --noEmit
npx opennextjs-cloudflare build
```
Both must pass. `PartsPanel` import in `CuttingBoard` stays (still used, now docked). After 6a/6e,
`Package` must be gone from the file. Do not hand back a non-building tree.

## Manual step
Run `DB_Migrations/add-cutting-line-progress.sql` in the Cloudflare D1 Console **before** deploying.

## BACKLOG.md / CHANGELOG.md (same commit)

**CHANGELOG.md** — top of **Manufacturing / Cutting (React pilot)**:
> - **P219** — Cutting v2 parts sidebar reworked from a hovering slide-over into a **docked per-line
>   checklist** at the top of the detail (coexists with the clock/complete buttons; no overlay).
>   Each cutting line tracks its own completion of each part: new `cutting_line_progress` table
>   (UNIQUE job/line/line_item; `completed` + reserved `completed_qty`), upsert route
>   `POST /v2/api/cutting/line-item`, queue payload carries line-item `id` + a per-line `progress`
>   map. Line selector defaults to the operator's open line. `PartsPanel` repurposed; slide-over
>   wiring (`partsOpen`, auto-open, "Parts (N)" button, `Package` import) removed; `SlideOver`
>   primitive retained but unused by cutting. Same parts list across all lines for now (chunk counts
>   pending BOM). `tsc --noEmit` + `cf-build` green. **Migration run required.**

**BACKLOG.md** — under **Manufacturing / Cutting (React pilot)**, add:
- `[ ] Clock-out reconciliation: at clock-out, any unchecked checklist item on that line requires a quantity completed (even 0) → write completed_qty on cutting_line_progress`
- `[ ] Cross Cutter / Hole Cutter chunk checklists (replace the shared parts list) once block-calc BOM feeds chunk counts`

## Out of scope
- No qty entry / clock-out reconciliation (next prompt).
- No chunk-level checklist; no removal of `SlideOver.tsx`.
- No legacy-module edits.
