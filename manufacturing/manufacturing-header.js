// manufacturing/manufacturing-header.js — thin shim for F1a.
// All header logic lives in /shared/shared-header.js.
window.__xpandaHeaderConfig = {
  moduleKey:         'manufacturing',
  badgeText:         'XPANDA FOAM • MANUFACTURING',
  badgeClass:        'mfg-badge',
  badgeTitle:        'Back to Manufacturing Dashboard',
  dashboardPath:     '/manufacturing/',
  backLinkLabel:     '← Back to Manufacturing',
  pageTitle:         'Manufacturing Dashboard',
  pageSubtitle:      'Production calculators and cutting operations',
  pageTitleId:       'mfg-page-title',
  pageSubtitleId:    'mfg-page-subtitle',
  footerClass:       'mfg-platform-footer',
  userBarLocation:   'topbar',
  showNotifications: true,
};
// i18n engine + catalogs — written as their own preceding <script> tags so they finish loading
// (and register window.I18n) before shared-header.js's own script tag runs and builds the nav
// HTML with window.I18n.t(). See shared/shared-header.js's top-of-file comment for why this
// can't just live inside shared-header.js itself.
if (!window.__xpandaI18nLoaded) {
  window.__xpandaI18nLoaded = true;
  document.write('<script src="/shared/i18n.js"><\/script>');
}
if (!window.__xpandaI18nCommonLoaded) {
  window.__xpandaI18nCommonLoaded = true;
  document.write('<script src="/shared/i18n-common.js"><\/script>');
}
if (!window.__xpandaManufacturingI18nLoaded) {
  window.__xpandaManufacturingI18nLoaded = true;
  document.write('<script src="/manufacturing/manufacturing-i18n.js"><\/script>');
}
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
} else {
  window.initXpandaHeader(window.__xpandaHeaderConfig);
  window.__xpandaHeaderConfig = null;
}
