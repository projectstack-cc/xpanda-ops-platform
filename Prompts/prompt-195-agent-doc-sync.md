# Prompt 195 — Agent doc sync: de-stale + add backlog/changelog discipline (docs only)

## Agent context (read first, in this order)
1. Read `AGENTS.md` (platform-wide rules).
2. Read `xpanda-ops-agents.md` (domain agents).
3. **You are the `db-api-agent`/Orchestrator acting in a documentation capacity.** This is a
   **docs-only** prompt — **no code, no migration, no behavior change.** **Pull `main`; repo is source
   of truth** and the docs currently lag it.

## Goal
Correct stale information in the agent docs to match the live repo, add the Cutting Dashboard to the
domain map, and codify a non-negotiable rule that every code-change prompt must update `BACKLOG.md`
and `CHANGELOG.md`.

## Files in scope
- `xpanda-ops-agents.md`
- `AGENTS.md`

No other files. Use byte-exact `grep -n`/`grep -c` (count == 1) anchors for every replacement; where a
string legitimately recurs (e.g. `DB Migrations/`), fix each occurrence individually after confirming
its surrounding context, or use a scoped surrounding anchor.

## A. De-stale `xpanda-ops-agents.md`

1. **Calculators moved to `/manufacturing/` (P80), not `/production/`.** The repo has a
   `manufacturing/` module containing `block-calculator.html`, `holey-board-calculator.html`,
   `cutting-dashboard.html`, `index.html`, `manufacturing-header.js`, `manufacturing-shared.css`.
   `production/` now holds only inventory (`inventory.html`, `bead-inventory.html`, `index.html`,
   `production-header.js`, `production-shared.css`). Verify with `ls manufacturing/ production/`.
   - Fix the **Repository Structure** block (the `production/` subtree lists block/holey calculators —
     move them into a new `manufacturing/` subtree; leave production as inventory-only).
   - Fix the **Production Agent (section 4)**: it currently claims ownership of block/holey calculators
     under `production/`. Re-scope it to inventory (bead/block inventory, molding log) and point the
     calculator files at `manufacturing/`.
   - Fix the **File Size Budget** table path for `block-calculator.html` (→ `manufacturing/`).
   - Fix the **Available Agents** table row if it implies the calculators live under production.

2. **Add a Manufacturing Agent entry.** There is no manufacturing agent today. Add one (either a new
   numbered section modeled on the others, or at minimum a row in the Available Agents table) owning
   `manufacturing/*`: block calculator, holey board calculator, **Cutting Dashboard**, and the
   manufacturing header/CSS. Note the Cutting Dashboard (shipped P193 worker + P194 frontend):
   `cutting_steps` table, `/api/cutting*` routes, auto-reconcile from `jobs.processes`, job-level Start
   → In Production, all-steps-complete → Done, bidirectional pill↔step sync. Cross-refs:
   `job-board-agent` (processes pills), `db-api-agent` (schema/routes), future cut-list/block-calc link.

3. **Migrations folder name:** the repo folder is **`DB_Migrations/`** (underscore). The doc writes
   `DB Migrations/` (space) in multiple places (Repository Structure, db-api-agent file list, DB
   Migration Rules, the example handoff). Correct each to `DB_Migrations/`.

4. While here, do **not** rewrite anything that is still accurate. Keep edits surgical and limited to
   the stale facts above. Do not touch the worker-architecture section (already correct post-F2/F5).

## B. De-stale `AGENTS.md`
Skim for the same two stale facts — calculator location (`production/` → `manufacturing/`) and
`DB Migrations/` → `DB_Migrations/` — and correct any occurrences. If `AGENTS.md` does not mention
them, make no change there and say so.

## C. Add backlog/changelog discipline (both relevant docs)
Add an explicit, prominent rule (Orchestrator/cross-cutting rules in `xpanda-ops-agents.md`, and the
equivalent process section in `AGENTS.md`):

> **Every code-change prompt must update `BACKLOG.md` and `CHANGELOG.md` as part of the same change.**
> When work ships: add a `CHANGELOG.md` entry keyed to its prompt number (newest-first within its
> module section) and remove the corresponding item from `BACKLOG.md`. New follow-on work discovered
> during the change goes into `BACKLOG.md`. Docs-only and report-only prompts note themselves in the
> appropriate `CHANGELOG.md` section too. Drift check: any prompt in `Prompts/` missing from
> `CHANGELOG.md` is a gap.

Phrase it to match each file's existing voice/format. In `xpanda-ops-agents.md` this belongs with the
"Cross-Cutting Rules (Enforced by Orchestrator)" list and/or the "Implementation Order for New
Features" list (add a final step: update BACKLOG + CHANGELOG).

## Validation
- These are Markdown files — no `node --check`. Instead: after edits, re-grep to confirm no remaining
  `production/block-calculator.html`, `production/holey-board-calculator.html`, or `DB Migrations/`
  (space) strings survive unintentionally:
  ```
  grep -n "production/block-calculator\|production/holey\|DB Migrations/" xpanda-ops-agents.md AGENTS.md
  ```
  (Expect zero hits, or only intentional historical references you can justify.)
- Confirm the new Manufacturing/Cutting content and the backlog/changelog rule are present.

## Output
Write the two edited docs. Summarize: what was de-staled, the new Manufacturing agent/Cutting entry,
and the new backlog/changelog rule. No code touched.

## Note on this batch
P193 + P194 themselves should, per the new rule, land `CHANGELOG.md` entries (Logistics/Manufacturing
section) and trim any Cutting Dashboard placeholder note from `BACKLOG.md`. If P193/P194 did not do so,
flag it here so Steve can fold the changelog/backlog updates into this prompt.
