# Prompt 86 — UI Overhaul (Foundation 2 of 3): Floor / Office Mode Engine

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`, plus `agent-frontend-designer.md`.** Assume:
- **Lead: frontend-designer** — responsive density layer.
- Honor cross-cutting rules: vanilla JS only, no frameworks, no build step. This rides on the already-consolidated `shared/shared-header.js` (F1a).

**No DB migration. No `_worker.js` change.** This prompt touches exactly two files: `shared/shared-header.js` and `shared/tokens.css`.

**Depends on Prompt 85 being merged** (`shared/tokens.css` exists and is imported by the module CSS files).

## Context

The platform is used both on the office desktop and on the floor on iPads/phones. We are implementing **one responsive codebase with a density "mode" layer** — NOT separate layouts and NOT duplicate DOM. A single attribute `data-mode` on `<html>` is either `office` or `floor`:
- **office** — current density (default on desktop / fine-pointer devices).
- **floor** — larger touch targets and type for gloved hands on tablets; auto-defaulted on coarse-pointer small-viewport devices, user-toggleable, remembered in `localStorage`.

`floor` mode is implemented purely as CSS keyed off `html[data-mode="floor"]`. This prompt establishes the engine + a conservative baseline of floor rules. Per-module floor refinements come in the module reskin prompts (88+).

---

## Part 1 — Mode engine in `shared/shared-header.js`

`shared/shared-header.js` currently (a) `document.write`s its companion shared scripts at the top, then (b) defines `initXpandaHeader` inside an IIFE. Add the mode engine so it runs **as early as possible** (before the header renders, to minimize flash), and expose a setter the toggle button will call.

Add this self-invoking block **near the top of the file, immediately after the companion-script `document.write` block and before the `(function () { if (window.initXpandaHeader) return; … })();` IIFE**:

```javascript
/* UI density mode (office | floor) — Prompt 86.
   One responsive codebase; floor mode bumps touch targets + type via CSS keyed on
   html[data-mode]. Auto-defaults by pointer/viewport, user-toggleable, remembered. */
(function initXpandaUiMode() {
  var KEY = 'xpanda-ui-mode';
  function autoMode() {
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return (coarse && window.innerWidth < 1024) ? 'floor' : 'office';
  }
  function apply(mode) {
    document.documentElement.setAttribute('data-mode', mode);
    if (window.__xpandaUpdateModeToggle) window.__xpandaUpdateModeToggle(mode);
  }
  // Public setter — called by the header toggle. Persists an explicit user choice.
  window.__xpandaSetUiMode = function (mode) {
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    apply(mode);
  };
  // Public getter for the toggle's initial render.
  window.__xpandaGetUiMode = function () {
    return document.documentElement.getAttribute('data-mode') || 'office';
  };
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved || autoMode());
  // Track system pointer/viewport changes ONLY while the user has made no explicit choice.
  if (!saved && window.matchMedia) {
    window.matchMedia('(pointer: coarse)').addEventListener('change', function () {
      var s = null; try { s = localStorage.getItem(KEY); } catch (e) {}
      if (!s) apply(autoMode());
    });
  }
})();
```

## Part 2 — Toggle control in the header

Inside `initXpandaHeader`, locate where the topbar/header chrome is built — specifically the cluster that renders the **notifications bell and the user area** (the config flag `showNotifications` gates the bell; the user bar is positioned per `userBarLocation`). Add a mode toggle button **adjacent to the notifications bell** (same control cluster), so it appears on every module header.

Requirements for the toggle:
- A single `<button type="button" class="xpanda-mode-toggle" aria-label="Toggle floor mode">` showing an icon + short label that reflects current mode (e.g. `Office` / `Floor`). Use inline SVG or a text glyph already used elsewhere in this file — do **not** add an icon-font dependency.
- On click: `window.__xpandaSetUiMode(window.__xpandaGetUiMode() === 'floor' ? 'office' : 'floor');`
- Define `window.__xpandaUpdateModeToggle = function(mode){ … }` that updates the button's label/pressed state (`aria-pressed`). Call it once after the button is inserted so initial state is correct (the early engine in Part 1 calls it too, but it may run before the button exists — guard with `if (button) …`).
- Style the button to match the existing header controls (reuse the bell's button styling/classes where present). Keep it unobtrusive in office mode.

Place the toggle using the file's existing header-markup approach (string concatenation / `insertAdjacentHTML`) — match the surrounding code style. Do not restructure the header.

## Part 3 — Floor-mode CSS hooks in `shared/tokens.css`

Append the following to the **end** of `shared/tokens.css`. These are intentionally conservative and element-level (not class-specific), so they help every page immediately; modules refine later.

```css
/* Floor mode — larger touch targets + type for gloved/tablet use (Prompt 86).
   Office mode = no overrides (platform default density). */
html[data-mode="floor"] {
  font-size: 16.5px;
}
html[data-mode="floor"] button,
html[data-mode="floor"] input,
html[data-mode="floor"] select,
html[data-mode="floor"] textarea,
html[data-mode="floor"] a.btn,
html[data-mode="floor"] [role="button"] {
  min-height: 44px;
}
html[data-mode="floor"] input,
html[data-mode="floor"] select,
html[data-mode="floor"] textarea {
  font-size: 16px; /* prevents iOS zoom-on-focus */
}
@media (prefers-reduced-motion: reduce) {
  html[data-mode="floor"] * { transition-duration: .01ms !important; }
}
```

---

## Scope guard — do NOT do any of the following

- Do **not** add a light/dark theme toggle — dark mode is auto (`prefers-color-scheme`) and was handled in Prompt 85.
- Do **not** create `shared/components.css` (Prompt 87) or restyle any component beyond the generic floor min-heights above.
- Do **not** touch `_worker.js`, any module HTML, any module `*-shared.css` (other than the append to `tokens.css`), or the thin `*-header.js` shims.
- Do **not** change the existing `document.write` companion-loading pattern (that refactor is separately tracked as tech debt).
- Do **not** introduce any icon-font or external dependency for the toggle.

## Verify

- On a desktop browser, `<html>` has `data-mode="office"`; on a coarse-pointer device narrower than 1024px it auto-sets `floor`.
- The header shows a mode toggle next to the notifications bell on every module; clicking it flips `data-mode`, bumps control sizes, and persists across reloads.
- After an explicit toggle, rotating/resizing the device no longer auto-overrides the choice.
- No layout breakage in office mode (it has zero overrides).

## Manual steps after merge

- Hard-refresh to pick up the updated `shared-header.js` and `tokens.css`.
- No D1 migration. No console steps.
