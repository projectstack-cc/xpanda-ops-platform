# Prompt 44 — Loading Dashboard Card Rework + Web Push VAPID

**Context:** The loading dashboard (`/logistics/loading.html`) scaffold is in place. Now the card interaction model needs to be reworked, auto-population from the job board needs to be wired up, and the `sendPushNotification()` stub in `_worker.js` needs a real VAPID implementation.

Reference `AGENTS.md` for platform conventions.

---

## Part A: Auto-populate loading assignments when a job hits "Done"

**File: `_worker.js`**

In the job PUT handler (around line 2087–2117), after the `UPDATE jobs SET ...` query succeeds, add logic that checks:

1. Was the `status` field included in the payload?
2. Is the new status `"done"`?
3. Does a `loading_assignment` already exist for this job? (Check with: `SELECT id FROM loading_assignments WHERE job_id = ?`)

If all three conditions pass (status changed to done AND no existing loading assignment), auto-create one:

```js
if (payload.status === 'done') {
  const existingLA = await db.prepare(
    "SELECT id FROM loading_assignments WHERE job_id = ?"
  ).bind(id).first();
  
  if (!existingLA) {
    const laId = crypto.randomUUID();
    const now2 = new Date().toISOString();
    await db.prepare(`
      INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, created_at, updated_at)
      VALUES (?, ?, NULL, '', 'awaiting', ?, '', ?, ?)
    `).bind(laId, id, request.headers.get('X-User-Id') || null, now2, now2).run();
    
    // Dispatch notification
    const jobData = await db.prepare("SELECT customer, invoice_number FROM jobs WHERE id = ?").bind(id).first();
    const custName = jobData?.customer || 'Unknown';
    const inv = jobData?.invoice_number || '';
    await dispatchNotification(db, env, 'loading.assigned',
      'Job Ready for Loading',
      `${custName}${inv ? ' (INV# ' + inv + ')' : ''} moved to loading queue`,
      'loading_assignment', laId
    );
    
    await logActivity(db, 'create', 'loading_assignment', laId,
      `Auto-created loading assignment — job moved to Done`,
      { job_id: id }, request.headers.get('X-User-Id'));
  }
}
```

Place this block **after** the successful `UPDATE jobs` query (after `await db.prepare(...).bind(...).run()` on the job update) and **before** the `logActivity` call for the job update (around line 2113). Wrap it in a try/catch so a failure here doesn't break the job update response.

**The "+ Pull Job" button remains as-is** — it allows managers to manually pull jobs that haven't reached Done yet (e.g., pulling a job from In Production directly to loading). No changes to `openPullJobModal()`, `searchJobsForPull()`, or `confirmPullJob()`.

---

## Part B: Rework card buttons — remove "Assign to Bay" advance, keep "Assign Bay"

**File: `/logistics/loading.html`**

### B1: Fix the status advance flow for awaiting cards

The current `renderAssignmentCard()` (around line 264) shows TWO buttons on awaiting cards:
- **"Assign Bay"** (blue outlined) — opens modal to pick a bay. This is correct behavior.
- **"Assign to Bay"** (dark button) — from `getAdvanceLabel('not_started')` — this blindly advances status to `not_started` without actually assigning a bay. This is wrong.

**Fix:** In `renderAssignmentCard()`, change the advance button logic so that cards with `loading_status === 'awaiting'` do NOT get the generic advance button. The "Assign Bay" button (which opens the modal) is the only action for awaiting cards.

Replace the card actions section (around lines 281-284):

```js
<div class="ld-card-actions">
  ${a.loading_status === 'awaiting' && isManager
    ? `<button class="ld-btn-assign" onclick="openAssignBayModal('${a.id}')">Assign Bay</button>`
    : ''}
  ${next && a.loading_status !== 'awaiting'
    ? `<button class="ld-btn-advance" onclick="advanceStatus('${a.id}', '${next}')">${getAdvanceLabel(next)}</button>`
    : ''}
  ${showArchiveBtn
    ? `<button class="ld-btn-archive" onclick="archiveAssignment('${a.id}')">Archive</button>`
    : ''}
</div>
```

The key change: add `&& a.loading_status !== 'awaiting'` to the advance button condition.

### B2: Rework `openAssignBayModal()` to use a simple bay picker instead of reusing the Pull Job modal

Replace `openAssignBayModal()` with a dedicated bay assignment flow. Instead of reusing the pull-job modal (which has a confusing job search field), create a small inline assign-bay modal.

Add a new modal to the HTML (after the existing pull-job-modal):

```html
<div id="assign-bay-modal" class="ld-modal-backdrop" hidden>
  <div class="ld-modal-card" style="max-width:360px;">
    <div class="ld-modal-header">
      <h3>Assign to Bay</h3>
      <button onclick="closeAssignBayModal()" class="ld-modal-close">✕</button>
    </div>
    <div class="ld-modal-body">
      <label>Select Bay</label>
      <select id="assign-bay-select">
        <!-- populated dynamically -->
      </select>
    </div>
    <div class="ld-modal-footer">
      <button onclick="closeAssignBayModal()" class="ld-btn-cancel">Cancel</button>
      <button onclick="confirmAssignBay()" class="ld-btn-confirm">Assign</button>
    </div>
  </div>
</div>
```

**IMPORTANT:** Since Bug 1 from Prompt 43 adds `.ld-modal-backdrop[hidden] { display: none !important; }`, this new modal will also benefit from that fix. Make sure the Prompt 43 CSS fix is in place (if not already applied, add it now).

Replace `openAssignBayModal()`:

```js
let assignBayTargetId = null;

function openAssignBayModal(assignmentId) {
  assignBayTargetId = assignmentId;
  const sel = document.getElementById('assign-bay-select');
  sel.innerHTML = allBays.map(b =>
    `<option value="${b.id}">Bay ${b.bay_number}${b.trailer_number ? ' — TR# ' + b.trailer_number : ''}</option>`
  ).join('');
  document.getElementById('assign-bay-modal').hidden = false;
}

function closeAssignBayModal() {
  document.getElementById('assign-bay-modal').hidden = true;
  assignBayTargetId = null;
}

async function confirmAssignBay() {
  if (!assignBayTargetId) return;
  const bayId = document.getElementById('assign-bay-select').value;
  if (!bayId) { alert('Select a bay'); return; }
  
  try {
    const res = await fetch('/api/loading-assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: assignBayTargetId, bay_id: bayId, loading_status: 'not_started' }),
    });
    const data = await res.json();
    if (data.ok) {
      closeAssignBayModal();
      loadDashboard();
    } else {
      alert(data.error || 'Failed to assign bay');
    }
  } catch (e) {
    console.error('Assign bay failed:', e);
  }
}
```

### B3: Add drag-and-drop as an alternative to the modal

Add drag-and-drop so cards in the "Awaiting Trailer Assignment" section can be dragged onto bay columns.

**On the cards:** In `renderAssignmentCard()`, add `draggable="true"` and drag event handlers to awaiting cards:

```js
// At the top of renderAssignmentCard, add drag attributes for awaiting cards:
const dragAttrs = a.loading_status === 'awaiting'
  ? `draggable="true" ondragstart="onCardDragStart(event, '${a.id}')"`
  : '';

// Then in the returned HTML, add dragAttrs to the outer div:
<div class="ld-card" ${dragAttrs} style="..." data-assignment-id="${a.id}">
```

**On the bay columns:** In `renderOverview()`, add drop zone handlers to each bay column's `.ld-bay-body`:

```js
// In the bay column HTML template, add drag handlers to the bay body div:
<div class="ld-bay-body"
  ondragover="event.preventDefault(); this.style.background='#dbeafe';"
  ondragleave="this.style.background='';"
  ondrop="onBayDrop(event, '${bay.id}'); this.style.background='';">
```

**Drag functions:**

```js
let draggedAssignmentId = null;

function onCardDragStart(event, assignmentId) {
  draggedAssignmentId = assignmentId;
  event.dataTransfer.effectAllowed = 'move';
  event.target.style.opacity = '0.5';
  // Restore opacity after drag ends
  event.target.addEventListener('dragend', () => { event.target.style.opacity = '1'; }, { once: true });
}

async function onBayDrop(event, bayId) {
  event.preventDefault();
  if (!draggedAssignmentId) return;
  
  try {
    const res = await fetch('/api/loading-assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: draggedAssignmentId, bay_id: bayId, loading_status: 'not_started' }),
    });
    const data = await res.json();
    if (data.ok) {
      loadDashboard();
    } else {
      alert(data.error || 'Failed to assign bay');
    }
  } catch (e) {
    console.error('Drop assign failed:', e);
  }
  draggedAssignmentId = null;
}
```

**Add a CSS grab cursor for draggable cards:**

```css
.ld-card[draggable="true"] { cursor: grab; }
.ld-card[draggable="true"]:active { cursor: grabbing; }
```

---

## Part C: Implement VAPID Web Push in `sendPushNotification()`

**File: `_worker.js`**

Replace the `sendPushNotification()` stub (line ~4336-4340) with a full VAPID-signed web push implementation. This runs in a Cloudflare Worker, so it must use the Web Crypto API (no Node.js `crypto` module).

The implementation needs to:

1. Build a JWT (JSON Web Token) signed with the VAPID private key (ES256 / P-256 / ECDSA)
2. Encrypt the payload using the subscriber's `p256dh` and `auth` keys (RFC 8291 — aes128gcm content encoding)
3. Send the encrypted payload to the push endpoint with proper headers

Here is the complete implementation. Replace the stub with all of these functions:

```js
// ── Web Push Helpers (VAPID + RFC 8291 encryption) ──────────────────────

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function base64UrlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBuffers(...buffers) {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer), offset);
    offset += buf.byteLength;
  }
  return result;
}

async function importVapidPrivateKey(base64UrlPrivateKey) {
  const rawPrivate = base64UrlDecode(base64UrlPrivateKey);
  // Build JWK from raw 32-byte private key
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: base64UrlEncode(rawPrivate),
    // We need x,y — derive from private key by generating a temp key pair? 
    // Actually, for signing JWTs we only need the private key. Import as JWK with x,y derived.
  };
  // Alternative: import raw private + derive public
  // For Workers, import the private key as PKCS8
  // Build PKCS8 from raw 32-byte scalar
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48,
    0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
    0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20,
  ]);
  const pkcs8 = concatBuffers(pkcs8Prefix, rawPrivate);
  
  return crypto.subtle.importKey(
    'pkcs8', pkcs8.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function getVapidPublicKeyBytes(base64UrlPublicKey) {
  return base64UrlDecode(base64UrlPublicKey);
}

async function createVapidJwt(env, audience) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 86400, // 24 hours
    sub: 'mailto:ops@xpandafoam.com',
  };
  
  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  
  const privateKey = await importVapidPrivateKey(env.VAPID_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    enc.encode(signingInput)
  );
  
  // Convert DER signature to raw r||s (64 bytes)
  const sigBytes = new Uint8Array(signature);
  let r, s;
  if (sigBytes[0] === 0x30) {
    // DER encoded
    let offset = 2;
    const rLen = sigBytes[offset + 1];
    r = sigBytes.slice(offset + 2, offset + 2 + rLen);
    offset = offset + 2 + rLen;
    const sLen = sigBytes[offset + 1];
    s = sigBytes.slice(offset + 2, offset + 2 + sLen);
    // Pad/trim to 32 bytes each
    if (r.length > 32) r = r.slice(r.length - 32);
    if (r.length < 32) { const p = new Uint8Array(32); p.set(r, 32 - r.length); r = p; }
    if (s.length > 32) s = s.slice(s.length - 32);
    if (s.length < 32) { const p = new Uint8Array(32); p.set(s, 32 - s.length); s = p; }
  } else {
    // Already raw
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32, 64);
  }
  const rawSig = concatBuffers(r, s);
  
  return `${signingInput}.${base64UrlEncode(rawSig)}`;
}

async function encryptPushPayload(p256dhKey, authSecret, payloadText) {
  const enc = new TextEncoder();
  const payloadBytes = enc.encode(payloadText);
  
  // Subscriber's public key
  const subscriberPubBytes = base64UrlDecode(p256dhKey);
  const subscriberPubKey = await crypto.subtle.importKey(
    'raw', subscriberPubBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  
  // Auth secret
  const authBytes = base64UrlDecode(authSecret);
  
  // Generate ephemeral ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  
  // Export local public key (65 bytes uncompressed)
  const localPubBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', localKeyPair.publicKey)
  );
  
  // ECDH shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: subscriberPubKey },
      localKeyPair.privateKey,
      256
    )
  );
  
  // HKDF to derive IKM from shared secret + auth
  // PRK = HMAC-SHA-256(auth, sharedSecret)
  const authKey = await crypto.subtle.importKey(
    'raw', authBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const prk = new Uint8Array(
    await crypto.subtle.sign('HMAC', authKey, sharedSecret)
  );
  
  // info for IKM: "WebPush: info\0" + subscriber_pub + local_pub
  const infoPrefix = enc.encode('WebPush: info\0');
  const ikm_info = concatBuffers(infoPrefix, subscriberPubBytes, localPubBytes);
  
  // IKM = HKDF-Expand(PRK, info, 32)
  const ikm = await hkdfExpand(prk, ikm_info, 32);
  
  // Generate 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  // Derive CEK and nonce from IKM using salt
  // PRK2 = HMAC-SHA-256(salt, IKM)
  const saltKey = await crypto.subtle.importKey(
    'raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const prk2 = new Uint8Array(
    await crypto.subtle.sign('HMAC', saltKey, ikm)
  );
  
  const cekInfo = enc.encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = enc.encode('Content-Encoding: nonce\0');
  
  const cek = await hkdfExpand(prk2, cekInfo, 16);
  const nonce = await hkdfExpand(prk2, nonceInfo, 12);
  
  // Pad payload (add delimiter byte 0x02 + no padding for simplicity)
  const padded = concatBuffers(payloadBytes, new Uint8Array([2]));
  
  // Encrypt with AES-128-GCM
  const aesKey = await crypto.subtle.importKey(
    'raw', cek, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      aesKey,
      padded
    )
  );
  
  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const idlen = new Uint8Array([65]); // uncompressed P-256 key length
  
  const body = concatBuffers(salt, rs, idlen, localPubBytes, ciphertext);
  
  return body;
}

async function hkdfExpand(prk, info, length) {
  // HKDF-Expand with single iteration (length <= 32)
  const key = await crypto.subtle.importKey(
    'raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const input = concatBuffers(info, new Uint8Array([1]));
  const output = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, input)
  );
  return output.slice(0, length);
}

async function sendPushNotification(env, subscription, payload) {
  try {
    const endpointUrl = new URL(subscription.endpoint);
    const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
    
    const jwt = await createVapidJwt(env, audience);
    const vapidPubBytes = base64UrlEncode(base64UrlDecode(env.VAPID_PUBLIC_KEY));
    
    const payloadJson = JSON.stringify(payload);
    const encryptedBody = await encryptPushPayload(
      subscription.p256dh,
      subscription.auth_key,
      payloadJson
    );
    
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `vapid t=${jwt}, k=${vapidPubBytes}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': '86400',
        'Urgency': 'normal',
      },
      body: encryptedBody,
    });
    
    if (res.status === 410 || res.status === 404) {
      const err = new Error('Subscription expired');
      err.statusCode = res.status;
      throw err;
    }
    
    if (!res.ok) {
      console.error('Push send failed:', res.status, await res.text());
    }
  } catch (e) {
    if (e.statusCode === 410 || e.statusCode === 404) throw e;
    console.error('Push notification error:', e);
  }
}
```

**Delete** the existing `sendPushNotification()` stub and all its comment lines, replacing with the full implementation above.

**IMPORTANT:** The helper functions (`base64UrlDecode`, `base64UrlEncode`, `concatBuffers`, `importVapidPrivateKey`, `getVapidPublicKeyBytes`, `createVapidJwt`, `encryptPushPayload`, `hkdfExpand`) should be placed immediately before `sendPushNotification()` in the file.

Also update the `mailto:` subject in `createVapidJwt` — the `sub` field should be `'mailto:ops@xpandafoam.com'` (change if a different email is preferred).

---

## Part D: Service worker — NO CHANGES NEEDED

**File: `/sw.js`** — Already complete. Has push event listener, notification display, click-to-navigate, and dismiss action. Do not modify.

---

## Files to modify

1. **`_worker.js`** — Part A (auto-create loading assignment on job Done) + Part C (VAPID web push implementation)
2. **`/logistics/loading.html`** — Part B (card button rework, new assign-bay modal, drag-and-drop)

## Files NOT to modify

- `logistics-header.js`
- `logistics-shared.css`
- `jobs/index.html` — do NOT change the job board
- `admin/roles.html`
- Any SQL files

---

## Verification checklist

- [ ] Create a new job on the job board and move it to "Done" → it appears in the loading dashboard under "Awaiting Trailer Assignment" automatically
- [ ] Manually pulling a job via "+ Pull Job" still works for jobs that haven't reached Done
- [ ] Awaiting cards show only ONE button: "Assign Bay" (blue outlined) — no dark "Assign to Bay" button
- [ ] Clicking "Assign Bay" opens the new dedicated bay picker modal (no job search field)
- [ ] Selecting a bay and clicking "Assign" moves the card into that bay column
- [ ] Dragging an awaiting card onto a bay column assigns it to that bay
- [ ] Cards in bays still have their normal advance buttons (Start Loading, Mark Loaded, etc.)
- [ ] VAPID keys are set as environment variables in Cloudflare dashboard
- [ ] Push notifications deliver to subscribed browsers when loading status changes

---

## Manual steps after deployment

1. In Cloudflare Dashboard → Workers → xpanda-ops → Settings → Variables, add:
   - `VAPID_PUBLIC_KEY` = `BNt2c4n2RvPZf7tR4TRcmvsA9zWp39DJGuOVDdZ0CjC21ewoR5ySp_iLZzF7rFDWH7ZMEt7GTYSPyM-UXBjN5Kk`
   - `VAPID_PRIVATE_KEY` = `F-CcoI_Z-v5n33kaXiOYbznSlrjKRSh8LgR-31skMak` (mark as **Encrypt**)
2. After deploying, visit the loading dashboard — the browser should prompt for notification permission. Accept it to register for push.
