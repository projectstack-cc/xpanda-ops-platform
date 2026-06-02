# Prompt 75 — F1b: Shared API Helper

## Agents to assume

**Read BOTH agent files before starting: `AGENTS.md` AND `xpanda-ops-agents.md`.** Then assume these agents and follow their scopes and the Orchestrator's cross-cutting rules:

- **Lead: admin-auth-agent** — owns shared platform utilities under `/shared/`.
- **Coordinating with: logistics-agent** — one small migration in `logistics/loading.html` is included as the proof-of-pattern.

This prompt does NOT touch `_worker.js`, any DB migration, or any module other than `logistics/loading.html`.

## Context: Foundation Phase 1, Step B

F1a shipped `/shared/shared-header.js`. F1b adds the second shared utility: `/shared/shared-api.js`, one helper that consolidates the `fetch` + JSON parse + error normalization pattern duplicated across every module today.

**Scope discipline:** this prompt creates the helper AND migrates one small surface as proof. Bulk migration of every existing `fetch` call is intentionally left to follow-up prompts (one per module). F1b proves the pattern works end-to-end without sprawling.

## What's wrong today

Every module has dozens of variants of this pattern:

```javascript
const res = await fetch('/api/jobs/' + encodeURIComponent(jobId));
const data = await res.json();
if (!data.ok || !data.job) { alert('Failed'); return; }
const job = data.job;
```

Drift across modules: some check `res.ok`, some don't; some handle parse errors, some don't; some show alerts, some show toasts, some silently swallow. A failed fetch behaves differently depending on which page you're on.

---

## Part 1 — Create `/shared/shared-api.js`

Create the file alongside `shared-header.js`. Wrap everything in an IIFE; expose a single global `window.api`.

### 1a. Public API

```javascript
// window.api.get(path)             → { ok, data, error, status }
// window.api.post(path, body)      → { ok, data, error, status }
// window.api.put(path, body)       → { ok, data, error, status }
// window.api.del(path)             → { ok, data, error, status }
// window.api.raw(path, options)    → { ok, data, error, status }   // escape hatch
//
// All methods return a Promise that ALWAYS resolves (never throws).
// `ok` is true iff: HTTP 2xx AND (response body is not JSON OR response body's `ok` !== false).
// `data` is the parsed JSON response body (or null if parse failed / no body).
// `error` is a human-readable error string when ok === false (combining HTTP + worker-level errors).
// `status` is the HTTP status code (0 if the request itself threw, e.g. network failure).
```

### 1b. Implementation

```javascript
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
```

That's the whole file. Roughly 50 lines. Resist the urge to add features (retries, request cancellation, interceptors, etc.) — they belong in later prompts if ever.

---

## Part 2 — Load `shared-api.js` alongside `shared-header.js`

Update `/shared/shared-header.js` to load `shared-api.js` immediately after it loads itself, so every page that already includes the shared header automatically gets the api helper too. Find the top of the file (right after the opening comment, before the IIFE) and add:

```javascript
// Auto-load companion shared modules.
if (!window.__xpandaSharedApiLoaded) {
  window.__xpandaSharedApiLoaded = true;
  document.write('<script src="/shared/shared-api.js"><\/script>');
}
```

This uses the same synchronous-`document.write` trick the module shims use, for the same reason: it preserves parse-time timing so `window.api` is available before any page-level inline script runs.

**Why load this way instead of having each shim include it:** the shared-header.js file is already loaded by every page that has a header (i.e. every page). Loading shared-api.js from there means zero additional changes to existing shims or HTML files. Any new shared utility added later (`shared-utils.js` for F1c) follows the same pattern.

---

## Part 3 — Proof-of-pattern migration: one function in `loading.html`

To verify `window.api` works end-to-end, migrate exactly **one** function: `openShippingInfo` in `logistics/loading.html`. This was added in Prompt 72 and is a clean candidate — one GET call, clear error handling, low blast radius.

### Current implementation

```javascript
async function openShippingInfo(assignmentId) {
  const a = allAssignments.find(x => x.id === assignmentId);
  if (!a) return;

  const modal = document.getElementById('ld-shipping-info-modal');
  const body = document.getElementById('ld-shipping-info-body');
  body.innerHTML = '<div style="color:#6b7280;">Loading…</div>';
  modal.hidden = false;

  try {
    let job;
    if (shippingInfoJobCache.has(a.job_id)) {
      job = shippingInfoJobCache.get(a.job_id);
    } else {
      const res = await fetch('/api/jobs/' + encodeURIComponent(a.job_id));
      const data = await res.json();
      if (!data.ok || !data.job) {
        body.innerHTML = '<div style="color:#b91c1c;">Could not load shipping information.</div>';
        return;
      }
      job = data.job;
      shippingInfoJobCache.set(a.job_id, job);
    }
    populateShippingInfo(job, a);
  } catch (e) {
    console.error('Failed to fetch shipping info:', e);
    body.innerHTML = '<div style="color:#b91c1c;">Error loading shipping information.</div>';
  }
}
```

### Replace with

```javascript
async function openShippingInfo(assignmentId) {
  const a = allAssignments.find(x => x.id === assignmentId);
  if (!a) return;

  const modal = document.getElementById('ld-shipping-info-modal');
  const body = document.getElementById('ld-shipping-info-body');
  body.innerHTML = '<div style="color:#6b7280;">Loading…</div>';
  modal.hidden = false;

  let job;
  if (shippingInfoJobCache.has(a.job_id)) {
    job = shippingInfoJobCache.get(a.job_id);
  } else {
    const { ok, data, error } = await api.get('/api/jobs/' + encodeURIComponent(a.job_id));
    if (!ok || !data?.job) {
      console.error('Failed to fetch shipping info:', error);
      body.innerHTML = '<div style="color:#b91c1c;">Could not load shipping information.</div>';
      return;
    }
    job = data.job;
    shippingInfoJobCache.set(a.job_id, job);
  }
  populateShippingInfo(job, a);
}
```

Note the simplifications:
- No `try/catch` needed — `api.get` always resolves; network errors surface as `ok: false`.
- Single error path instead of two (fetch failure vs response shape).
- Identical user-visible behavior.

**Do not migrate any other `fetch` calls in `loading.html` or anywhere else in this prompt.** Each module's bulk migration is its own follow-up prompt. F1b's job is to prove the helper works and the loading pattern is right.

---

## Scope Constraints (strict)

- **Files touched (3 total):** new `/shared/shared-api.js`; edit to `/shared/shared-header.js` (add the auto-load block); one function replaced in `logistics/loading.html`.
- Do NOT modify any other `fetch` call anywhere.
- Do NOT add features to the helper beyond what's specified (no retries, no interceptors, no toast UI).
- Do NOT change the worker, any DB migration, any HTML file other than the one function in loading.html.
- Do NOT introduce dependencies. No CDN scripts.

## Manual steps after build

- None (no migration).
- Verify:
  1. Any page in any module loads cleanly. DevTools Network shows `/shared/shared-header.js` and `/shared/shared-api.js` both load (no 404). Console has no errors.
  2. `window.api` is defined in the console on every page (`typeof api === 'object'`).
  3. On the loading dashboard, clicking an INV# on any card opens the shipping info modal with the correct data — identical behavior to before F1b.
  4. With DevTools throttling set to "Offline", clicking the INV# shows "Could not load shipping information." instead of hanging or throwing.

## After this lands

F1c (`shared-utils.js`) is next — density calculation as the canary, plus unit conversion and date formatting. Same `/shared/` directory, same auto-load pattern via shared-header. After F1c, the **bulk migration prompts** begin: one per module (jobs, logistics, production, qc, reports) replacing existing `fetch` calls with `api.get/post/put/del` and any duplicated density / format calls with the shared-utils versions. Each module migration is small, surgical, and independently testable.
