// /shared/auth-interceptor.js — single shared global-fetch 401/503 interceptor (P407).
// Loaded via <script src> on every legacy page (replaces ten byte-identical inline copies).
// - Never redirects on 503 (the auth layer's transient-D1-lookup signal, P405/P406) — the
//   caller's own logic retries; nothing destructive happens here.
// - Never hard-redirects on a 401 from a background/polling fetch without confirming first: a
//   single GET /api/auth/me (via the pre-wrap fetch, so the confirm call itself is never
//   re-intercepted) decides. If that confirm also 401s, the session is genuinely gone and the
//   redirect fires (existing behavior, now confirmed). If it returns 200, the original 401 was
//   transient/spurious — no redirect, the original response is returned untouched.
// - Guards: never wraps twice; never intercepts while already on /login; never re-runs this
//   logic for the /api/auth/me request itself (that would be pointless — it IS the confirm call).
(function () {
  if (window.__xpandaFetchWrapped) return;
  window.__xpandaFetchWrapped = true;

  var _origFetch = window.fetch;

  function requestPath(args) {
    try {
      var input = args[0];
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      return new URL(url, window.location.origin).pathname;
    } catch (e) {
      return '';
    }
  }

  window.fetch = async function (...args) {
    var res = await _origFetch.apply(this, args);

    if (window.location.pathname.startsWith('/login')) return res;
    if (requestPath(args) === '/api/auth/me') return res;
    if (res.status === 503) return res;

    if (res.status === 401) {
      var confirmedGone = true;
      try {
        var confirmRes = await _origFetch('/api/auth/me');
        confirmedGone = !confirmRes.ok;
      } catch (e) {
        confirmedGone = false;
      }
      if (confirmedGone) {
        window.location.href = '/login.html';
      }
      return res;
    }

    return res;
  };
})();
