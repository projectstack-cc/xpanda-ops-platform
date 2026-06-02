// jobs/jobs-header.js — thin shim for F1a.
// All header logic lives in /shared/shared-header.js.
// Synchronous load of the shared module preserves document.write timing.
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
}
window.initXpandaHeader({
  moduleKey:         'jobs',
  badgeText:         'XPANDA FOAM • JOBS',
  badgeClass:        'jobs-badge',
  badgeTitle:        'Back to Job Board',
  dashboardPath:     '/jobs/',
  backLinkLabel:     '← Back to Job Board',
  pageTitle:         'Job Board',
  pageSubtitle:      'Production job tracking and shipping schedule',
  pageTitleId:       'jobs-page-title',
  pageSubtitleId:    'jobs-page-subtitle',
  footerClass:       'jobs-platform-footer',
  userBarLocation:   'topbar',
  showNotifications: true,
});
