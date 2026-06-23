# BOL Signatures #4 — Customer Signature Capture

> Assign a number before committing (likely **P155**). **Prompt 4 of 5.** Depends on #3 — it reuses
> the `initSignaturePad`, `stampSignature`, `uploadSignedCopy`, and `SIG_COORDS.customer` machinery
> #3 added. The FIND anchors below reference text introduced by #3, so run #3 first.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent**, `track/index.html`
only. No backend, no migration — #1's endpoint and #2's `copyType` already handle storage and the
customer template.

## Design
After the driver signs, they hand the device to the customer, who signs on the same delivery screen.
On submit, the **customer copy** (`copyType:'customer'`, no QR) is rendered, stamped with the
customer signature, and stored as `customer_signed` — immediately after the driver copy, through the
same `uploadSignedCopy` helper.

## File
- `track/index.html` — 5 edits

---

### Edit 1 — customer pad state

FIND (count == 1):
```
  let driverSigPad = null;
```
REPLACE:
```
  let driverSigPad = null;
  let customerSigPad = null;
```

### Edit 2 — customer pad markup (between the driver pad and the submit button)

FIND (count == 1):
```
      <div class="sig-wrap">
        <canvas id="driver-sig" class="sig-pad" width="600" height="180"></canvas>
        <button type="button" class="sig-clear" id="driver-sig-clear">Clear</button>
      </div>

      <button class="btn btn-success" id="submit-btn" disabled>Submit Delivery</button>
```
REPLACE:
```
      <div class="sig-wrap">
        <canvas id="driver-sig" class="sig-pad" width="600" height="180"></canvas>
        <button type="button" class="sig-clear" id="driver-sig-clear">Clear</button>
      </div>

      <label class="field">Customer signature</label>
      <div class="sig-wrap">
        <canvas id="customer-sig" class="sig-pad" width="600" height="180"></canvas>
        <button type="button" class="sig-clear" id="customer-sig-clear">Clear</button>
      </div>

      <button class="btn btn-success" id="submit-btn" disabled>Submit Delivery</button>
```

### Edit 3 — wire the customer pad

FIND (count == 1):
```
    driverSigPad = initSignaturePad(document.getElementById('driver-sig'), updateSubmitState);
    document.getElementById('driver-sig-clear').addEventListener('click', () => { driverSigPad.clear(); updateSubmitState(); });
    document.getElementById('submit-btn').addEventListener('click', submitDelivery);
```
REPLACE:
```
    driverSigPad = initSignaturePad(document.getElementById('driver-sig'), updateSubmitState);
    document.getElementById('driver-sig-clear').addEventListener('click', () => { driverSigPad.clear(); updateSubmitState(); });
    customerSigPad = initSignaturePad(document.getElementById('customer-sig'), updateSubmitState);
    document.getElementById('customer-sig-clear').addEventListener('click', () => { customerSigPad.clear(); updateSubmitState(); });
    document.getElementById('submit-btn').addEventListener('click', submitDelivery);
```

### Edit 4 — require the customer signature to submit

FIND (count == 1):
```
    if (btn) btn.disabled = !(accepted && photoBase64 && driverSigPad && !driverSigPad.isEmpty());
```
REPLACE:
```
    if (btn) btn.disabled = !(accepted && photoBase64 && driverSigPad && !driverSigPad.isEmpty() && customerSigPad && !customerSigPad.isEmpty());
```

### Edit 5 — upload the signed customer copy on submit

FIND (count == 1):
```
      await uploadSignedCopy('driver', driverSigPad);
      const res = await fetch('/api/public/bol-delivery/' + encodeURIComponent(token), {
```
REPLACE:
```
      await uploadSignedCopy('driver', driverSigPad);
      await uploadSignedCopy('customer', customerSigPad);
      const res = await fetch('/api/public/bol-delivery/' + encodeURIComponent(token), {
```

---

## Verify
- All FINDs `count == 1`.
- Extract the `track/index.html` `<script>` block to a temp `.js` and `node --check` it.
- End-to-end: sign both pads → Submit → both `driver_signed` and `customer_signed` rows appear via
  `GET /api/bols/:id/documents`; the customer copy uses the customer template and has **no QR**.
- **⚠ `SIG_COORDS.customer`** is a guess — eyeball the stamped customer copy and report placement for tuning.

## Open product decision (flag, do not implement here)
Submit now requires **both** signatures. If a customer is absent at delivery, this blocks the driver.
If that's a real scenario, we'll add a "customer unavailable" path in a follow-up (skip the customer
copy, still record delivery). Leaving as required for now per the feature intent.

## What NOT to change
- Do NOT modify the helpers from #3 (`uploadSignedCopy`, `initSignaturePad`, `stampSignature`).
- Do NOT touch the photo flow, `bol-shared.js`, auto-pack, or `STORAGE_KEY`.
- No backend, no migration.

## Deploy
```
git add track/index.html
git commit -m "P###: customer signature capture at delivery — render customer copy (no QR), stamp, store as customer_signed"
git push
```
