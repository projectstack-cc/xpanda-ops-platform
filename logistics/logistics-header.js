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
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
} else {
  window.initXpandaHeader(window.__xpandaHeaderConfig);
  window.__xpandaHeaderConfig = null;
}
