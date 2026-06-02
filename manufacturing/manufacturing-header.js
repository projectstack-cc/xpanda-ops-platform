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
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
} else {
  window.initXpandaHeader(window.__xpandaHeaderConfig);
  window.__xpandaHeaderConfig = null;
}
