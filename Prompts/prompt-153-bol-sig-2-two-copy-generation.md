# BOL Signatures #2 — Two-Copy Generation (driver/customer templates + QR toggle)

> Assign a prompt number before committing (likely **P153**). **Prompt 2 of 5.** Depends on #1
> (landed). Templates are in place: `BLANK_BOL_Xpanda{,_driver,_customer}.pdf` in `logistics/assets/`.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent**, `logistics/bol-shared.js`
only — this is the single source of truth for BOL rendering. The change is **additive and
backward-compatible**: callers that pass no `copyType` get exactly today's behavior.

## Goal
Teach `BolShared.generatePdf` to render a specific copy:
- `opts.copyType === 'driver'` → load `BLANK_BOL_Xpanda_driver.pdf`, draw the QR (driver gets the tracking QR).
- `opts.copyType === 'customer'` → load `BLANK_BOL_Xpanda_customer.pdf`, **never** draw the QR.
- no `copyType` → unchanged: `BLANK_BOL_Xpanda.pdf` + QR when `access_token` exists.

This also resolves the "BOL generator has no QR" issue for the canonical driver copy: when rendered
from a **saved** BOL (which has an `access_token`), the driver copy now draws the QR. Later prompts
(#3–#5) pass `copyType` from the signing flow and the Documents directory.

## File
- `logistics/bol-shared.js` — 2 edits

---

### Edit 1 — select the template by copy type

FIND (count == 1):
```
    const templateResp = await fetch('/logistics/assets/BLANK_BOL_Xpanda.pdf');
    if (!templateResp.ok) throw new Error('BOL template not found at /logistics/assets/BLANK_BOL_Xpanda.pdf');
```

REPLACE:
```
    const TEMPLATE_BY_COPY = {
      driver:   '/logistics/assets/BLANK_BOL_Xpanda_driver.pdf',
      customer: '/logistics/assets/BLANK_BOL_Xpanda_customer.pdf',
    };
    const templateUrl = TEMPLATE_BY_COPY[opts.copyType] || '/logistics/assets/BLANK_BOL_Xpanda.pdf';
    const templateResp = await fetch(templateUrl);
    if (!templateResp.ok) throw new Error(`BOL template not found at ${templateUrl}`);
```

### Edit 2 — suppress the QR on the customer copy

FIND (count == 1):
```
      if (bol.access_token && typeof qrcode === 'function') {
```

REPLACE:
```
      if (opts.copyType !== 'customer' && bol.access_token && typeof qrcode === 'function') {
```

---

## Verify
- Both FINDs `count == 1`.
- Extract `logistics/bol-shared.js` to a temp `.js` and `node --check` it.
- **Backward compatibility:** call `generatePdf(records)` with no `copyType` and confirm output is
  identical to before (original template, QR when `access_token` present).
- **Driver/customer:** from the `logistics/bol-test.html` harness (or console) render a **saved** BOL
  with `{ copyType: 'driver' }` → driver template + QR; `{ copyType: 'customer' }` → customer
  template, **no** QR.

## ⚠️ Two things to eyeball on the first render (likely follow-up tweaks)
1. **Field alignment.** `COORDS` are shared across all three templates. This assumes the driver/
   customer templates keep the original field layout. If any field is shifted on a template, that
   copy needs per-copy coordinate overrides — flag it and we'll add a `COORDS` variant keyed by
   `copyType`. Do **not** guess; report misalignment instead.
2. **QR placement on the driver copy.** `COORDS.qrCode` (x:55, y:170, size:60) was tuned for the
   original template. If the driver template has a designated QR box elsewhere, the QR won't land in
   it — note where it lands so we can nudge `COORDS.qrCode` for the driver copy.

## What NOT to change
- Do NOT change `COORDS` for the default copy, or any field-drawing logic.
- Do NOT wire call sites yet (bol-generator / load-builder / directory) — prompts #3–#5 thread `copyType`.
- Do NOT touch auto-pack, `STORAGE_KEY`, `bol-compose.js`, or the worker.
- No migration.

## Deploy
```
git add logistics/bol-shared.js
git commit -m "P###: generatePdf copyType support — driver/customer templates + customer QR suppression"
git push
```
