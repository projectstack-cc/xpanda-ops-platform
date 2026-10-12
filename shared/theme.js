// /shared/theme.js — ThemeManager singleton.
// Loaded by shared-header.js (all module pages) and index.html (homepage).
// Single mechanism: data-theme on documentElement + localStorage['xpanda-theme'].
(function () {
  if (window.ThemeManager) return;
  var STORAGE_KEY = 'xpanda-theme';
  window.ThemeManager = {
    init: function () {
      var saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
      this.set(saved || 'dark');
    },
    set: function (theme) {
      document.documentElement.setAttribute('data-theme', theme);
      try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
      this.updateToggleUI(theme);
    },
    toggle: function () {
      var current = document.documentElement.getAttribute('data-theme') || 'dark';
      this.set(current === 'dark' ? 'light' : 'dark');
    },
    updateToggleUI: function (theme) {
      var t = theme || document.documentElement.getAttribute('data-theme') || 'dark';
      var isDark = t === 'dark';
      document.querySelectorAll('.theme-icon-sun, .theme-icon-moon').forEach(function (icon) {
        var isSun = icon.classList.contains('theme-icon-sun');
        icon.style.display = (isDark ? isSun : !isSun) ? '' : 'none';
        var btn = icon.closest('button');
        if (btn) btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      });
    }
  };
  window.ThemeManager.init();
  // mobile-zoom-02: iOS Safari auto-zooms when a form field under 16px gets focus, and pinching
  // back out is hard. theme.js is the one script every module page + the homepage loads, so the
  // touch-only 16px rule is injected here (mirrors v2 globals.css, mobile-zoom-01). Do NOT use
  // maximum-scale/user-scalable=no in the viewport -- that blocks pinch-zoom on Android.
  if (!document.getElementById('xp-touch-input-size')) {
    var tz = document.createElement('style');
    tz.id = 'xp-touch-input-size';
    tz.textContent = '@media (pointer: coarse){' +
      'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]),' +
      'select,textarea{font-size:16px !important;}}';
    (document.head || document.documentElement).appendChild(tz);
  }
  // Re-sync toggle UI once DOM is ready — buttons don't exist at init time.
  document.addEventListener('DOMContentLoaded', function () {
    window.ThemeManager.updateToggleUI();
  });
})();
