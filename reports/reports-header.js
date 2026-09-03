// reports/reports-header.js — thin shim for F1a.
// All header logic lives in /shared/shared-header.js.
//
// NOTE: backLinkLabel is empty — reports sub-page back-links are inline in each HTML.
// NOTE: pageTitle is empty — each reports page sets its own via getElementById.
window.__xpandaHeaderConfig = {
  moduleKey:         'reports',
  badgeText:         'XPANDA FOAM • REPORTS',
  badgeClass:        'reports-badge',
  badgeTitle:        'Back to Reports Dashboard',
  dashboardPath:     '/reports/',
  backLinkLabel:     '',
  pageTitle:         '',
  pageSubtitle:      'Select a reporting workflow to begin',
  pageTitleId:       'reports-page-title',
  pageSubtitleId:    'reports-page-subtitle',
  footerClass:       'reports-platform-footer',
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
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
} else {
  window.initXpandaHeader(window.__xpandaHeaderConfig);
  window.__xpandaHeaderConfig = null;
}
