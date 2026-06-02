# Prompt 76 — F1c: Shared Utilities

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`.** Assume:
- **Lead: admin-auth-agent** — owns `/shared/`.
- **Coordinating with: qc-agent** — proof-of-pattern migration in `qc/density-calculator.html`.

Does NOT touch `_worker.js`, any DB migration, or any HTML file other than `qc/density-calculator.html`.

## Context

F1a (shared-header) and F1b (shared-api) shipped. F1c adds `/shared/shared-utils.js` covering business calculations and formatting helpers that risk drift. Density calc is the canary even though only one site computes it today — preempts the duplicate before scrap-log re-adds one. Date formatting has multiple existing duplications.

---

## Part 1 — Create `/shared/shared-utils.js`

Wrap in IIFE, expose `window.utils` (guard against double-init).

```javascript
// /shared/shared-utils.js — shared business calculations and formatters (F1c).
// All formulas that affect physical product or appear in multiple modules live here.

(function () {
  if (window.utils) return;

  // ── Density (lb/ft³) ──────────────────────────────────────────────────
  // Foam density: weight in pounds / volume in cubic feet.
  // 1 ft³ = 1728 in³. All inputs in inches and pounds.
  function calculateDensity(weightLbs, lengthIn, widthIn, heightIn) {
    const w = Number(weightLbs), l = Number(lengthIn), wd = Number(widthIn), h = Number(heightIn);
    if (!isFinite(w) || !isFinite(l) || !isFinite(wd) || !isFinite(h)) return null;
    if (w <= 0 || l <= 0 || wd <= 0 || h <= 0) return null;
    const cubicInches = l * wd * h;
    const cubicFeet = cubicInches / 1728;
    const density = w / cubicFeet;
    return {
      cubicInches: round(cubicInches, 3),
      cubicFeet:   round(cubicFeet, 3),
      density:     round(density, 3),
      unit: 'lb/ft³',
    };
  }

  // ── Date formatting ───────────────────────────────────────────────────
  // ISO YYYY-MM-DD → MM/DD/YYYY. Falls through to raw for non-ISO input.
  function isoToUS(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}/${m[3]}/${m[1]}` : String(iso);
  }

  // YYYY-MM-DD → "Mon, Jan 5" (short weekday + month + day).
  function isoToShortDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso);
    const dt = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
    if (isNaN(dt)) return String(iso);
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // Today as YYYY-MM-DD in local time (for <input type="date"> defaults).
  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  // ── Numeric helpers ───────────────────────────────────────────────────
  function round(n, places) {
    const f = Math.pow(10, places);
    return Math.round(Number(n) * f) / f;
  }

  // ── HTML escape (so callers don't reinvent esc() in every file) ───────
  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Truncate with ellipsis ────────────────────────────────────────────
  function truncate(s, n) {
    if (s == null) return '';
    const str = String(s);
    return str.length > n ? str.slice(0, n) + '…' : str;
  }

  window.utils = {
    calculateDensity,
    isoToUS,
    isoToShortDate,
    todayIso,
    round,
    escHtml,
    truncate,
  };
})();
```

## Part 2 — Auto-load via shared-header

In `/shared/shared-header.js`, find the F1b auto-load block:

```javascript
if (!window.__xpandaSharedApiLoaded) {
  window.__xpandaSharedApiLoaded = true;
  document.write('<script src="/shared/shared-api.js"><\/script>');
}
```

Add immediately after:

```javascript
if (!window.__xpandaSharedUtilsLoaded) {
  window.__xpandaSharedUtilsLoaded = true;
  document.write('<script src="/shared/shared-utils.js"><\/script>');
}
```

Same synchronous-`document.write` pattern. `window.utils` is now available on every page that loads any shared header.

## Part 3 — Proof-of-pattern: migrate `qc/density-calculator.html`

The calculator currently inlines the formula at line ~296. Replace it.

Find the function `calculateDensity` (around line 296). It computes cubicInches, cubicFeet, density inline. Replace its body so it delegates to the shared util while preserving the existing DOM-update behavior:

```javascript
function calculateDensity(showErrors) {
  const inputs = getInputs(showErrors);
  if (!inputs) {
    // existing error-state DOM updates stay
    cubicInchesValue.textContent = '--';
    cubicFeetValue.textContent = '--';
    densityValue.textContent = '--';
    return;
  }

  const result = utils.calculateDensity(inputs.weight, inputs.length, inputs.width, inputs.height);
  if (!result) {
    cubicInchesValue.textContent = '--';
    cubicFeetValue.textContent = '--';
    densityValue.textContent = '--';
    return;
  }

  cubicInchesValue.textContent = formatFixed(result.cubicInches);
  cubicFeetValue.textContent   = formatFixed(result.cubicFeet);
  densityValue.textContent     = formatFixed(result.density);
}
```

**Preserve everything else in the file unchanged.** The `getInputs`, `formatFixed`, DOM references — all stay. Only the inline arithmetic is replaced.

If the existing function does NOT match this shape exactly, adapt minimally — the rule is: the inline `/ 1728` arithmetic must be gone, replaced by `utils.calculateDensity(...)`, and the user-visible behavior must be identical.

---

## Scope

- 3 files: new `/shared/shared-utils.js`; one block added to `/shared/shared-header.js`; `qc/density-calculator.html` density function migrated.
- No other migrations. Date helpers ship unused; bulk adoption follows in per-module prompts.
- No worker change. No DB. No new dependencies.

## Verify

1. Any page loads — DevTools shows `shared-utils.js` loads alongside the other shared scripts. `window.utils` defined globally. No console errors.
2. Density calculator: enter known values (e.g. 5lb, 12×12×12in = 1 ft³ = 5 lb/ft³). Output matches prior behavior exactly.
3. Edge cases: empty/zero/negative inputs render `--` as before.

## Next

F1 closes after this. F2 (worker router abstraction inside `_worker.js`) is the natural next phase. Per-module bulk migrations to `api` / `utils` can ship opportunistically between F2/F3 prompts.
