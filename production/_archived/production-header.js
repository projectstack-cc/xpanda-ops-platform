// production/production-header.js — thin shim for F1a.
// All header logic lives in /shared/shared-header.js.
window.__xpandaHeaderConfig = {
  moduleKey:         'production',
  badgeText:         'XPANDA FOAM • PRODUCTION',
  badgeClass:        'prod-badge',
  badgeTitle:        'Back to Production Dashboard',
  dashboardPath:     '/production/',
  backLinkLabel:     '← Back to Dashboard',
  pageTitle:         'Production Dashboard',
  pageSubtitle:      'Inventory and production planning',
  pageTitleId:       'prod-page-title',
  pageSubtitleId:    'prod-page-subtitle',
  footerClass:       'prod-platform-footer',
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
if (!window.__xpandaProductionI18nLoaded) {
  window.__xpandaProductionI18nLoaded = true;
  document.write('<script src="/production/production-i18n.js"><\/script>');
}
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
} else {
  window.initXpandaHeader(window.__xpandaHeaderConfig);
  window.__xpandaHeaderConfig = null;
}
