/**
 * diversitech-labels.js
 * Client-side bag/bundle label PDF generator for DiversiTech jobs (P421).
 * Vanilla global functions, no exports — loaded via <script src> in jobs/index.html,
 * following the packing-slip-parser.js precedent. Uses pdf-lib (loaded globally
 * elsewhere in jobs/index.html) at call time only, so load order relative to the
 * pdf-lib <script> tag doesn't matter.
 *
 * Usage: printDiversiTechLabels(jobId) — looks the job up in the page's `allJobs`
 * array, builds a multi-page landscape 6"x4" PDF (one page per bundle), and opens
 * it in a new tab for printing.
 */

const DIVERSITECH_LOGO_URL = '/logo/xpanda-panda-600.png';
const DIVERSITECH_BATCH    = '42E36164Z';
const DIVERSITECH_HEADER   = 'DiversiTech Corporation';
const DIVERSITECH_BUNDLE_SIZE = 5;

// Landscape 6"x4" at 72pt/in.
const DIVERSITECH_PAGE_W = 432;
const DIVERSITECH_PAGE_H = 288;

function diversiTechFormatDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso).trim());
  if (!m) return '';
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function diversiTechProductLabel(li) {
  const partNumber = (li.part_number || '').trim();
  if (partNumber) return `FOAM - ${partNumber}`;
  return (li.description || '').trim();
}

// Bundle numbering resets per SKU; last bundle of each SKU carries the remainder.
function diversiTechComputeBundles(lineItems) {
  const sorted = lineItems.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const bundles = [];
  for (const li of sorted) {
    const qty = Number(li.quantity) || 0;
    const bundleCount = Math.ceil(qty / DIVERSITECH_BUNDLE_SIZE);
    for (let i = 1; i <= bundleCount; i++) {
      const isLast = i === bundleCount;
      const pieces = isLast ? (qty % DIVERSITECH_BUNDLE_SIZE || DIVERSITECH_BUNDLE_SIZE) : DIVERSITECH_BUNDLE_SIZE;
      bundles.push({ lineItem: li, bundleNumber: i, pieces });
    }
  }
  return bundles;
}

function diversiTechFitSize(font, text, maxWidth, maxSize, minSize) {
  let size = maxSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 1;
  return size;
}

function diversiTechCenteredText(page, text, font, size, color, boxX, boxY, boxW, boxH) {
  const w = font.widthOfTextAtSize(text, size);
  const x = boxX + (boxW - w) / 2;
  const y = boxY + (boxH - size) / 2 + size * 0.22;
  page.drawText(text, { x, y, size, font, color });
}

function diversiTechDrawBox(page, x, y, w, h, color) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: 1 });
}

function diversiTechDrawLabel(page, font, black, logoImg, data) {
  const margin = 12;
  const contentW = DIVERSITECH_PAGE_W - margin * 2; // 408

  // 1) Header row
  const headerH = 26;
  const headerY = DIVERSITECH_PAGE_H - margin - headerH;
  diversiTechDrawBox(page, margin, headerY, contentW, headerH, black);
  diversiTechCenteredText(page, DIVERSITECH_HEADER, font, 16, black, margin, headerY, contentW, headerH);

  // 2) Product box
  const productH = 60;
  const productY = headerY - 4 - productH;
  diversiTechDrawBox(page, margin, productY, contentW, productH, black);
  const productSize = diversiTechFitSize(font, data.productText, contentW - 32, 34, 14);
  diversiTechCenteredText(page, data.productText, font, productSize, black, margin, productY, contentW, productH);

  // 3) Spec table — 2 cols x 4 rows: SIZE / DATE / DENSITY / BATCH
  const rowH = 20;
  const labelColW = 90;
  const valueColW = contentW - labelColW;
  const specTopY = productY - 4;
  const rows = [
    ['SIZE', data.size],
    ['DATE', data.date],
    ['DENSITY', data.density],
    ['BATCH', DIVERSITECH_BATCH],
  ];
  rows.forEach(([label, value], i) => {
    const rowY = specTopY - rowH * (i + 1);
    diversiTechDrawBox(page, margin, rowY, contentW, rowH, black);
    page.drawLine({ start: { x: margin + labelColW, y: rowY }, end: { x: margin + labelColW, y: rowY + rowH }, thickness: 1, color: black });
    diversiTechCenteredText(page, label, font, 10, black, margin, rowY, labelColW, rowH);
    const valueSize = diversiTechFitSize(font, String(value || ''), valueColW - 16, 12, 7);
    diversiTechCenteredText(page, String(value || ''), font, valueSize, black, margin + labelColW, rowY, valueColW, rowH);
  });

  // 4) Bottom row — QTY block | bundle number box | logo
  const bottomY = margin;
  const bottomH = (specTopY - rowH * rows.length) - 4 - margin;
  const qtyW = 110;
  const logoW = 90;
  const gap = 8;
  const bundleW = contentW - qtyW - logoW - gap * 2;

  // QTY block: label cell over value cell
  diversiTechDrawBox(page, margin, bottomY, qtyW, bottomH, black);
  const qtyLabelH = 24;
  page.drawLine({ start: { x: margin, y: bottomY + bottomH - qtyLabelH }, end: { x: margin + qtyW, y: bottomY + bottomH - qtyLabelH }, thickness: 1, color: black });
  diversiTechCenteredText(page, 'QTY', font, 9, black, margin, bottomY + bottomH - qtyLabelH, qtyW, qtyLabelH);
  const qtyValueSize = diversiTechFitSize(font, data.qty, qtyW - 16, 22, 10);
  diversiTechCenteredText(page, data.qty, font, qtyValueSize, black, margin, bottomY, qtyW, bottomH - qtyLabelH);

  // Bundle number box
  const bundleX = margin + qtyW + gap;
  diversiTechDrawBox(page, bundleX, bottomY, bundleW, bottomH, black);
  const bundleText = String(data.bundleNumber);
  const bundleSize = diversiTechFitSize(font, bundleText, bundleW - 24, 56, 20);
  diversiTechCenteredText(page, bundleText, font, bundleSize, black, bundleX, bottomY, bundleW, bottomH);

  // Logo box
  const logoX = bundleX + bundleW + gap;
  diversiTechDrawBox(page, logoX, bottomY, logoW, bottomH, black);
  if (logoImg) {
    const pad = 8;
    const maxW = logoW - pad * 2;
    const maxH = bottomH - pad * 2;
    const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
    const drawW = logoImg.width * scale;
    const drawH = logoImg.height * scale;
    page.drawImage(logoImg, {
      x: logoX + (logoW - drawW) / 2,
      y: bottomY + (bottomH - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  }
}

async function buildDiversiTechLabelsPdf(job, lineItems) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);

  let logoImg = null;
  try {
    const logoBytes = await fetch(DIVERSITECH_LOGO_URL).then(r => r.arrayBuffer());
    logoImg = await doc.embedPng(logoBytes);
  } catch (e) {
    console.error('DiversiTech labels: logo embed failed', e);
  }

  const dateStr = diversiTechFormatDate(job.ship_date);
  const bundles = diversiTechComputeBundles(lineItems);

  for (const b of bundles) {
    const page = doc.addPage([DIVERSITECH_PAGE_W, DIVERSITECH_PAGE_H]);
    diversiTechDrawLabel(page, font, black, logoImg, {
      productText: diversiTechProductLabel(b.lineItem),
      size: b.lineItem.dimensions || '',
      date: dateStr,
      density: (b.lineItem.density && String(b.lineItem.density).trim()) || '1.0 RC',
      qty: String(b.pieces).padStart(2, '0') + 'pcs',
      bundleNumber: b.bundleNumber,
    });
  }

  return doc.save();
}

async function printDiversiTechLabels(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (!job) return;
  const lineItems = Array.isArray(job.line_items) ? job.line_items : [];
  if (!lineItems.length) {
    alert('This job has no line items to print labels for.');
    return;
  }

  const btn = document.getElementById('diversitech-btn-' + jobId);
  const originalLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating Labels…'; }

  try {
    const pdfBytes = await buildDiversiTechLabelsPdf(job, lineItems);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, '_blank');
    if (!win) {
      alert('Your browser blocked the popup. Please allow popups for this site.');
    } else {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    }
  } catch (e) {
    console.error('DiversiTech labels PDF failed:', e);
    alert('Could not generate DiversiTech labels.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  }
}
