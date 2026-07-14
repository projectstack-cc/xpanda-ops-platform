# P242 — Cutting v2: manual chunk target (Cross Cutter → mirrored to Hole Cutter)

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` before touching anything.

- **§9a Next/Cloudflare Platform Agent** — owns the new route.
- **§9b React Component Agent** (lead — operator-facing) — owns `PartsPanel` + `CuttingBoard` wiring.

Migration surface only (`cutting-pilot/`). Do **not** touch legacy files or the worker.

## Context — the domain, so you don't design the wrong thing
A block is molded, then sent to the **Cross Cutter** to be broken into **chunks** — smaller,
manageable pieces (which also accelerates curing). Chunks then flow to the **Main Line** (all axes,
including angled taper cuts) and/or the **Blue Line** (horizontal wires only, height cuts). Routing
is a **supervisor decision and tribal knowledge**: the Main Line can chunk too, the Blue Line is
sometimes a third step and sometimes standalone for holey board.

**Therefore the chunk count is NOT derivable from geometry.** It is a *handling* decision (manageable
size + curing), not a math output. Do **not** attempt to derive it from `blockEngine`'s `nL/nW/nH`,
do **not** infer it from part dimensions, and do **not** add engine logic. The block calculator's job
is **blocks needed** — that already works. This prompt only pushes a **manually entered chunk count**
to the dashboard so the floor knows *how many chunks they're cutting out of how many blocks*.

### The slot already exists — do not invent a model
`cut_plan_lines` already has, per `(job_id, line)` (with a UNIQUE index on that pair):
- `unit` — already `'chunk'` for `Cross Cutter` / `Hole Cutter` (the `CHUNK_LINES` set in the queue
  route), `'part'` for the rest
- `qty_target` — already populated for **part** lines; deliberately left **NULL** for chunk lines
  (there is a comment in `queue/route.ts` saying exactly that)

`PartsPanel` currently renders a literal **"Chunks required — coming soon"** placeholder for those
lines. **This prompt fills that slot.** No new table, **no migration**.

## Scope — LOCKED
1. New route `POST /v2/api/cutting/chunk-target` — sets `cut_plan_lines.qty_target` for Cross Cutter,
   **mirroring the same value to Hole Cutter when Hole Cutter is a required line on that job.**
2. `PartsPanel` — replace the "coming soon" placeholder with a manual chunk-target input on the
   Cross Cutter, plus a **"N chunks out of M blocks"** readout (M = `job.blocks_needed`, already on
   the payload from P228).
3. **Taper jobs stay fully automatic.** Their Cross Cutter target is derived
   (`ceil(taper parts ÷ taper_yield)`, P227) and the existing yield editor keeps rendering. The
   manual input must **not** appear on a taper job's Cross Cutter, and the route must **refuse** to
   write one.
4. **Fabricator jobs** (Cross Cutter is the **only** required line — the block is cut down on all
   dimensions and never goes downstream): the target is still stored on the chunk line, but the UI
   **labels the unit "parts", not "chunks"**, because the Cross Cutter's output *is* the finished
   part. Display-only distinction — do not change `unit` in the database.

---

## Task 1 — New route
Create `cutting-pilot/src/app/api/cutting/chunk-target/route.ts`. Mirror
`taper-yield/route.ts` exactly in shape (identity from the middleware-injected `X-User-Id` header —
**never** from the client body; `getEnv()` inside the handler, never at module top level).

```ts
// POST /v2/api/cutting/chunk-target — set the manual Cross Cutter chunk target for a job, and
// mirror it to Hole Cutter when that line is required (Hole Cutter drills the same chunks).
// Chunk counts are a handling decision (manageable size / curing), not a geometry output — hence
// manual. Taper jobs are excluded: their Cross Cutter target is derived from taper_yield (P227).
// Identity gated by the middleware-injected X-User-Id header (never client-trusted).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const jobId = body?.job_id;
    const qty = Number(body?.qty_target);
    if (!jobId || !Number.isInteger(qty) || qty < 1 || qty > 10000) {
      return NextResponse.json(
        { ok: false, error: "job_id and an integer qty_target (1–10000) are required." },
        { status: 400 }
      );
    }

    // Taper jobs derive their Cross Cutter target from taper_yield — refuse to overwrite it.
    const plan = await DB.prepare(
      `SELECT taper_pair FROM cut_plan_lines WHERE job_id = ? AND line = 'Cross Cutter'`
    ).bind(jobId).first<any>();
    if (plan?.taper_pair) {
      return NextResponse.json(
        { ok: false, error: "Taper jobs derive their chunk target from yield. Set the yield instead." },
        { status: 409 }
      );
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    // Cross Cutter always gets the target. Hole Cutter mirrors it ONLY if that line already exists
    // for this job (i.e. it is a required line) — never create a Hole Cutter row that isn't routed.
    await DB.prepare(
      `UPDATE cut_plan_lines SET qty_target = ?, updated_at = ?
        WHERE job_id = ? AND line = 'Cross Cutter'`
    ).bind(qty, now, jobId).run();

    await DB.prepare(
      `UPDATE cut_plan_lines SET qty_target = ?, updated_at = ?
        WHERE job_id = ? AND line = 'Hole Cutter'`
    ).bind(qty, now, jobId).run();

    return NextResponse.json({ ok: true, job_id: jobId, qty_target: qty });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
```

**Why `UPDATE` and not upsert:** the queue GET already lazily creates a `cut_plan_lines` row for every
**required** line (`INSERT OR IGNORE`, chunk lines get `qty_target = NULL`). So the row exists iff the
line is routed. A bare `UPDATE` on Hole Cutter therefore **self-mirrors only when Hole Cutter is
actually a required line, and is a harmless no-op otherwise** — which is exactly the rule, achieved
without a `requiredLines` round-trip. Do **not** change these to `INSERT OR IGNORE` / upserts; that
would fabricate rows for lines the job doesn't route.

If `cut_plan_lines` has no `taper_pair` column in the current schema, read the taper flag the same way
`queue/route.ts` already determines `is_taper` and gate on that instead — but do **not** add a column
and do **not** write a migration.

## Task 2 — `PartsPanel`: props
File: `cutting-pilot/src/app/cutting/PartsPanel.tsx`

Anchor (verify `== 1`):
```
  onSetYield?: (yieldPerChunk: number) => void;
```
→
```
  onSetYield?: (yieldPerChunk: number) => void;
  onSetChunkTarget?: (qtyTarget: number) => void;
```
Add `onSetChunkTarget` to the destructured params in the `export default function PartsPanel({ … })`
signature as well.

## Task 3 — `PartsPanel`: replace the placeholder
File: `cutting-pilot/src/app/cutting/PartsPanel.tsx`

Replace the entire "coming soon" block. Anchor on its unique text (verify
`grep -Fc "                Chunks required — coming soon" …/PartsPanel.tsx == 1`) and replace the
whole `return (…)` it sits inside — the `<div className="m-3 rounded border border-dashed …">…</div>`
— with:

```tsx
          const isFabricator =
            line === "Cross Cutter" && (job.requiredLines?.length ?? 0) === 1;
          const unitWord = isFabricator ? "parts" : "chunks";
          const blocks = job.blocks_needed;

          if (line === "Cross Cutter") {
            return (
              <div className="m-3 rounded border border-border px-3 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {isFabricator ? "Parts to cut" : "Chunks to cut"}
                </span>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    placeholder="—"
                    defaultValue={lineRow.qty_target ?? ""}
                    disabled={busy}
                    aria-label={`${unitWord} to cut`}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (v > 0 && v !== lineRow.qty_target) onSetChunkTarget?.(v);
                    }}
                    className="w-24 min-h-[44px] rounded border border-border bg-surface px-2 py-1 font-mono tabular-nums text-sm text-text disabled:opacity-50"
                  />
                  <span className="text-xs text-muted">{unitWord}</span>
                </div>
                <p className="text-xs text-muted mt-2">
                  {lineRow.qty_target != null && blocks != null ? (
                    <>
                      <span className="font-mono tabular-nums text-sm text-text">
                        {lineRow.qty_target}
                      </span>{" "}
                      {unitWord} out of{" "}
                      <span className="font-mono tabular-nums text-sm text-text">{blocks}</span>{" "}
                      {blocks === 1 ? "block" : "blocks"}
                    </>
                  ) : blocks != null ? (
                    <>
                      <span className="font-mono tabular-nums text-sm text-text">{blocks}</span>{" "}
                      {blocks === 1 ? "block" : "blocks"} needed — set the {unitWord} count
                    </>
                  ) : (
                    <>Save a cut plan to see blocks needed.</>
                  )}
                </p>
              </div>
            );
          }

          // Hole Cutter: drills the chunks the Cross Cutter made — mirrors that target, read-only.
          return (
            <div className="m-3 rounded border border-border px-3 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Chunks to drill
              </span>
              <p className="font-mono tabular-nums text-sm text-text mt-1">
                {lineRow.qty_target ?? "—"}
              </p>
              {lineRow.qty_target == null && (
                <p className="text-xs text-muted mt-1">
                  Set on the Cross Cutter — this line mirrors it.
                </p>
              )}
            </div>
          );
```
Leave the **taper** branch (`if (job.is_taper && line === "Cross Cutter")`) exactly as it is and
**above** this code, so taper jobs still hit the yield editor and never reach the manual input.
Tokens only — no hardcoded hex. Input meets the 44px floor-touch minimum.

## Task 4 — `CuttingBoard`: handler + wiring
File: `cutting-pilot/src/app/cutting/CuttingBoard.tsx`

Add the handler immediately after `setTaperYield`, mirroring it exactly. Anchor (verify `== 1`):
```
  async function setTaperYield(yieldPerChunk: number) {
```
Insert the new function **after that whole function's closing brace** (do not nest it):
```ts
  async function setChunkTarget(qtyTarget: number) {
    if (!selectedJob) return;
    setChecklistBusy(true);
    try {
      const res = await fetch("/v2/api/cutting/chunk-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: selectedJob.id, qty_target: qtyTarget }),
      });
      const data = await res.json();
      if (!data.ok) showToast(data.error || "Failed to set chunk target.", false);
      await fetchQueue(true);
    } catch {
      showToast("Network error.", false);
    } finally {
      setChecklistBusy(false);
    }
  }
```
Then wire the prop. Anchor (verify `== 1`):
```
                      onSetYield={(y) => setTaperYield(y)}
```
→
```
                      onSetYield={(y) => setTaperYield(y)}
                      onSetChunkTarget={(q) => setChunkTarget(q)}
```

---

## Verification (MANDATORY — loop until green)
```
cd cutting-pilot
npx tsc --noEmit
npx opennextjs-cloudflare build
```
Both must pass. Fix and re-run until clean; never hand back a non-building tree.

Grep checks — state each result:
- `grep -Fc 'chunk-target' src/app/cutting/CuttingBoard.tsx` → **1**
- `grep -Fc 'onSetChunkTarget' src/app/cutting/PartsPanel.tsx` → **2** (prop type, use)
- `grep -rc 'Chunks required — coming soon' src/` → **0** (placeholder gone)
- No file created under `DB_Migrations/`.

Describe (do not execute — no deploy creds): on a non-taper job, clocking into Cross Cutter shows a
chunk input; entering 40 with a 6-block plan reads "40 chunks out of 6 blocks"; Hole Cutter (if
routed) shows 40 read-only; a job routed to Cross Cutter only reads "40 parts out of 6 blocks"; a
taper job still shows the yield editor and never the manual input.

## No migration
`cut_plan_lines.qty_target` and `unit` already exist. Do **not** create a file in `DB_Migrations/`,
do not alter any table, and do not touch `blockEngine.ts`.

## BACKLOG / CHANGELOG (same commit)
- `CHANGELOG.md` → under **Manufacturing / Cutting (React pilot)**, newest-first, add **P242**:
  manual chunk target for the Cross Cutter — chunk counts are a handling decision (manageable size +
  curing acceleration), not a geometry output, so they are entered by hand rather than derived. New
  `POST /v2/api/cutting/chunk-target` writes `cut_plan_lines.qty_target` for Cross Cutter and mirrors
  it to Hole Cutter when that line is routed (bare `UPDATE` self-mirrors, since the queue GET only
  creates rows for required lines); taper jobs are refused (409) and keep their derived
  `ceil(parts ÷ taper_yield)` target from P227. `PartsPanel`'s "Chunks required — coming soon"
  placeholder replaced with the input plus an "N chunks out of M blocks" readout against
  `cut_plans.blocks_needed` (P228). Fabricator jobs — Cross Cutter as the only routed line — label
  the unit "parts" (display-only; `unit` stays `'chunk'` in D1). No migration; no engine change.
  `tsc --noEmit` + `cf-build` green.
- `BACKLOG.md` → remove/complete the non-taper chunk-model item. Add:
  `[ ] Cutting route is tribal knowledge (supervisor decides which line cuts which axis; Main Line can chunk, Blue Line can run standalone). Consider capturing the route on the job so chunk/part targets stop depending on unwritten context.`

One coherent commit. Message: `P242: manual Cross Cutter chunk target (+ Hole Cutter mirror, blocks readout)`
