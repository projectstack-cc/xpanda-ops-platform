# Prompt NNN — Dark-Mode Legibility Audit (REPORT-ONLY)

> **Type:** Documentation / audit only. **NO code changes.** Produces one new file: `dark-mode-audit.md` at repo root.
> **Pattern:** Same as `permissions-audit.md` (P78) and `qc-slop-audit.md` (P137) — inventory + recommendations, no edits.
> **Prompt number:** Steve assigns. Replace `NNN` in the filename before running.

## 0. Required reading (do this first)

1. **Pull the repo** (`git pull`) before anything. The live codebase is the source of truth.
2. Read **`AGENTS.md`** and **`xpanda-ops-agents.md`** in full.
3. Read **`agent-frontend-designer.md`** — this is the design-system / token authority for this task.
4. Read **`shared/tokens.css`** — the actual token definitions you will map against.

## 1. Agent assignment

You are operating under the **Orchestrator** (`xpanda-ops-agents.md` §1), coordinating the **Frontend Designer** agent (`agent-frontend-designer.md`) as visual-judgment lead, cross-referencing each domain agent for file ownership:

- **logistics-agent** → `logistics/*`
- **job-board-agent** → `jobs/*`
- **production-agent** → `production/*`
- **qc-agent** → `qc/*`
- **safety-agent** → `safety/*`
- **reports-agent** → `reports/*`
- **shared/platform** → `shared/*`, `index.html`, `login.html`, `track/*`, `manifest.json`-adjacent pages

This is report-only, so no agent writes code. You are producing the map the fix prompts will follow.

## 2. Context — why this audit exists

Dark mode is the **default** (the inline boot script in the shared header falls back to `'dark'` when no preference is saved), so dark-mode legibility is the common case, not an edge case. The token system in `shared/tokens.css` is solid — light values in `:root`, dark overrides in `:root[data-theme="dark"]` (`--bg`, `--surface`, `--card-bg`, `--card-border`, `--text`, `--muted`, `--text-hint`, `--input-bg`, etc.). The problem is **adoption**: 1000+ hardcoded hex colors across the platform ignore the tokens and therefore don't adapt to dark mode.

A blind "replace every hex with a token" would break things. Your job is to classify, not to fix.

## 3. Methodology

1. Grep the repo for hardcoded color values. Cover at least:
   - Hex: `#[0-9a-fA-F]{3,8}`
   - `rgb(`, `rgba(`, `hsl(`, `hsla(`
   - Named CSS colors used as UI surface/text/border (`white`, `black`, `whitesmoke`, etc.)
   - Both `<style>` blocks and inline `style="..."` attributes.
2. For each hit, record: file, line number, the value, and the CSS property/context it sits in.
3. Classify every hit into exactly one of the three buckets below.
4. Aggregate per module. Count totals per bucket per module.

## 4. The three buckets

**BUCKET A — Real bugs (the audit targets).** UI surfaces, text, borders, backgrounds, inputs, cards, modals, table chrome, nav — hardcoded to **light values** so they go illegible or wrong in dark mode. For each, recommend the correct token from `shared/tokens.css` (e.g. `#ffffff` background → `var(--card-bg)`; `#111827` text → `var(--text)`; `#d1d5db` border → `var(--card-border)`; `#6b7280` muted text → `var(--muted)` or `var(--text-hint)`). Where no existing token fits, say so and propose what a new token would need to be — do **not** invent one in this report.

**BUCKET B — Intentional, leave alone (fence these explicitly).** Do not flag these as bugs; list them so the fix prompts know to skip them:
- **PDF-drawing colors** — `logistics/bol-shared.js`, `_worker.js/routes/bols.js`, `logistics/bol-compose.js`, and the BOL/canvas drawing paths in `logistics/load-builder.html` and `production/block-calculator.html`. These draw on **white PDF paper / canvas**, not the UI. They must stay literal.
- **Status / semantic colors** — loading-status dots, status pills/badges, the six loading statuses (red/gray/amber/green/indigo/teal), pass/fail colors. These carry meaning and are theme-independent by design.
- **Brand red** — `#E31837` / `#B31229` and brand accents.
- **Chart colors** — Chart.js dataset/series palettes in `reports/*`.

**BUCKET C — Ignore entirely.** `.wrangler/tmp` and any build/cache artifacts. Do not inventory these.

## 5. Hard exclusions (out of scope for this audit AND the fix batches)

- **Admin pages** — `admin/roles.html`, `admin/users.html`, `admin/parts.html`, `admin/activity-log.html`. These are Steve's hand-rolled pages, deliberately kept out of the shared-header migration; same exclusion applies here. **Do not inventory them.** Note in the report that they remain illegible-in-dark by deliberate deferral so the decision is on record.

## 6. Output: `dark-mode-audit.md` (repo root)

Structure it as:

1. **Summary** — total hits, total Bucket A (fixable) count, breakdown by module, one-line state of dark-mode adoption.
2. **Per-module sections**, one each for: Logistics, Job Board, Production/Manufacturing, Safety, Reports, Shared+homepage/track/login. Each section:
   - Bucket A table: `file : line : value : property/context : recommended token`
   - Bucket B fences for that module (what was found and why it's left alone)
   - Any "no token fits — proposed new token" notes
3. **Excluded** — admin pages (with the deferral note), Bucket C artifacts.
4. **Recommended fix batching order** — sequence the follow-on code-change prompts roughly by size/effort, e.g. Logistics (biggest) → Job Board → Production/Manufacturing → Safety → Reports → Shared+homepage/track/login. Justify the ordering and call out any cross-module shared CSS that should be fixed first to avoid rework.

## 7. What NOT to change

- **No code edits of any kind.** This prompt's only deliverable is `dark-mode-audit.md`.
- Do not touch tokens.css, the boot script, any module file, or any worker file.
- Do not modify PDF/canvas/status/brand colors even to "demonstrate" — they are fenced, not fixed.

## 8. Deliverable

- One new file: `dark-mode-audit.md` at repo root.
- Report findings in the chat as a short summary; the full inventory lives in the file.
