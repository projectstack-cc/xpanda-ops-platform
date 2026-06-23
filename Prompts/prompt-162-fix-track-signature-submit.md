# FIX — Driver signature submit opens a blank BOL tab and never uploads

> Assign a number before committing. Urgent: the public driver delivery flow is broken — signatures
> never reach the server. Reflects HEAD of `track/index.html`.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent** — `track/index.html`
(public driver page) only. No worker, no migration, no shared-engine change.

## Symptom
On the driver page, hitting **Submit Delivery** opens a blank tab that then shows the BOL with **no
signatures**, and nothing is saved. The driver/customer signed copies never upload.

## Root cause
In `uploadSignedCopy()`, the render call omits `previewOnly`:

```
const { pdfBytes } = await BolShared.generatePdf([bolForRender], { copyType });
```

`BolShared.generatePdf` only returns `{ blobUrl, pdfBytes }` when `opts.previewOnly` is set. Without
it, the function takes its **non-preview** branch — `window.open(blobUrl, '_blank')` (the blank tab →
then the unsigned BOL) — and returns `undefined`. So `const { pdfBytes } = undefined` throws **before**
`stampCopy()` and the upload `fetch` ever run. The throw is swallowed by `submitDelivery()`'s empty
`catch {}`, which is why it surfaced only as a generic "network error."

## Fix

### Edit 1 — `track/index.html`: render off-screen, not in a new tab

FIND (count == 1):
```
    const { pdfBytes } = await BolShared.generatePdf([bolForRender], { copyType });
```
REPLACE:
```
    const { pdfBytes } = await BolShared.generatePdf([bolForRender], { copyType, previewOnly: true });
```

### Edit 2 — `track/index.html`: stop swallowing the real error

FIND (count == 1):
```
    } catch {
      btn.disabled = false; btn.textContent = 'Submit Delivery';
      alert('Network error during upload. Please try again.');
    }
```
REPLACE:
```
    } catch (err) {
      console.error('[track] submitDelivery failed', err);
      btn.disabled = false; btn.textContent = 'Submit Delivery';
      alert('Upload failed: ' + (err && err.message ? err.message : 'please try again.'));
    }
```

---

## Verify
- Both FINDs `count == 1`.
- Extract the `track/index.html` script to a temp `.js` and `node --check` it.
- On a live tracking link, complete the delivery flow (accept + photo + both signatures) → **no new
  tab opens**, both signed copies POST to `/api/public/bol-document/:token`, the stage advances to
  **Delivered**, and the signed copies appear in the shipment's Documents section.
- Confirm the stamped copies actually carry the customer + carrier signatures and the signing date.

## What NOT to change
- Do NOT alter `stampCopy`, `SLOTS`, the signature pads, `BolShared.generatePdf`, or the worker route.
- Do NOT touch the non-preview branch of `generatePdf` (other callers rely on the open-in-tab behavior).

## Deploy
```
git add track/index.html
git commit -m "P###: fix driver signature submit — render signed copies with previewOnly (no stray tab) + surface upload errors"
git push
```
