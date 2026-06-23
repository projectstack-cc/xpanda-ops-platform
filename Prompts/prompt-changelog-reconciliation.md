# Prompt — Backlog ↔ Repo Reconciliation + CHANGELOG.md Bootstrap (DOC-ONLY)

> Assign this a prompt number before committing. NOTE: P139 is currently reserved for the
> agent-doc refresh (production→manufacturing path corrections + audit-staleness). This is a
> separate doc-only task — likely **P140** unless you reorder.

## Read first
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` in full before doing anything.
Assume the **Orchestrator** role: this is cross-platform documentation reconciliation, not a
single-module change. You touch **only** two files: `BACKLOG.md` (rewrite) and `CHANGELOG.md`
(new). **No code. No agent docs. No migrations.**

## Problem
`BACKLOG.md` has drifted from the repo. Completed items are unmarked, and recent work (notably
P132–P138, and F5) left no trace. The repo is the source of truth: `git log` + the `Prompts/`
directory are a complete, ordered record of everything shipped. Reconcile the backlog against
that record, and stand up a changelog so this can't silently drift again.

## Procedure

### 1. Pull + build the authoritative ledger
```
git pull --ff-only
git fetch --unshallow --quiet 2>/dev/null || true
git log --oneline --no-merges            # full history; commit msgs are prefixed "P###:"
ls Prompts/                               # numbered prompt files: prompt-NNN-*.md
```
Build a master ledger of every shipped prompt: **prompt # → one-line description**, sourcing the
description from (a) the `Prompts/` filename + file body, then (b) the matching `P###:` commit
message. Capture the short commit hash per prompt where determinable.

### 2. Verify, don't trust
For **every** item — both those marked done in BACKLOG and those still open — verify the actual
state against live code by grep/inspection before classifying it. Examples of checks:
- F5 modularization → confirm `_worker.js/index.js` + `_worker.js/lib/` + `_worker.js/routes/` exist (they do). **F5 is DONE.** Do not carry forward its obsolete "/functions/" plan.
- BOL re-unification → `logistics/bol-compose.js` present (P123–P128).
- SKU picker → `skp-` markers in `logistics/load-builder.html` (P129–P131).
- PO-on-BOL → `po_number` in `_worker.js/routes/bols.js` + `DB_Migrations/add-po-number-to-bols.sql` (P138).
An item is "done" only if the code backs it up — regardless of its current checkbox state.

### 3. Classify every item into one of three buckets
- **Shipped** → goes to `CHANGELOG.md`, removed from `BACKLOG.md`.
- **Genuinely open** → stays in `BACKLOG.md`.
- **Unverifiable** (can't confirm done or open from code + history) → do NOT guess. Park under an
  `## UNVERIFIED — needs Steve` section at the bottom of the reconciliation report (step 6).

Accuracy over completeness: never invent a prompt description or a ship-state. A wrong CHANGELOG
entry is worse than an honest "unverified" flag.

### 4. Write `CHANGELOG.md` (NEW, repo root)
Header block stating the process rule (see step 7), then entries grouped **by module, and within
each module by prompt # descending (newest first)**. Use these module buckets, in this order:
Logistics · Job Board · Production / Manufacturing · QC · Safety · Reports · Admin / Platform ·
Foundation Roadmap · QuickBooks Integration · Infra / Docs.

Migrate the existing prose from BACKLOG's current "Done" / "Completed (Archive)" sections — it's
good content — then backfill every shipped prompt the ledger surfaced that BACKLOG was missing
(P132–P138 at minimum, plus F5 and any others step 2 reclassifies). Entry format:
```
- **P138** — Durable PO-number fix on BOL save: po_number column + migration, worker INSERT/UPDATE, bol-generator field. (07cd40b)
```
Hash optional if not determinable. One line each; merge multi-prompt efforts (e.g. P123–P128) into
a single entry with a range.

### 5. Rewrite `BACKLOG.md` (forward-looking only)
Remove **all** "Done" and "Completed (Archive)" sections and every shipped checkbox. Keep only
genuinely-open items, preserving their existing structure/grouping. Add a header block with the
process rule and a pointer: "Shipped items live in `CHANGELOG.md`." Fix the F5 entry out of
existence (it ships to CHANGELOG; do not leave the dead /functions/ plan behind).

### 6. Emit a reconciliation report (stdout, not a committed file)
Print: count moved to CHANGELOG, count backfilled (in repo but absent from old BACKLOG), count
kept open, and the full `UNVERIFIED — needs Steve` list. This is Steve's review surface.

### 7. Process rule (verbatim into both file headers)
> **Process:** When an item ships, its entry moves to `CHANGELOG.md` (keyed to its prompt #) and is
> deleted from `BACKLOG.md`. BACKLOG is forward-looking only. Drift check: diff `Prompts/` against
> `CHANGELOG.md` — any prompt missing from the changelog is a gap.

## What NOT to change
- No source code, no `_worker.js/**`, no `DB_Migrations/**`, no HTML/JS/CSS.
- Do NOT touch `AGENTS.md` or `xpanda-ops-agents.md` (the agent-doc refresh is a separate prompt).
- Do NOT resolve the known `DB_Migrations/` list staleness in the agent doc — out of scope here.
- Do NOT self-assign or renumber any prior prompts; only read them.

## Deploy
```
git add BACKLOG.md CHANGELOG.md
git commit -m "P###: reconcile backlog against repo; bootstrap CHANGELOG.md (by module, prompt # desc)"
git push
```
Review the `UNVERIFIED` list before relying on the result.
