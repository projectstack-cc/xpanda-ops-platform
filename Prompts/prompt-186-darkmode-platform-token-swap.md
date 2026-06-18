# Prompt NNN — Dark-Mode Fix: Platform Token Swap (9 modules, one pass)

> **Type:** Code change across multiple frontend files. Token swaps + a small set of additive dark overrides. No worker, no migration, no JS logic changes.
> **Source of truth:** `dark-mode-audit.md` (in repo root). This prompt applies the **Bucket A** rows for the sections listed below. **Bucket B and the hard exclusions are restated in §3 and MUST be honored.**
> **Depends on:** the token-foundation prompt (already shipped) — `--link`, `--info-bg/border/text`, `--warn-bg/border/text` now exist in `shared/tokens.css`.
> **Prompt number:** Steve assigns. Replace `NNN` in the filename before running.

## 0. Required reading (do this first)

1. **Pull the repo** (`git pull`).
2. Read **`AGENTS.md`** and **`xpanda-ops-agents.md`** in full.
3. Read **`agent-frontend-designer.md`** — token/design-system authority.
4. **Read `dark-mode-audit.md` in full.** It contains the exact `file : line : value : context : recommended token` mapping for every change in this prompt.
5. Confirm `shared/tokens.css` contains `--link`, `--info-bg`, `--info-border`, `--info-text`, `--warn-bg`, `--warn-border`, `--warn-text` in both `:root` and `:root[data-theme="dark"]`. If any is missing, STOP and report — do not proceed.

## 1. Agent assignment

Operating under the **Orchestrator** (`xpanda-ops-agents.md` §1) with the **Frontend Designer** (`agent-frontend-designer.md`) as lead, touching files owned by **logistics-agent**, **job-board-agent**, **production-agent**, **qc-agent**, **reports-agent**, and shared/platform. No domain agent writes logic; every edit is a color-token substitution or an additive dark override.

## 2. Scope — apply Bucket A from these audit sections, file by file

Apply the recommended-token substitution for **every Bucket A row** in each section below. Each row in the audit gives the exact literal value and the exact target token. Use the global tokens (`var(--…)`) named in the audit.

- **§2b — Loading Dashboard:** `logistics/loading.html` (all Bucket A rows in the inline `<style>` block + the per-modal headings).
- **§2c — Logistics Dashboard:**
  - `logistics/index.html` inline-style rows.
  - `logistics/bol-compose.js` review-modal injected markup rows.
  - `logistics/logistics-shared.css`: the `.cal-more:hover` `--link` row, **and** add dark overrides for the **four status pills that lack them** — `.status-awaiting`, `.status-not_started`, `.status-in_production`, `.status-ready_to_ship`. Match the existing dark-override pattern already used for `delivered`/`loaded`/`loading`/`in_transit`/`cancelled`/`scheduled` (rgba tint of the same hue). This is additive — do not alter the existing six.
- **§2e — Job Board:** `jobs/index.html` (List-view markup + misc rows) and `jobs/jobs-shared.css` (`.jobs-back-link` → `--link`).
- **§2f — Shared:** `shared/shared-header.js`, `shared/components.css` (`.badge-warning`/`.badge-info` text → `--warn-text`/`--link` as the audit maps), `shared/photo-gallery.js`.
- **§2h — Production:** `production/production-shared.css`, `production/inventory.html`, `production/bead-inventory.html`.
- **§2i — QC:** `qc/qc-shared.css` (`.qc-back-link` → `--link`).
- **§2j — Reports:** `reports/reports-shared.css` (`.reports-back-link` → `--link`; `.reports-badge:hover` → `var(--ghost-bg)`).
- **§2k — Homepage:** `index.html` error-banner row → `--info`/danger tokens per the audit (use `--warn-*`? No — it's an error banner; map bg/border/text to the danger equivalents the audit names; if the audit says "propose `--error-banner-*`", instead use existing `var(--danger-bg)` tinting and `#fff`/`var(--text)` as appropriate — do NOT invent a new token here).

For the audit's "no token fits → needs `--link`/`--info-*`/`--warn-*`" notes in these sections: those tokens now exist — use them.

## 3. Bucket B — DO NOT TOUCH (hard fences)

Leave every one of these exactly as-is. Substituting any of these is a defect:

- **Status / semantic colors:** loading-status color map (`loading.html` ~329–334), the six existing status-pill colors in `logistics-shared.css`, action-load/action-bol, inbound card border-left status colors, load-count/indigo badges, trailer/loading badges on job cards, pass/fail `.ok/.warn/.err` in QC, `.report-status.error`, success-green toast colors (`#34d399`), notif danger-red (`#dc2626`), sign-out danger-red.
- **Brand:** `#E31837` / `#B31229`, `.btn-brand { color:#fff }`.
- **Intentional dark surfaces:** toast `#1e293b`/`#fff` (jobs + loading), photo overlay `rgba(0,0,0,…)`/`#fff`, photo-gallery lightbox, bead-prompt modal in `jobs/index.html` (~1221–1228), BOL viewer iframe surround `#525659`.
- **PDF / canvas drawing — absolute no-touch:** `logistics/bol-shared.js`, `logistics/bol-compose.js` PDF-draw paths (only the **review-modal markup** rows in §2c are in scope — NOT any pdf-lib draw calls), `_worker.js/routes/bols.js`, all SVG/canvas/html2canvas/print code in `load-builder.html` and `production/block-calculator.html`.
- **Chart.js dataset palettes** anywhere.

## 4. Hard exclusions (out of scope this prompt)

- **Admin pages** — `admin/*` untouched (deliberate platform deferral).
- **Load Builder** (`logistics/load-builder.html`) — separate batch (local token system).
- **`track/index.html`** — separate batch (standalone, no tokens.css).
- Do **not** create new tokens in this prompt. If a row genuinely has no fitting token (after §0 confirmed the new ones exist), leave it and list it in your report rather than inventing one.

## 5. Find/replace discipline (per memory)

- Work on `/tmp` copies of each file first; apply to the real files only after all find blocks for that file verify.
- Each find block must match the live file byte-for-byte and return **`count == 1`** via Python `.count()` before applying. If any block returns 0 or >1, STOP on that block, do not guess, and report it — line numbers in the audit are guidance; match on content.
- Extract inline `<script>` blocks for any JS-containing HTML via `re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S)` written to a real temp file (never `/dev/stdin`).
- Run `node --check` on every modified `.js` file (`shared-header.js`, `bol-compose.js`, `photo-gallery.js`) and on extracted inline scripts from any modified HTML.
- For CSS-only changes, re-read the modified rule blocks to confirm matched braces and valid declarations.
- Process the files in the §2 order. Treat each file as an independent unit so a stall on one file doesn't block the others.

## 6. Deliverable & report

- All listed files modified per §2; nothing in §3/§4 touched.
- Report, per file: count of substitutions applied, the status-pill dark overrides added to `logistics-shared.css`, any find block that failed `count == 1` (with the offending value), and any audit row deliberately skipped for lack of a fitting token.
- Confirm no worker/migration/admin/load-builder/track file was changed.
