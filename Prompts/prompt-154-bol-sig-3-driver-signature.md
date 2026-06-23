# BOL Signatures #3 — Driver Signature Capture (infrastructure + driver)

> Assign a number before committing (likely **P154**). **Prompt 3 of 5.** Depends on #1 (storage
> endpoints) and #2 (`copyType`), both landed. This prompt builds the signing pipeline on the
> `track/` page and wires the **driver** signature. #4 reuses everything for the customer.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent** (`track/index.html`)
+ **db-api-agent** (one `public.js` SELECT widen). The signed copy is rendered **client-side** via
`BolShared.generatePdf` (the single source of truth — not duplicated server-side).

## Design
At delivery, the driver signs on the `track/` page. On submit: render the **driver copy**
(`copyType:'driver'`, with QR) from the BOL record, stamp the signature onto it via pdf-lib, base64
it, and POST to `/api/public/bol-document/:token` (`doc_type:'driver_signed'`) from #1. The existing
delivery photo flow is **untouched**. To render client-side the page needs the full BOL record +
the rendering libs, neither of which it loads today — both added here.

## Files
- `_worker.js/routes/public.js` — widen the lookup SELECT (1 edit)
- `track/index.html` — libs, signature pad, stamp/upload pipeline, wiring (6 edits)

---

### Edit 1 — `_worker.js/routes/public.js` : return the full BOL record on lookup

The client must render the copy, so it needs every field `generatePdf` consumes (incl. `render_overrides`). `access_token` is still stripped before return; the client re-adds it from the URL.

FIND (count == 1):
```
    SELECT bol_number, date, ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
           ship_to_city, ship_to_state, ship_to_zip, commodity_description, delivery_time,
           carrier_name, trailer_no, job_id, access_token
    FROM bols WHERE access_token = ?
```
REPLACE:
```
    SELECT * FROM bols WHERE access_token = ?
```

### Edit 2 — `track/index.html` : load pdf-lib + qrcode + bol-shared

FIND (count == 1):
```
</head>
```
REPLACE:
```
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
<script src="/logistics/bol-shared.js"></script>
</head>
```

### Edit 3 — `track/index.html` : signature pad styles

FIND (count == 1):
```
  .photo-btn { display: block; width: 100%; padding: 14px; border: 2px dashed var(--border); border-radius: 10px; text-align: center; background: #fafafa; cursor: pointer; font-weight: 600; color: var(--muted); }
```
REPLACE:
```
  .photo-btn { display: block; width: 100%; padding: 14px; border: 2px dashed var(--border); border-radius: 10px; text-align: center; background: #fafafa; cursor: pointer; font-weight: 600; color: var(--muted); }
  .sig-wrap { margin-top: 8px; }
  .sig-pad { width: 100%; height: 180px; border: 2px solid var(--border); border-radius: 10px; background: #fff; touch-action: none; display: block; }
  .sig-clear { margin-top: 6px; padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px; background: #fafafa; cursor: pointer; font-weight: 600; color: var(--muted); }
```

### Edit 4 — `track/index.html` : pipeline helpers + state + signature coords

FIND (count == 1):
```
  let photoDataUrl = null;
  let photoBase64 = null;
```
REPLACE:
```
  let photoDataUrl = null;
  let photoBase64 = null;
  let driverSigPad = null;

  // Signature stamp placement (pdf-lib origin = bottom-left; US Letter 612×792).
  // ⚠ Best-guess coords — TUNE against the real driver/customer templates after first render.
  const SIG_COORDS = {
    driver:   { x: 80,  y: 95, w: 190, h: 55 },
    customer: { x: 340, y: 95, w: 190, h: 55 },
  };

  function initSignaturePad(canvas, onEnd) {
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    let drawing = false, hasInk = false;
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const t = (e.touches && e.touches[0]) ? e.touches[0] : e;
      return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) };
    }
    function start(e) { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
    function move(e)  { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasInk = true; e.preventDefault(); }
    function end()    { if (drawing && onEnd) onEnd(); drawing = false; }
    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false }); canvas.addEventListener('touchmove', move, { passive: false }); canvas.addEventListener('touchend', end);
    return {
      isEmpty: () => !hasInk,
      clear:   () => { ctx.clearRect(0, 0, canvas.width, canvas.height); hasInk = false; },
      dataUrl: () => canvas.toDataURL('image/png'),
    };
  }

  async function stampSignature(basePdfBytes, sigDataUrl, c) {
    const { PDFDocument } = PDFLib;
    const doc = await PDFDocument.load(basePdfBytes);
    const png = await doc.embedPng(sigDataUrl);
    doc.getPages()[0].drawImage(png, { x: c.x, y: c.y, width: c.w, height: c.h });
    return await doc.save();
  }

  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  async function uploadSignedCopy(copyType, pad) {
    if (!pad || pad.isEmpty()) return;
    const bolForRender = { ...currentBol, access_token: token };
    const { pdfBytes } = await BolShared.generatePdf([bolForRender], { copyType });
    const coords  = copyType === 'driver' ? SIG_COORDS.driver : SIG_COORDS.customer;
    const stamped = await stampSignature(pdfBytes, pad.dataUrl(), coords);
    const docType = copyType === 'driver' ? 'driver_signed' : 'customer_signed';
    const r = await fetch('/api/public/bol-document/' + encodeURIComponent(token), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_type: docType, pdf_base64: bytesToBase64(stamped) }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'signed copy upload failed');
  }
```

### Edit 5 — `track/index.html` : add the driver pad to the delivery form + wire it + gate submit

5a — markup (before the submit button). FIND (count == 1):
```
      <button class="btn btn-success" id="submit-btn" disabled>Submit Delivery</button>
    `;
```
REPLACE:
```
      <label class="field">Driver signature</label>
      <div class="sig-wrap">
        <canvas id="driver-sig" class="sig-pad" width="600" height="180"></canvas>
        <button type="button" class="sig-clear" id="driver-sig-clear">Clear</button>
      </div>

      <button class="btn btn-success" id="submit-btn" disabled>Submit Delivery</button>
    `;
```

5b — wiring. FIND (count == 1):
```
    document.getElementById('photo-input').addEventListener('change', handlePhotoSelect);
    document.getElementById('submit-btn').addEventListener('click', submitDelivery);
```
REPLACE:
```
    document.getElementById('photo-input').addEventListener('change', handlePhotoSelect);
    driverSigPad = initSignaturePad(document.getElementById('driver-sig'), updateSubmitState);
    document.getElementById('driver-sig-clear').addEventListener('click', () => { driverSigPad.clear(); updateSubmitState(); });
    document.getElementById('submit-btn').addEventListener('click', submitDelivery);
```

5c — gate. FIND (count == 1):
```
    if (btn) btn.disabled = !(accepted && photoBase64);
```
REPLACE:
```
    if (btn) btn.disabled = !(accepted && photoBase64 && driverSigPad && !driverSigPad.isEmpty());
```

### Edit 6 — `track/index.html` : upload the signed driver copy on submit

FIND (count == 1):
```
    btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const res = await fetch('/api/public/bol-delivery/' + encodeURIComponent(token), {
```
REPLACE:
```
    btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      await uploadSignedCopy('driver', driverSigPad);
      const res = await fetch('/api/public/bol-delivery/' + encodeURIComponent(token), {
```

---

## Verify
- All FINDs `count == 1`.
- `cp _worker.js/routes/public.js /tmp/public.mjs && node --check /tmp/public.mjs`
- Extract the `track/index.html` `<script>` block to a temp `.js` and `node --check` it.
- Confirm `/logistics/assets/BLANK_BOL_Xpanda_driver.pdf` is fetchable from the `track/` origin
  (public static asset). If not, that's a blocker — report it.
- End-to-end: open a `track/` link for an in-transit BOL → sign in the driver pad → Submit → a
  `driver_signed` row appears via `GET /api/bols/:id/documents`, and the stored PDF shows the driver
  template + QR + the stamped signature.
- **⚠ Signature placement:** `SIG_COORDS.driver` is a guess. Eyeball the stamped copy and report
  where the signature lands so we can tune it to the template's signature line.

## What NOT to change
- Do NOT alter the delivery-photo flow or `signed_bol_photo_key`.
- Do NOT add the customer pad yet (that's #4 — it reuses `uploadSignedCopy`, `initSignaturePad`,
  `stampSignature`, `SIG_COORDS.customer`).
- Do NOT touch `bol-shared.js`, `bol-compose.js`, auto-pack, or `STORAGE_KEY`.
- No migration.

## Deploy
```
git add _worker.js/routes/public.js track/index.html
git commit -m "P###: driver signature capture at delivery — render driver copy, stamp, store as driver_signed"
git push
```
