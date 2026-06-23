# P149 — BOL Download on Approve (Load Builder)

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent**,
`logistics/bol-compose.js` only. No backend, no migration.

## Goal
Approving a BOL from the Load Builder review flow only opens the PDF in a new tab
(`BolShared.openPdf`), forcing the user to Print → Save as PDF. Make approve trigger an actual
**file download** of the generated BOL. The review modal already shows the on-screen preview, so the
new-tab open is redundant and is replaced by the download.

## Background / shared-path note
The approve handler in `bol-compose.js`'s `showReview()` is the **shared** BOL flow — per the
P123–P128 unification, both `load-builder.html` and `bol-generator.html` run through `BolCompose`.
So this change makes **both** consumers download on approve, which is the desired behavior.
**Before committing, confirm `bol-generator.html` does not fire its own separate download** (search
for an existing download/`<a download>`/save trigger in its approve path). Current code only
`openPdf`s, so no existing download should collide — but verify to avoid a double download.

## File
- `logistics/bol-compose.js` — 1 edit in the `showReview` approve handler

---

### Edit — replace the new-tab open with a download trigger

FIND (count == 1):
```
      BolShared.openPdf(lbPendingBlobUrl);
      lbPendingBlobUrl = null;
      const bols = [...lbReviewBols];
```

REPLACE:
```
      // Trigger an actual download of the approved BOL (the review modal already showed the preview).
      const dlUrl  = lbPendingBlobUrl;
      const dlName = (lbReviewBols.length === 1 && lbReviewBols[0] && lbReviewBols[0].bol_number)
        ? `BOL-${lbReviewBols[0].bol_number}.pdf` : 'BOL.pdf';
      const dlA = document.createElement('a');
      dlA.href = dlUrl; dlA.download = dlName;
      document.body.appendChild(dlA); dlA.click(); dlA.remove();
      setTimeout(() => { try { URL.revokeObjectURL(dlUrl); } catch (e) {} }, 30000);
      lbPendingBlobUrl = null;
      const bols = [...lbReviewBols];
```

---

## Verify
- FIND `count == 1` (confirmed single occurrence of `BolShared.openPdf(lbPendingBlobUrl);`).
- Extract `logistics/bol-compose.js` to a temp `.js` (it's already a standalone script file) and
  `node --check` it.
- Test from Load Builder: generate → approve → the BOL downloads as a file (no manual Print→Save).
- Re-test from `bol-generator.html`: approve still works and does not double-download.

## What NOT to change
- Do NOT modify `bol-shared.js`, BOL coordinates, `generatePdf`, or the override-save logic.
- Do NOT remove the review/approve flow (the intentional "stop auto-download" from P53–P58 stays;
  this adds a deliberate download **on approve**, not an auto-download at generate time).
- Do NOT touch auto-pack, `STORAGE_KEY`, or load-builder layout.

## Deploy
```
git add logistics/bol-compose.js
git commit -m "P149: download the approved BOL from the Load Builder review flow (replace new-tab open)"
git push
```
