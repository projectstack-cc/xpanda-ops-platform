// qc/qc-header.js — thin shim for F1a.
// All header logic lives in /shared/shared-header.js.
window.__xpandaHeaderConfig = {
  moduleKey:         'qc',
  badgeText:         'XPANDA FOAM • QUALITY CONTROL',
  badgeClass:        'qc-badge',
  badgeTitle:        'Back to QC Dashboard',
  dashboardPath:     '/qc/',
  backLinkLabel:     '← Back to Dashboard',
  pageTitle:         'QC Dashboard',
  pageSubtitle:      'Select a quality workflow to begin',
  pageTitleId:       'qc-page-title',
  pageSubtitleId:    'qc-page-subtitle',
  footerClass:       'qc-platform-footer',
  userBarLocation:   'topbar',
  showNotifications: false,
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
if (!window.__xpandaQcI18nLoaded) {
  window.__xpandaQcI18nLoaded = true;
  document.write('<script src="/qc/qc-i18n.js"><\/script>');
}
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
} else {
  window.initXpandaHeader(window.__xpandaHeaderConfig);
  window.__xpandaHeaderConfig = null;
}
