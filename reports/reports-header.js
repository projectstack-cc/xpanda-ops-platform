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
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
} else {
  window.initXpandaHeader(window.__xpandaHeaderConfig);
  window.__xpandaHeaderConfig = null;
}
