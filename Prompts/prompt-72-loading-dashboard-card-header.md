# Prompt 72 — Loading Dashboard: Card Header Restructure + Read-Only Shipping Info Modal

## Agents to assume

**Read BOTH agent files before starting: `AGENTS.md` AND `xpanda-ops-agents.md`.** Then assume this agent and follow its scope and the Orchestrator's cross-cutting rules:

- **Lead: logistics-agent** — owns `logistics/loading.html` (Loading Dashboard, both Overview and Loading Team View).

This prompt does NOT touch `_worker.js`, any DB migration, `bol-shared.js`, `bol-generator.html`, `load-builder.html`, `bol-editor.js`, or any other module/file.

## Goal

Restructure how cards display information on the Loading Dashboard. Today the card header is the customer name; INV# and load badge sit on a secondary meta line. This makes scanning by invoice — which is how the loading team actually identifies what they're picking — slower than it should be. The card design becomes:

- **Header (primary, bold):** `INV# 3994` + `Load 2 of 5` badge inline (when `load_count > 1`)
- **Subtext (small, muted):** customer name, truncated to 20 characters with `…`, with the full name in a `title` tooltip for desktop hover
- **City/state line:** unchanged
- **INV# is clickable** — opens a read-only modal showing shipping address, contact info, ship date, carrier, method, and load info. No edit affordance.

This change applies to **every card render path** in the file. There is one renderer (`renderAssignmentCard`) consumed by both Overview and Loading Team View, so a single edit cascades to all card surfaces.

---

## Part 1 — Card header restructure (`renderAssignmentCard`)

Find `renderAssignmentCard` (around line 425). The current structure is:

```javascript
    <div class="ld-card" ${dragAttrs} style="border-left:4px solid ${sc.border};background:${sc.bg};" data-assignment-id="${a.id}">
      <div class="ld-card-header">
        <strong>${esc(a.customer || 'Unknown')}</strong>
        <!-- status badge or similar -->
      </div>
      <div class="ld-card-meta">
        ${a.invoice_number ? `<span>INV# ${esc(a.invoice_number)}</span>` : ''}
        ${(a.load_count || 1) > 1 ? `<span style="font-weight:700;color:#6366f1;">Load ${a.load_number || 1} of ${a.load_count}</span>` : ''}
        ${a.ship_to_city ? `<span>${esc(a.ship_to_city)}${a.ship_to_state ? ', ' + esc(a.ship_to_state) : ''}</span>` : ''}
      </div>
      ...
```

Replace the `<div class="ld-card-header">` block and the meta-line INV/Load spans so that INV# + load badge live in the header (bold, primary text) and the customer name moves to a new subtext row below the header. Truncate the customer to 20 chars.

### 1a. Add a small string helper near the top of the script block (near `esc` / `escAttr`)

```javascript
function truncate(s, n) {
  if (s == null) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}
```

### 1b. Replace the header + first part of meta in `renderAssignmentCard`

Replace:

```javascript
      <div class="ld-card-header">
        <strong>${esc(a.customer || 'Unknown')}</strong>
        <!-- whatever existing right-side content was here (status badge, etc.) — KEEP IT -->
      </div>
      <div class="ld-card-meta">
        ${a.invoice_number ? `<span>INV# ${esc(a.invoice_number)}</span>` : ''}
        ${(a.load_count || 1) > 1 ? `<span style="font-weight:700;color:#6366f1;">Load ${a.load_number || 1} of ${a.load_count}</span>` : ''}
        ${a.ship_to_city ? `<span>${esc(a.ship_to_city)}${a.ship_to_state ? ', ' + esc(a.ship_to_state) : ''}</span>` : ''}
      </div>
```

with:

```javascript
      <div class="ld-card-header">
        <strong>
          ${a.invoice_number
            ? `<a href="#" class="ld-inv-link" onclick="event.preventDefault(); event.stopPropagation(); openShippingInfo('${esc(a.id)}'); return false;">INV# ${esc(a.invoice_number)}</a>`
            : 'No INV#'}
          ${(a.load_count || 1) > 1
            ? `<span style="font-weight:700;color:#6366f1;margin-left:6px;font-size:11px;">Load ${a.load_number || 1} of ${a.load_count}</span>`
            : ''}
        </strong>
        <!-- whatever existing right-side content was here (status badge, etc.) — KEEP IT EXACTLY AS-IS -->
      </div>
      <div class="ld-card-subtext" title="${escAttr(a.customer || 'Unknown')}" style="font-size:11px;color:#6b7280;margin-bottom:4px;">
        ${esc(truncate(a.customer || 'Unknown', 20))}
      </div>
      <div class="ld-card-meta">
        ${a.ship_to_city ? `<span>${esc(a.ship_to_city)}${a.ship_to_state ? ', ' + esc(a.ship_to_state) : ''}</span>` : ''}
      </div>
```

**Implementer notes (do not transcribe into the file):**
- The right-side content currently inside `ld-card-header` (status badge, "AWAITING" / "LOADING" pill, etc.) MUST be preserved exactly. The comment markers in the snippet above are placeholders — keep whatever is there.
- `event.stopPropagation()` on the INV# link is critical because the card is draggable; without it, clicking the link starts a drag.
- The link uses class `ld-inv-link` so we can style it without inline rules per-card.
- The `title` attribute on the subtext gives the full customer name on desktop hover; mobile users won't see it but they aren't the primary audience here.

### 1c. Add styles for `.ld-inv-link` and `.ld-card-subtext`

Find the existing `.ld-card-header` CSS block (around line 33–37) and add immediately after:

```css
    .ld-card-subtext { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
    .ld-inv-link { color: #1e40af; text-decoration: underline; cursor: pointer; }
    .ld-inv-link:hover { color: #1e3a8a; }
```

(The inline `style=` on the subtext div above is redundant once this CSS lands; remove the inline style from the rendered string to keep things clean. Either is acceptable — the class version is preferred.)

### 1d. Card sizing

Do NOT change `.ld-card` padding, the 260px width rule, the border-left swatch, the drag attributes, the action button rendering (Assign Bay, View BOL, etc.), or any color logic. Compaction is Prompt 73's job.

---

## Part 2 — Read-only shipping info modal

### 2a. Modal markup

Add a new modal alongside the existing `.ld-modal-overlay` modals in the markup (after the "Pull Job" modal block, before the script tag — wherever fits the existing modal-group convention). The styling reuses `.ld-modal-overlay` and `.ld-modal-card` so it matches the rest of the dashboard.

```html
<div id="ld-shipping-info-modal" class="ld-modal-overlay" hidden onclick="if(event.target===this) closeShippingInfo()">
  <div class="ld-modal-card" style="max-width: 480px;">
    <div style="padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
      <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #111827;">Shipping Information</h3>
      <button onclick="closeShippingInfo()" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #6b7280; padding: 0; line-height: 1;">×</button>
    </div>
    <div id="ld-shipping-info-body" style="padding: 16px 20px; font-size: 13px; color: #374151; line-height: 1.5;">
      <!-- populated by populateShippingInfo -->
    </div>
  </div>
</div>
```

### 2b. Handlers

Add three functions near `viewBolForJob` (~line 846):

```javascript
// Cache to avoid refetching the same job multiple times in one session.
const shippingInfoJobCache = new Map();

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

function closeShippingInfo() {
  document.getElementById('ld-shipping-info-modal').hidden = true;
}

function populateShippingInfo(job, a) {
  // Build a clean read-only block. All fields are optional — render the row only when the value exists.
  const row = (label, value) => value
    ? `<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="min-width:110px;color:#6b7280;font-weight:600;">${esc(label)}:</span><span>${esc(value)}</span></div>`
    : '';

  const streetLine = [job.ship_to_street, job.ship_to_street2].filter(Boolean).join(', ');
  const cityStateZip = [job.ship_to_city, job.ship_to_state, job.ship_to_zip].filter(Boolean).join(', ');

  document.getElementById('ld-shipping-info-body').innerHTML = `
    <div style="font-weight:700;font-size:14px;color:#111827;margin-bottom:10px;">
      INV# ${esc(a.invoice_number || job.invoice_number || '—')}
      ${(a.load_count || 1) > 1 ? `<span style="font-weight:700;color:#6366f1;margin-left:8px;font-size:12px;">Load ${a.load_number || 1} of ${a.load_count}</span>` : ''}
    </div>
    ${row('Customer', job.customer)}
    ${row('Ship To', job.ship_to_company)}
    ${row('Attention', job.ship_to_attention)}
    ${row('Address', streetLine)}
    ${row('', cityStateZip)}
    ${row('Contact', job.ship_to_contact_name)}
    ${row('Phone', job.ship_to_phone)}
    ${row('Email', job.ship_to_email)}
    ${row('PO #', job.po_number)}
    ${row('Ship Date', job.ship_date)}
    ${row('Delivery Time', job.delivery_time)}
    ${row('Carrier', job.carrier)}
    ${row('Method', job.method)}
    ${row('Notes', job.notes)}
  `;
}
```

**Implementer notes:**
- This uses `/api/jobs/:id` which already returns the full job row (see the existing `viewBolForJob` pattern). No worker change needed.
- The `row()` helper silently skips empty values — fields that don't exist on a particular job won't render an empty line.
- `job.ship_to_attention`, `ship_to_zip`, `ship_to_street`, `ship_to_street2`, `ship_to_contact_name`, `ship_to_phone`, `ship_to_email`, `delivery_time` are all existing columns on `jobs` (per the platform's BOL flow). If any are missing on a given row they simply don't render — no errors.
- `populateShippingInfo` reuses some inline styling rather than CSS classes because the modal body is one-shot template content; that matches existing modal patterns in the file.

### 2c. ESC-key close

If there's an existing global ESC handler that closes other modals, extend it to also close `ld-shipping-info-modal`. If there's no existing handler, add a small one targeted at this modal only:

```javascript
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('ld-shipping-info-modal').hidden) {
    closeShippingInfo();
  }
});
```

Place it inside the existing IIFE / script block, near other top-level event listeners. Do not introduce a global ESC handler that closes ALL modals if one doesn't already exist — scope it to this one.

---

## Scope Constraints (strict)

- **One file only:** `logistics/loading.html`.
- Do NOT touch the worker, any other module, the BOL view path (`viewBolForJob` — that's Prompt 73), or any drag-and-drop logic.
- Do NOT change card padding, card width, action button rendering, color logic, or section structure. Density/compaction is Prompt 73.
- Preserve all existing right-side content in `ld-card-header` (status badges/pills). They stay exactly where they are.
- Do not introduce dependencies. No new CDN scripts.
- The shipping info modal is read-only. No edit buttons, no save, no form fields.

## Manual steps after build

- None (no migration).
- Verify:
  1. Card header reads `INV# 3994` (or `INV# 3994  Load 2 of 5` with the indigo badge) as the bold primary text.
  2. Customer name appears as small muted subtext below the header, truncated at 20 chars with `…` when longer. Hovering shows the full name in a tooltip.
  3. Clicking the INV# opens a read-only modal with shipping address, contact info, ship date, carrier, method, etc. The customer is NOT identified as `INV# Test` in the modal — it shows the actual job number.
  4. Clicking the INV# does NOT start a card drag. Clicking elsewhere on the card still allows dragging.
  5. Modal closes via × button, click-outside, or ESC.
  6. Every card on both Overview and Loading Team View uses the new header style (single renderer change).
