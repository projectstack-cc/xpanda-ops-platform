# Prompt 112 — Load Builder onto the shared token layer (de-dup + dark support)

## Agent setup
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. Operate as the **Frontend Designer** agent in coordination with the **logistics-agent** (this is `logistics/load-builder.html`, the largest file in the repo).

**Hard constraints:** vanilla HTML/CSS/JS, no build, no frameworks. `/shared/tokens.css` is loaded on this page (via `logistics-shared.css`) and is the canonical token source.

## Why
`load-builder.html` carries its own inline `:root` token block that (a) **duplicates** four tokens already defined in `tokens.css` (`--bg`, `--surface`, `--text`, `--text-muted`) and (b) defines many **bespoke** tokens (`--border`, `--accent` amber, the `--blue/--teal/--green/--purple/--red` families, `--warn-*`, `--text-mid/-faint/-ghost`) with **no dark-mode values**. Result in dark mode: the shared-named tokens flip correctly (via `tokens.css`'s higher-specificity `[data-theme="dark"]`), but the bespoke ones stay light — producing light borders, light-tinted pill backgrounds, and faint text on the dark canvas. This makes Load Builder consistent with the rest of the platform in both themes.

## Approach (low-risk, no usage renames)
We do **not** rip out the inline `:root` or rename any `var(--x)` usages (too risky in a 159 KB file). We only: drop the 4 redundant duplicates so they inherit from `tokens.css` in both themes, and add a `:root[data-theme="dark"]` block for the bespoke tokens.

## DO NOT TOUCH
- The auto-pack / load algorithm.
- `STORAGE_KEY` — `foam_trailer_loader_v31` must never change.
- Canvas / SVG diagram logic.
- **Print/PDF generation** (the off-screen render host at `host.style.cssText`, the `@page` print `<style>` template, `buildPrintSvg`) — its `#0f172a`/`#fff`/`#cbd5e1`/`#f8fafc`/`#475569`/`#64748b` values are intentional paper colors. Leave them literal.
- The shared header / shim, `--font` (`DM Sans`) and `--mono` (`JetBrains Mono`) — keep load-builder's typography as-is.

## Part A — remove the 4 redundant duplicate tokens from the inline `:root`
These names are defined (light **and** dark) in `tokens.css`; deleting them here lets Load Builder inherit both themes. Every `var(--bg/--surface/--text/--text-muted)` usage keeps resolving.

**FIND:**
```css
    --bg: #F8FAFC;
    --surface: #FFFFFF;
    --border: #CBD5E1;
    --border-light: #E2E8F0;
    --text: #0F172A;
    --text-mid: #334155;
    --text-muted: #475569;
```
**REPLACE WITH:**
```css
    --border: #CBD5E1;
    --border-light: #E2E8F0;
    --text-mid: #334155;
```
(Removes `--bg`, `--surface`, `--text`, `--text-muted`; keeps `--border`, `--border-light`, `--text-mid`. Indentation is 4 spaces to match the file.)

## Part B — add a dark-mode block for the bespoke tokens
Immediately **after** the closing `}` of the inline `:root { … }` block (the one ending with `--mono: 'JetBrains Mono', monospace; }`), insert:

```css
  :root[data-theme="dark"] {
    --border: #2d3142;
    --border-light: #232634;
    --text-mid: #cbd5e1;
    --text-faint: #94a3b8;
    --text-ghost: #6b7280;
    --accent: #f59e0b;
    --accent-light: #78350f;
    --blue: #60a5fa;
    --blue-dark: #93c5fd;
    --blue-bg: rgba(59, 130, 246, .14);
    --blue-border: #3b5380;
    --teal: #2dd4bf;
    --teal-bg: rgba(20, 184, 166, .14);
    --teal-border: #115e59;
    --green: #34d399;
    --green-dark: #6ee7b7;
    --purple: #a78bfa;
    --red: #f87171;
    --red-dark: #fca5a5;
    --red-bg: rgba(239, 68, 68, .14);
    --red-border: #7f1d1d;
    --warn-bg: rgba(245, 158, 11, .14);
    --warn-border: #b45309;
    --warn-text: #fcd34d;
    --warn-text-dark: #fde68a;
  }
```

These dark values are a first pass — Steve should eyeball the SKU list, stat cards, and stack-breakdown pills in dark mode and tune any that read off (amber accent intensity and the tinted `-bg` pills are the most likely to want nudging).

## Verify
- Load Builder renders correctly in **light** mode (should be visually unchanged from today).
- In **dark** mode: borders are dark (not light grey), tinted pill/badge backgrounds are dark-tinted (not pale), and faint/ghost text is legible.
- Auto-pack, saved loads (`foam_trailer_loader_v31`), the trailer diagram, and **print/PDF output** (still paper-white) all behave exactly as before.
- "Pull from job" and BOL generation from the load still work.

## Manual / deploy (Steve)
No migration. Deploy; hard-refresh (`sw.js` may cache `load-builder.html`).
