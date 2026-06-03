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
  // Re-sync toggle UI once DOM is ready — buttons don't exist at init time.
  document.addEventListener('DOMContentLoaded', function () {
    window.ThemeManager.updateToggleUI();
  });
})();
