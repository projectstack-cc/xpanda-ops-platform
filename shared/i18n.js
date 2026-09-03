// /shared/i18n.js — I18n singleton engine.
// Loaded by index.html (homepage) and, per-module, by files that register their own catalogs.
// Single mechanism: [data-i18n]/[data-i18n-attr] on elements + localStorage['xpanda_lang'].
// Mirrors the shared/theme.js pattern exactly.
(function () {
  if (window.I18n) return;

  var STORAGE_KEY = 'xpanda_lang';
  var DEFAULT_LANG = 'en';
  var LANGS = ['en', 'es', 'ht'];

  var catalogs = {};

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  var saved = safeGet(STORAGE_KEY);
  var currentLang = LANGS.indexOf(saved) !== -1 ? saved : DEFAULT_LANG;
  try { document.documentElement.lang = currentLang; } catch (e) {}

  function register(namespace, dict) {
    if (!catalogs[namespace]) catalogs[namespace] = {};
    LANGS.forEach(function (lang) {
      if (!dict[lang]) return;
      if (!catalogs[namespace][lang]) catalogs[namespace][lang] = {};
      for (var k in dict[lang]) {
        if (Object.prototype.hasOwnProperty.call(dict[lang], k)) {
          catalogs[namespace][lang][k] = dict[lang][k];
        }
      }
    });
  }

  function resolve(lang, key) {
    var parts = key.split('.');
    var ns = parts.shift();
    var node = catalogs[ns] && catalogs[ns][lang];
    for (var i = 0; i < parts.length; i++) {
      if (!node || typeof node !== 'object') return undefined;
      node = node[parts[i]];
    }
    return typeof node === 'string' ? node : undefined;
  }

  function t(key, vars) {
    var value = resolve(currentLang, key);
    if (value === undefined) value = resolve(DEFAULT_LANG, key);
    if (value === undefined) return key;
    if (vars) {
      for (var name in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, name)) {
          value = value.replace(new RegExp('\\{' + name + '\\}', 'g'), vars[name]);
        }
      }
    }
    return value;
  }

  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var pairs = el.getAttribute('data-i18n-attr').split(';');
      pairs.forEach(function (pair) {
        var idx = pair.indexOf(':');
        if (idx === -1) return;
        var attr = pair.slice(0, idx).trim();
        var key = pair.slice(idx + 1).trim();
        if (!attr || !key) return;
        el.setAttribute(attr, t(key));
      });
    });
    // data-i18n-placeholder — single-key placeholder convention (safety/i18n.js's existing
    // pattern, kept so the Safety module can delegate to this engine with zero markup changes).
    root.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
  }

  function get() { return currentLang; }

  function set(lang) {
    if (LANGS.indexOf(lang) === -1) return;
    currentLang = lang;
    safeSet(STORAGE_KEY, lang);
    try { document.documentElement.lang = lang; } catch (e) {}
    apply(document);
    try {
      document.dispatchEvent(new CustomEvent('xpanda:langchange', { detail: { lang: lang } }));
    } catch (e) {}
  }

  window.I18n = {
    register: register,
    get: get,
    set: set,
    t: t,
    apply: apply
  };

  document.addEventListener('DOMContentLoaded', function () {
    apply(document);
  });
})();
