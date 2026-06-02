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
