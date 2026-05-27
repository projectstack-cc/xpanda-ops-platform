# Prompt 58 — View BOL from Loading Cards

## Goal

Add a "View BOL" button on loading assignment cards so the loading team can view the Bill of Lading PDF directly from the loading dashboard. The button fetches the BOL record associated with the job, regenerates the PDF client-side using `BolShared.generatePdf()`, and opens it in a new tab.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

- Loading assignment cards are rendered by `renderAssignmentCard()` in `logistics/loading.html`.
- Each assignment has a `job_id` which links to the `jobs` table.
- The `bols` table has a `job_id` column — a BOL is linked to its originating job.
- The BOL PDF rendering is handled by `BolShared.generatePdf()` in `logistics/bol-shared.js`.
- `bol-shared.js` is loaded via `<script>` tag and exposes a global `BolShared` object.
- `bol-shared.js` depends on `pdf-lib` (also loaded via `<script>` tag from CDN).

Currently `loading.html` does NOT include `bol-shared.js` or `pdf-lib`.

---

## Step 1 — Add script dependencies to `loading.html`

In `logistics/loading.html`, find the existing `<script>` tags in `<head>` or at the bottom of the file. Add the following before the inline `<script>` block:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"></script>
<script src="/logistics/bol-shared.js"></script>
```

`pdf-lib` must load before `bol-shared.js` since `bol-shared.js` references `PDFLib`.

---

## Step 2 — Add "View BOL" button to assignment cards

In `renderAssignmentCard()`, add a "View BOL" button in the card actions section. This button should appear on cards in any status except `awaiting` (at that point no BOL likely exists yet).

Find the card actions `<div>`:

```javascript
<div class="ld-card-actions">
  ${a.loading_status === 'awaiting' && isManager
    ? `<button class="ld-btn-assign" onclick="openAssignBayModal('${a.id}')">Assign Bay</button>`
    : ''}
  ${next && a.loading_status !== 'awaiting'
    ? `<button class="ld-btn-advance" onclick="advanceStatus('${a.id}', '${next}')">${getAdvanceLabel(next)}</button>`
    : ''}
  ${showArchiveBtn ? `<button class="ld-btn-archive" onclick="archiveAssignment('${a.id}')">Archive</button>` : ''}
</div>
```

Add a "View BOL" button after the archive button (or at the end of the actions div):

```javascript
<div class="ld-card-actions">
  ${a.loading_status === 'awaiting' && isManager
    ? `<button class="ld-btn-assign" onclick="openAssignBayModal('${a.id}')">Assign Bay</button>`
    : ''}
  ${next && a.loading_status !== 'awaiting'
    ? `<button class="ld-btn-advance" onclick="advanceStatus('${a.id}', '${next}')">${getAdvanceLabel(next)}</button>`
    : ''}
  ${a.loading_status !== 'awaiting'
    ? `<button class="ld-btn-bol" onclick="viewBolForJob('${a.job_id}')">View BOL</button>`
    : ''}
  ${showArchiveBtn ? `<button class="ld-btn-archive" onclick="archiveAssignment('${a.id}')">Archive</button>` : ''}
</div>
```

---

## Step 3 — Add CSS for the View BOL button

In the `<style>` block of `loading.html`, add:

```css
.ld-btn-bol {
  background: #f0f9ff;
  color: #0369a1;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.ld-btn-bol:hover { background: #e0f2fe; }
```

---

## Step 4 — Add `viewBolForJob()` function

Add this function to the `<script>` block in `loading.html`:

```javascript
async function viewBolForJob(jobId) {
  try {
    // Fetch BOL records for this job
    const res = await fetch('/api/bols?job_id=' + encodeURIComponent(jobId));
    const data = await res.json();

    if (!data.ok || !data.bols || data.bols.length === 0) {
      alert('No BOL found for this job. Generate a BOL first from the BOL Generator or Load Builder.');
      return;
    }

    // Use the most recent BOL for this job
    const bol = data.bols[data.bols.length - 1];

    // Generate and open the PDF
    // Check if BolShared supports openPdf (added in Prompt 54)
    if (typeof BolShared.openPdf === 'function') {
      const result = await BolShared.generatePdf([bol], { previewOnly: true });
      BolShared.openPdf(result.blobUrl);
    } else {
      // Fallback if Prompt 54 hasn't been applied yet — generatePdf will open in new tab
      await BolShared.generatePdf([bol]);
    }
  } catch (e) {
    console.error('Failed to load BOL:', e);
    alert('Failed to load BOL. Please try again.');
  }
}
```

---

## Step 5 — Worker: ensure `/api/bols` supports `job_id` filter

Check that the `GET /api/bols` handler supports filtering by `job_id` query parameter. Find the bols GET handler in `_worker.js`.

If it already supports `?job_id=X` filtering, no change needed.

If it does NOT, add the filter. In the bols GET handler, find where the query is built and add:

```javascript
const jobId = url.searchParams.get('job_id');
if (jobId) {
  conditions.push("job_id = ?");
  binds.push(jobId);
}
```

---

## What NOT to touch

- Do NOT modify `bol-shared.js` — use its existing API
- Do NOT modify `bol-generator.html` or `load-builder.html`
- Do NOT modify `logistics/index.html` (logistics dashboard)
- Do NOT modify the loading assignment handlers (GET/POST/PUT)
- Do NOT modify the loading bay handlers
- Do NOT modify the checklist or photo features
- Do NOT modify card rendering beyond adding the button
- Do NOT modify the BOL POST/PUT handlers

---

## Completion checklist

- [ ] `loading.html`: `pdf-lib` CDN script tag added
- [ ] `loading.html`: `bol-shared.js` script tag added (after pdf-lib)
- [ ] `loading.html`: "View BOL" button on assignment cards (not shown on `awaiting` status)
- [ ] `loading.html`: `.ld-btn-bol` CSS style added
- [ ] `loading.html`: `viewBolForJob()` function fetches BOL by job_id and opens PDF
- [ ] `loading.html`: graceful error message if no BOL exists for the job
- [ ] `_worker.js`: GET `/api/bols` supports `?job_id=X` filter (add if missing)
- [ ] PDF opens in new tab, no auto-download
- [ ] No console errors
- [ ] `BolShared` loads correctly on loading dashboard page

**Notify Steve:** No migrations needed. Deploy and test:
1. Open Loading Dashboard → find a card for a job that has a BOL → click "View BOL" → PDF opens in new tab
2. Find a card for a job with no BOL → click "View BOL" → alert says "No BOL found"
3. Cards in `awaiting` status should NOT show the "View BOL" button
4. Cards in `not_started`, `loading`, `loaded`, `in_transit`, `delivered` should all show the button
5. Test on iPad — PDF should open in a new Safari tab
6. Verify no console errors on page load (pdf-lib and bol-shared.js load correctly)
