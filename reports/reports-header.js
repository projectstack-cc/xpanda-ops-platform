// reports/reports-header.js — thin shim for F1a.
// All header logic lives in /shared/shared-header.js.
// Synchronous load of the shared module preserves document.write timing.
//
// NOTE: backLinkLabel is intentionally empty — the current reports header renders
// no topbar back-link. Sub-page back-links are handled inline in each reports HTML.
// NOTE: pageTitle is intentionally empty — each reports page sets its own title
// via document.getElementById('reports-page-title').textContent = '...'.
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
}
window.initXpandaHeader({
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
});
