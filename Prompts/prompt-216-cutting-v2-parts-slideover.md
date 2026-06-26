# Prompt 215 — Cutting v2: Parts slide-over on job select (+ reusable `<SlideOver>`)

## Agents
**Lead: React Component Agent (§9b)** — reusable `<SlideOver>` primitive, `<PartsPanel>`, and
`CuttingBoard.tsx` wiring.
**Coordinate with Next/Cloudflare Platform Agent (§9a)** for ONE backend touch: adding `line_items`
to the queue payload (`/v2/api/cutting/queue`).

## Required reading (both, before any edit)
- `AGENTS.md`
- `xpanda-ops-agents.md` — §9b and §9a (migration surface only; tokens-only; no hardcoded hex;
  build-must-be-green).
- `agent-react-component.md` — reusable components (the slide-over is a primitive, not a one-off),
  tokens-only, 44px targets, mobile-first, lucide icons, designed empty states.

## Context
Per-user we only ever cut one job at a time, so the board centers a single job in focus. Selecting a
job should surface its **parts + quantities** in a right-side panel. This prompt adds that panel.

Data source confirmed: the legacy `job_line_items` table (`part_number`, `description`, `quantity`,
`dimensions`, `sort_order`) — shared D1, already populated by the job board. The v2 queue route
batch-fetches it for the queued jobs (same `WHERE job_id IN (...)` + map pattern it already uses for
`cutting_lines`).

## Scope decisions (LOCKED)
- **Separate right slide-over on ALL breakpoints** — a NEW reusable `<SlideOver>` primitive
  (right-anchored, scrim + Escape + close). Distinct from `<Sheet>` (which becomes a static side
  column on md+ and holds the cutting lines). Lines stay where they are; parts are their own overlay.
- **Opens on job select**, closes on deselect; re-openable via a **"Parts (N)"** button in the detail
  header.
- **Single-job-per-user is UX framing only** — NO clock-in enforcement, NO route change for it. Do
  not add a "you already have an open session" guard in this prompt.
- **Blocks / chunks required** = reserved **placeholder** section in the panel (same pattern as the
  P214 scrap stub). It fills in later once the block-calculator BOM feeds `cutting_lines.qty_target`.
- Backend change is limited to adding `line_items` to the queue payload. No migration, no new route,
  no middleware change.

## Scope (files)
Migration surface ONLY: `cutting-pilot/`.
- **NEW:** `src/components/SlideOver.tsx` (reusable right-anchored slide-over)
- **NEW:** `src/app/cutting/PartsPanel.tsx` (consumes `<SlideOver>`; lists line items + placeholder)
- **EDIT:** `src/app/api/cutting/queue/route.ts` (§9a — add `line_items` to each job)
- **EDIT:** `src/app/cutting/types.ts` (`CuttingLineItem` + `line_items` on `CuttingJob`)
- **EDIT:** `src/app/cutting/CuttingBoard.tsx` (state, auto-open on select, Parts button, render panel)
Do NOT touch: `Sheet.tsx`, `Modal.tsx`, `HandoffModal.tsx`, `CompleteLineModal.tsx`, middleware,
other routes, build scripts, `globals.css`, `tailwind.config.ts`, any legacy module.

---

## Task 1 — NEW `src/components/SlideOver.tsx`

```tsx
"use client";
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

// Reusable right-anchored slide-over. Overlays from the right on ALL breakpoints
// (distinct from <Sheet>, which becomes a static side column on md+).
// Scrim, Escape, and the close button all dismiss.
export default function SlideOver({ isOpen, onClose, title, children }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  return (
    <>
      {isOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={[
          "fixed inset-y-0 right-0 z-[56] w-full sm:max-w-sm bg-surface border-l border-border",
          "flex flex-col overflow-hidden",
          "transition-transform duration-200 motion-reduce:transition-none",
          isOpen ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
        style={{ boxShadow: "var(--shadow-md)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="font-semibold text-sm text-text truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] text-muted hover:text-text rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
```

## Task 2 — NEW `src/app/cutting/PartsPanel.tsx`

```tsx
"use client";
import SlideOver from "@/components/SlideOver";
import type { CuttingJob } from "./types";

interface Props {
  job: CuttingJob | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PartsPanel({ job, isOpen, onClose }: Props) {
  const items = job?.line_items ?? [];

  return (
    <SlideOver isOpen={isOpen} onClose={onClose} title={job ? `Parts — ${job.customer}` : "Parts"}>
      {job && (
        <p className="px-4 py-2 border-b border-border font-mono tabular-nums text-xs text-muted shrink-0">
          {job.invoice_number}
          {job.po_number ? ` · PO ${job.po_number}` : ""}
        </p>
      )}

      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No line items on this job.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it, i) => (
            <li key={i} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {it.part_number && (
                    <p className="font-mono text-sm text-text">{it.part_number}</p>
                  )}
                  {it.description && (
                    <p className="text-sm text-muted mt-0.5 break-words">{it.description}</p>
                  )}
                  {it.dimensions && (
                    <p className="text-xs text-muted mt-0.5">{it.dimensions}</p>
                  )}
                </div>
                <span className="shrink-0 font-mono tabular-nums text-sm font-semibold text-text">
                  {it.quantity ?? "—"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Blocks / chunks required — reserved placeholder (fills once block-calc BOM feeds qty_target) */}
      <div className="m-4 rounded border border-dashed border-border px-3 py-3 opacity-70">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Blocks / chunks required — coming soon
        </span>
        <p className="text-xs text-muted mt-1">
          Specific blocks and cut chunks will list here once the block-calculator BOM is wired.
        </p>
      </div>
    </SlideOver>
  );
}
```

## Task 3 — `types.ts`: add the line-item type + field

3a. Anchor (exact, once):
```tsx
export interface CuttingJob {
```
Replace with:
```tsx
export interface CuttingLineItem {
  part_number: string;
  description: string;
  quantity: number | null;
  dimensions: string;
}

export interface CuttingJob {
```

3b. Anchor (exact, once):
```tsx
  lines: CuttingLine[];
```
Replace with:
```tsx
  lines: CuttingLine[];
  line_items: CuttingLineItem[];
```

## Task 4 — `queue/route.ts` (§9a): include line items

4a. Anchor (exact, once):
```tsx
    const queue = jobs.map((job: any) => {
```
Insert IMMEDIATELY BEFORE it:
```tsx
    // Line items (parts + qty) for each job — for the Parts slide-over.
    // jobIds + placeholders are already in scope from the lines/sessions queries above.
    const lineItemRows = await DB.prepare(
      `SELECT job_id, part_number, description, quantity, dimensions
       FROM job_line_items
       WHERE job_id IN (${placeholders})
       ORDER BY job_id, sort_order ASC`
    ).bind(...jobIds).all<any>();

    const lineItemsByJob = new Map<string, any[]>();
    for (const row of (lineItemRows.results || [])) {
      if (!lineItemsByJob.has(row.job_id)) lineItemsByJob.set(row.job_id, []);
      lineItemsByJob.get(row.job_id)!.push({
        part_number: row.part_number || "",
        description: row.description || "",
        quantity: row.quantity ?? null,
        dimensions: row.dimensions || "",
      });
    }

```

4b. Anchor (exact, once):
```tsx
      return { ...job, lines };
```
Replace with:
```tsx
      return { ...job, lines, line_items: lineItemsByJob.get(job.id) || [] };
```

## Task 5 — `CuttingBoard.tsx` wiring

5a. Import. Anchor (once):
```tsx
import CompleteLineModal from "./CompleteLineModal";
```
Insert AFTER it:
```tsx
import PartsPanel from "./PartsPanel";
```

5b. Add `Package` icon. Anchor (once):
```tsx
import { AlertCircle, Search, X } from "lucide-react";
```
Replace with:
```tsx
import { AlertCircle, Search, X, Package } from "lucide-react";
```

5c. State. Anchor (once):
```tsx
  const [showAll, setShowAll] = useState(false);
```
Insert AFTER it:
```tsx
  const [partsOpen, setPartsOpen] = useState(false);
```

5d. Auto-open parts on job select. Anchor (exact 3-line block, once):
```tsx
              onClick={() =>
                setSelectedJobId((prev) => (prev === job.id ? null : job.id))
              }
```
Replace with:
```tsx
              onClick={() => {
                const next = selectedJobId === job.id ? null : job.id;
                setSelectedJobId(next);
                setPartsOpen(next !== null);
              }}
```

5e. "Parts (N)" re-open button in the detail header. Anchor (exact, once):
```tsx
                  {/* Dismiss handle — narrow only; md+ has no sheet close affordance */}
```
Insert IMMEDIATELY BEFORE it:
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
```

5f. Render the panel. Anchor (exact, once):
```tsx
      {/* Mark-complete modal */}
```
Insert IMMEDIATELY BEFORE it:
```tsx
      {/* Parts slide-over — opens on job select */}
      <PartsPanel
        job={selectedJob}
        isOpen={partsOpen && !!selectedJob}
        onClose={() => setPartsOpen(false)}
      />

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
> - **P215** — Cutting v2 Parts slide-over: selecting a job opens a right-anchored slide-over listing
>   its parts (part #, description, dimensions, qty) from `job_line_items`, re-openable via a
>   "Parts (N)" header button. New reusable `<SlideOver>` primitive (right-anchored on all
>   breakpoints, scrim/Escape/close — distinct from `<Sheet>`). Queue payload (`/v2/api/cutting/queue`)
>   batch-fetches `line_items` per job (existing IN-list + map pattern; no migration). "Blocks /
>   chunks required" rendered as a reserved placeholder pending block-calculator BOM wiring.
>   Single-job-per-user kept as UX framing (no clock-in enforcement). `tsc --noEmit` + `cf-build` green.

**BACKLOG.md** — under **Manufacturing / Cutting (React pilot)**:
- Remove (now shipped): the "Read-only parts list surface under /v2/cutting" item added in P214, if
  present (this delivers it). If the wording differs, leave it and note the slide-over supersedes it.
- Add: `[ ] Wire "Blocks / chunks required" in the Parts slide-over once block-calculator BOM feeds cutting_lines.qty_target`

## Out of scope
- No clock-in/single-job enforcement.
- No migration, no new route, no other queue/route changes beyond `line_items`.
- No edits to `Sheet.tsx` or any existing modal/component beyond the wiring above.
- No legacy-module edits.
