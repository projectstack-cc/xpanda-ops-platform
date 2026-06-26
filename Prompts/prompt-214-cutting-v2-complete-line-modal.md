# Prompt 214 — Cutting v2: custom `<CompleteLineModal>` (replaces `window.confirm`) + scrap placeholder

## Agents
**Lead: React Component Agent (§9b)** — new modal component + wiring in `CuttingBoard.tsx`.
No backend work: the existing `POST /v2/api/cutting/complete-line` route already accepts an optional
`handoff_note`, so there is **no route, SQL, migration, or middleware change** in this prompt.

## Required reading (both, before any edit)
- `AGENTS.md`
- `xpanda-ops-agents.md` — §9b (React Component Agent) and §9a (constraints you must not violate:
  migration surface only, tokens-only, no hardcoded hex, build-must-be-green).
- `agent-react-component.md` — reusable-component discipline, tokens-only, 44px targets, mobile-first,
  lucide icons, designed states. The new modal MUST compose the existing `<Modal>` primitive — do NOT
  hand-roll a second dialog.

## Context
The v2 cutting operator loop is live (P198/P206/P209–P213). "Mark Complete" on a cutting line still
fires a **native `window.confirm`** (`CuttingBoard.tsx`, in `completeLine`). This prompt replaces that
with a real, tokenized `<CompleteLineModal>` — the clean, simple cut Steve scoped first.

This modal is also the eventual home for **scrap** and **material-consumption** capture, but neither
is wired here:
- **Scrap** is rendered as a clearly-marked, **disabled placeholder** section (it anticipates the
  field set Steve chose: cubic-in + reason + shift + density). Real persistence is deferred to a new
  **native scrap-database project** (we are moving off the Google-Sheets mirror — see Backlog below).
- **Material consumption** is not in this modal at all yet (no job→`block_inventory` linkage exists;
  `block_consumption_log` decrements real inventory and needs a picker — separate prompt).

**Laminate carries NO scrap option** (the QC `scrap_log` `line_machine` enum has no Laminate, and
Steve confirmed Laminate gets no scrap capture). So the placeholder section is **hidden when the line
is `"Laminate"`**.

## Scope decisions (LOCKED)
- Replace `window.confirm` in `completeLine` with `<CompleteLineModal>` composing `<Modal>`.
- The modal collects: confirmation + **optional completion note** (sent as `handoff_note` to the
  existing route — the route already stores it on the closing session).
- Scrap = **disabled placeholder only** (no state persistence, no fetch, no route change). Hidden on
  Laminate. Label it plainly as not-yet-active so no one thinks scrap is being saved.
- Consumption = out of scope this prompt.
- Frontend-only. No route/handler/SQL/migration/middleware/build-script/tailwind.config/globals.css
  change. Do NOT touch any legacy module.

## Scope (files)
Migration surface ONLY: `cutting-pilot/`.
- **NEW:** `src/app/cutting/CompleteLineModal.tsx`
- **EDIT:** `src/app/cutting/CuttingBoard.tsx` (state + split `completeLine` into opener/submit +
  render the modal)
Do NOT touch: `LineRow.tsx` (its `onComplete(jobId, line)` contract is unchanged), `Modal.tsx`
(consume it), routes, middleware, `types.ts`, build scripts, `globals.css`, `tailwind.config.ts`.

---

## Task 1 — NEW `src/app/cutting/CompleteLineModal.tsx`

Mirror the structure/styling of `HandoffModal.tsx` (same token classes, 44px targets, button layout).
Full file:

```tsx
"use client";
import { useState, useEffect } from "react";
import { Lock } from "lucide-react";
import Modal from "@/components/Modal";

interface Props {
  lineLabel: string;
  customer: string;
  invoice: string;
  isLaminate: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
  acting: boolean;
}

export default function CompleteLineModal({
  lineLabel,
  customer,
  invoice,
  isLaminate,
  isOpen,
  onClose,
  onSubmit,
  acting,
}: Props) {
  const [note, setNote] = useState("");

  useEffect(() => {
    if (isOpen) setNote("");
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Mark Complete — ${lineLabel}`}>
      <div className="space-y-4">
        {/* Confirmation context */}
        <p className="text-sm text-muted">
          Completing <span className="font-medium text-text">{lineLabel}</span> for{" "}
          <span className="font-medium text-text">{customer}</span>
          <span className="font-mono tabular-nums"> · {invoice}</span>. This marks the line done; when
          every required line is complete the job is marked done. This cannot be undone.
        </p>

        {/* Optional completion note (stored as the closing session's handoff note) */}
        <div>
          <label htmlFor="complete-note" className="block text-sm font-medium text-text mb-1">
            Completion note
            <span className="ml-1 text-xs text-muted font-normal">(optional)</span>
          </label>
          <textarea
            id="complete-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Anything the next step should know about this finished line."
            className="w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
          />
        </div>

        {/* Scrap — DISABLED PLACEHOLDER. Not wired; hidden on Laminate. */}
        {!isLaminate && (
          <div className="rounded border border-dashed border-border px-3 py-3 space-y-3 opacity-70">
            <div className="flex items-center gap-2">
              <Lock size={13} className="text-muted shrink-0" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Scrap — coming soon
              </span>
            </div>
            <p className="text-xs text-muted">
              Waste logging moves here once the native scrap database ships. Not yet active.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <select
                disabled
                aria-hidden="true"
                tabIndex={-1}
                className="min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-muted px-2 text-sm cursor-not-allowed"
              >
                <option>Reason…</option>
              </select>
              <input
                disabled
                aria-hidden="true"
                tabIndex={-1}
                placeholder="Scrap (cubic in)"
                className="min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-muted px-2 text-sm cursor-not-allowed"
              />
              <select
                disabled
                aria-hidden="true"
                tabIndex={-1}
                className="min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-muted px-2 text-sm cursor-not-allowed"
              >
                <option>Shift…</option>
              </select>
              <input
                disabled
                aria-hidden="true"
                tabIndex={-1}
                placeholder="Material / density"
                className="min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-muted px-2 text-sm cursor-not-allowed"
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            disabled={acting}
            onClick={() => onSubmit(note)}
            className="flex-1 min-h-[44px] bg-[var(--success-bg)] text-[var(--success-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
          >
            {acting ? "Saving…" : "Mark Complete"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

## Task 2 — `CuttingBoard.tsx`: import the modal

Anchor (exact, appears once):
```tsx
import HandoffModal from "./HandoffModal";
```
Insert a new line immediately AFTER it:
```tsx
import CompleteLineModal from "./CompleteLineModal";
```

## Task 3 — `CuttingBoard.tsx`: add `completeTarget` state

Anchor (exact, appears once):
```tsx
  const [acting, setActing] = useState(false);
```
Insert immediately AFTER it:
```tsx
  const [completeTarget, setCompleteTarget] = useState<{
    jobId: string;
    line: string;
  } | null>(null);
```

## Task 4 — `CuttingBoard.tsx`: split `completeLine` into opener + submit

Replace the ENTIRE existing function (exact block, appears once):
```tsx
  async function completeLine(jobId: string, line: string) {
    if (!window.confirm(`Mark ${line} complete? This cannot be undone.`)) return;
    setActing(true);
    try {
      const res = await fetch("/v2/api/cutting/complete-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, line }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(
          data.all_lines_complete
            ? `${line} complete — all lines done, job marked done.`
            : `${line} marked complete.`
        );
        await fetchQueue(true);
      } else {
        showToast(data.error || "Failed.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }
```
with:
```tsx
  function completeLine(jobId: string, line: string) {
    setCompleteTarget({ jobId, line });
  }

  async function submitComplete(note: string) {
    if (!completeTarget) return;
    const { jobId, line } = completeTarget;
    setActing(true);
    try {
      const res = await fetch("/v2/api/cutting/complete-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, line, handoff_note: note }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(
          data.all_lines_complete
            ? `${line} complete — all lines done, job marked done.`
            : `${line} marked complete.`
        );
        setCompleteTarget(null);
        await fetchQueue(true);
      } else {
        showToast(data.error || "Failed.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }
```
> `LineRow`'s `onComplete={completeLine}` is unchanged — `completeLine(jobId, line)` now opens the
> modal instead of confirming.

## Task 5 — `CuttingBoard.tsx`: render the modal

Anchor (exact, appears once):
```tsx
      {/* Clock-out handoff modal */}
```
Insert immediately BEFORE that line:
```tsx
      {/* Mark-complete modal */}
      <CompleteLineModal
        lineLabel={completeTarget?.line ?? ""}
        customer={selectedJob?.customer ?? ""}
        invoice={selectedJob?.invoice_number ?? ""}
        isLaminate={completeTarget?.line === "Laminate"}
        isOpen={!!completeTarget}
        onClose={() => setCompleteTarget(null)}
        onSubmit={submitComplete}
        acting={acting}
      />

```
(`selectedJob` is already in scope above the return.)

---

## Build verification (MANDATORY — loop until green)
```
cd cutting-pilot
npx tsc --noEmit
npx opennextjs-cloudflare build
```
Both must pass before declaring done. Do NOT hand back a non-building tree.

## BACKLOG.md / CHANGELOG.md (same commit — platform rule)

**CHANGELOG.md** — add to the top of the **Manufacturing / Cutting (React pilot)** section:
> - **P214** — Cutting v2 custom `<CompleteLineModal>`: replaced the native `window.confirm` on Mark
>   Complete with a tokenized modal composing the `<Modal>` primitive (completion note sent as the
>   closing session's `handoff_note`; no route/SQL change). Scrap rendered as a disabled,
>   clearly-labeled placeholder (anticipates reason + cubic-in + shift + density), hidden on Laminate;
>   real persistence deferred to the native scrap-database project. Consumption out of scope. Mirrors
>   `HandoffModal` styling, 44px targets, tokens-only. `tsc --noEmit` + `cf-build` green.

**BACKLOG.md** — make these edits:

1. Under **Manufacturing / Cutting (React pilot)**, add:
   - `[ ] Wire scrap capture into <CompleteLineModal> once the native scrap DB lands (reason + cubic-in + shift + density; derive operator/inv/line/date from session+job; no Laminate scrap)`
   - `[ ] Material-consumption capture at line-complete — needs a job→block_inventory link + on-hand block picker (block_consumption_log decrements real stock)`
   - `[ ] Photo capture/upload at clock-out (R2; production-supervisor request)`
   - `[ ] Wire notifications into v2 cutting (depends on a v2 notification backend; triggers: job-done, andon/flag-for-help)`
   - `[ ] Read-only parts list surface under /v2/cutting → on-ramp to the cut list (cut list keys off cutting_lines.qty_target once block-calculator BOM feeds it)`

2. Add a NEW top-level section:
   ```
   ## Scrap Database (native — replaces Google Sheets) · SCOPED, SEPARATE PROJECT
   > Move scrap off the Google-Sheets mirror (`mirrorScrapLogToSheet`) onto a first-class platform
   > database. Becomes the persistence target for the v2 CompleteLineModal scrap section.
   - [ ] Design the native scrap schema/UI (own dashboard + entry); decide whether to extend the
         existing `scrap_log` table or supersede it
   - [ ] Add "Laminate" to the scrap line/machine options for cutting-floor capture (current QC enum
         omits it)
   - [ ] Retire the Google-Sheets mirror; migrate existing scrap_log consumers (QC scrap-log form,
         reports) to the native store
   - [ ] Wire v2 cutting CompleteLineModal scrap section to the native API
   ```

3. Add a NEW top-level section (the ERP add-ons Steve approved as backlog):
   ```
   ## Manufacturing ERP add-ons (icebox — fold in opportunistically)
   - [ ] Throughput / units-per-hour from cutting_sessions timestamps + qty_done_delta (near-free; no new capture)
   - [ ] Andon / flag-for-help button on a line → notifies supervisor (first real consumer of v2 notifications)
   - [ ] Downtime reason codes when a line stalls (material wait / changeover / machine) → OEE foundation
   - [ ] First-pass yield: qty_target vs qty_done vs scrap (after scrap DB + BOM wiring)
   - [ ] QR/barcode clock-in to a job (glove-friendly floor input)
   ```

## Out of scope (do NOT do)
- No scrap persistence, no scrap route, no `scrap_log` write, no Google-Sheets call.
- No material-consumption / `block_consumption_log` work.
- No changes to `complete-line/route.ts`, any other route, middleware, SQL, migrations, build scripts,
  `tailwind.config.ts`, or `globals.css`.
- No legacy-module edits.
