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
  pageSubtitle:      'Production planning and manufacturing tools',
  pageTitleId:       'prod-page-title',
  pageSubtitleId:    'prod-page-subtitle',
  footerClass:       'prod-platform-footer',
  userBarLocation:   'topbar',
  showNotifications: true,
};
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
} else {
  window.initXpandaHeader(window.__xpandaHeaderConfig);
  window.__xpandaHeaderConfig = null;
}
