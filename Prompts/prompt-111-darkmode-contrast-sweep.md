# Prompt 111 — Dark-mode contrast: inline-hex sweep + text-hint lift

## Agent setup
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. Operate as the **Frontend Designer** agent. Cross-cutting hexes live in `logistics-agent` and `admin-auth-agent` territory (shipment dashboard render + shared header), so respect those files' conventions.

**Hard constraints:** vanilla HTML/CSS/JS, no build, no frameworks. Use the canonical tokens in `/shared/tokens.css`. Do not invent new hex values.

## Problem
Several elements render with **hardcoded hex colors inside inline `style="…"` attributes / JS template strings**, so they ignore dark mode entirely. The worst offender is the dimmed `INV# ####` text on the logistics dashboard, hardcoded `color:#111827` (near-black text on a near-black surface in dark mode). Separately, dark-mode `--text-hint` was darker than its light-mode value, which is backwards.

## Scope
Pages on the **shared token layer** only: `logistics/index.html`, `logistics/loading.html`, `jobs/index.html`, `shared/shared-header.js`, plus the one `tokens.css` edit. **Out of scope:** the standalone inline-`:root` pages (`load-builder.html` is handled in P112; `block-calculator.html`, `holey-board-calculator.html`, `density-calculator.html`, `bol-generator.html` are their own later migrations).

## Part A — `shared/tokens.css` (already lightened in your tree if P111 pre-applied; otherwise make this edit)
**FIND:**
```css
    --text-muted: #9ca3af;
    --text-hint: #6b7280;
```
**REPLACE WITH:**
```css
    --text-muted: #9ca3af;
    --text-hint: #868e9f;
```
(This is the dark-mode block only — the light-mode `--text-hint: #9ca3af` at the top of the file is correct, leave it.)

## Part B — convert dark-mode-breaking inline hexes to tokens
In **each** of `logistics/index.html`, `logistics/loading.html`, `jobs/index.html`, and `shared/shared-header.js`, replace every occurrence of these exact color substrings with the mapped token. These are deterministic substring swaps inside `style="…"` / template strings:

| Find (substring) | Replace with |
|---|---|
| `color:#111827` | `color:var(--text)` |
| `color:#1f2937` | `color:var(--text)` |
| `color:#374151` | `color:var(--muted)` |
| `background:#fff;` | `background:var(--card-bg);` |
| `background:#ffffff` | `background:var(--card-bg)` |
| `background:#fff"` | `background:var(--card-bg)"` |
| `background:#f3f4f6` | `background:var(--ghost-bg)` |
| `border-bottom:2px solid #e5e7eb` | `border-bottom:2px solid var(--line)` |
| `solid #e5e7eb` | `solid var(--line)` |

**Safelist — do NOT touch:**
- Brand red `#e31837` / `#ef4356`.
- Semantic status colors (greens `#16a34a/#22c55e`, ambers `#f59e0b/#d97706`, reds used for danger, blues for info) — these are intentional and already have dark-aware usage.
- Any color inside **print/PDF generation** code (off-screen render hosts, `@page` templates, `buildPrintSvg`, BOL canvas) — those are intentionally paper-white/black and must stay literal.
- SVG icon `stroke`/`fill` set to `currentColor`.

## Verify
- `node --check shared/shared-header.js` passes.
- This returns **0** in each of the four files:
  `grep -oE 'color:#(111827|1f2937|374151)' <file> | wc -l`
- Dashboard `INV# ####` text is legible in dark mode; modals/dropdowns that were white-on-dark now follow the surface token.
- Light mode unchanged.

## Manual / deploy (Steve)
No migration. Deploy; hard-refresh if `sw.js` caches the changed files.
