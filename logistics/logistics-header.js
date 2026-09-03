// logistics/logistics-header.js — thin shim for F1a.
// All header logic lives in /shared/shared-header.js.
//
// NOTE: backLinkLabel is intentionally empty — the current logistics header
// renders no back-link in the topbar. Set to '← Back to Logistics' to enable.
window.__xpandaHeaderConfig = {
  moduleKey:         'logistics',
  badgeText:         'XPANDA FOAM • LOGISTICS',
  badgeClass:        'logistics-badge',
  badgeTitle:        'Back to Logistics',
  dashboardPath:     '/logistics/',
  backLinkLabel:     '',
  pageTitle:         'Logistics',
  pageSubtitle:      'Inbound deliveries and outbound shipments',
  pageTitleId:       'logistics-page-title',
  pageSubtitleId:    'logistics-page-subtitle',
  footerClass:       'logistics-platform-footer',
  userBarLocation:   'footer',
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
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
} else {
  window.initXpandaHeader(window.__xpandaHeaderConfig);
  window.__xpandaHeaderConfig = null;
}
