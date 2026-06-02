// logistics/logistics-header.js — thin shim for F1a.
// All header logic lives in /shared/shared-header.js.
// Synchronous load of the shared module preserves document.write timing.
//
// NOTE: backLinkLabel is intentionally empty — the current logistics header
// renders no back-link in the topbar (for any page). Preserving byte-identical
// behavior. Set backLinkLabel: '← Back to Logistics' to enable it as a follow-up.
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
}
window.initXpandaHeader({
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
});
