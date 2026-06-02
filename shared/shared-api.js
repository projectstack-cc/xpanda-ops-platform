// /shared/shared-api.js — unified fetch helper (F1b).
// Used by all modules via the global window.api.
// Notes:
//   - The 401 redirect is handled by the window.fetch wrapper installed by /shared/shared-header.js.
//     This helper does NOT duplicate that behavior; 401 responses surface as ok=false with the redirect already in motion.
//   - This helper does NOT show UI (toasts/alerts). Callers decide how to surface errors.

(function () {
  if (window.api) return; // guard against double-init

  async function call(method, path, body, extraOptions) {
    const options = {
      method,
      headers: {},
      ...(extraOptions || {}),
    };
    if (body !== undefined && body !== null) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(path, options);
    } catch (e) {
      return { ok: false, data: null, error: String(e?.message || e || 'Network error'), status: 0 };
    }

    // Try to parse JSON body. Some endpoints return empty 204s; that's fine.
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); }
      catch { data = null; } // non-JSON body — leave data null, caller can use raw() if they need it
    }

    // Determine ok and error.
    const httpOk = res.ok;
    const workerOk = (data && typeof data === 'object' && 'ok' in data) ? data.ok !== false : true;

    if (httpOk && workerOk) {
      return { ok: true, data, error: null, status: res.status };
    }

    // Build a human-readable error.
    let error;
    if (!httpOk) {
      error = `HTTP ${res.status}`;
      if (data?.error) error += `: ${data.error}`;
      else if (text && text.length < 200) error += `: ${text}`;
    } else {
      error = data?.error || 'Request failed';
    }
    return { ok: false, data, error, status: res.status };
  }

  window.api = {
    get:  (path)        => call('GET',    path, null, null),
    post: (path, body)  => call('POST',   path, body, null),
    put:  (path, body)  => call('PUT',    path, body, null),
    del:  (path)        => call('DELETE', path, null, null),
    raw:  (path, opts)  => call(opts?.method || 'GET', path, opts?.body, opts),
  };
})();
