// /shared/pwa-install.js — PWA install prompt for mobile users.
// Shows a bottom banner on phones that haven't installed the app or dismissed the prompt.
// Android: captures beforeinstallprompt for one-tap install.
// iOS Safari: shows manual "Add to Home Screen" instructions.
(function () {
  'use strict';

  var DISMISSED_KEY = 'xpanda-pwa-dismissed';

  function isMobile() {
    return window.innerWidth < 1024 ||
      !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  function isStandalone() {
    return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  function isDismissed() {
    try { return !!localStorage.getItem(DISMISSED_KEY); } catch (e) { return false; }
  }

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch (e) {}
    var banner = document.getElementById('xpanda-pwa-banner');
    if (banner) banner.remove();
  }

  function showBanner(type, deferredPrompt) {
    var isIos = type === 'ios';

    var wrap = document.createElement('div');
    wrap.id = 'xpanda-pwa-banner';
    wrap.style.cssText = [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:9998',
      'background:#1e1b4b', 'color:#fff',
      'padding:12px 16px',
      'display:flex', 'align-items:center', 'gap:12px',
      'box-shadow:0 -2px 12px rgba(0,0,0,.25)',
      'font-family:inherit'
    ].join(';');

    var msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'flex:1;font-size:13px;line-height:1.5;';
    if (isIos) {
      msgDiv.innerHTML = 'Tap <strong>Share</strong> (&#9095;) then <strong>Add to Home Screen</strong> to install xPanda Ops.';
    } else {
      msgDiv.textContent = 'Install xPanda Ops on your device for quick access.';
    }
    wrap.appendChild(msgDiv);

    if (!isIos && deferredPrompt) {
      var installBtn = document.createElement('button');
      installBtn.textContent = 'Install';
      installBtn.style.cssText = [
        'flex-shrink:0', 'padding:8px 16px',
        'background:#4f46e5', 'color:#fff',
        'border:none', 'border-radius:8px',
        'font-size:14px', 'font-weight:600', 'cursor:pointer'
      ].join(';');
      installBtn.addEventListener('click', function () {
        dismiss();
        try {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.catch(function () {});
        } catch (e) {}
      });
      wrap.appendChild(installBtn);
    }

    var closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.style.cssText = [
      'flex-shrink:0', 'background:none', 'border:none',
      'color:rgba(255,255,255,.6)', 'font-size:24px',
      'cursor:pointer', 'padding:0', 'line-height:1'
    ].join(';');
    closeBtn.addEventListener('click', dismiss);
    wrap.appendChild(closeBtn);

    document.body.appendChild(wrap);
  }

  window.addEventListener('DOMContentLoaded', function () {
    if (isStandalone() || isDismissed() || !isMobile()) return;

    var ua = navigator.userAgent;
    var isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    var isIosSafari = isIos && !ua.includes('CriOS') && !ua.includes('FxiOS');

    if (isIosSafari) {
      setTimeout(function () {
        if (!isStandalone() && !isDismissed()) showBanner('ios', null);
      }, 3000);
    } else if (!isIos) {
      window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        if (!isDismissed()) showBanner('android', e);
      });
    }
  });
})();
