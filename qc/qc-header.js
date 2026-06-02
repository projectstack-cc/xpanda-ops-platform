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
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
} else {
  window.initXpandaHeader(window.__xpandaHeaderConfig);
  window.__xpandaHeaderConfig = null;
}
