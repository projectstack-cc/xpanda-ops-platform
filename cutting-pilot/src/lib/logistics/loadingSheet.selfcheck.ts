// src/lib/logistics/loadingSheet.selfcheck.ts
// lgx-loadsheet-02: guarded dev self-check for loadingSheet.ts's expandLoadingSheets (one sheet per
// load) and loadManifest.ts's parseLoadManifest. Same check()/results shape as toLoadSheet.selfcheck.ts.
// lgx-loadsheet-03: + fitInvoiceBox geometry (the header's centered invoice box); now async because the
// Helvetica-Bold metrics come from a pdf-lib embed. Not part of the production build path.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { HEADER_BAND_H, INVOICE_BOX_MAX_SIZE, INVOICE_BOX_MIN_SIZE, LIVE_LOAD_GAP, LIVE_LOAD_TEXT_SIZE, buildLoadingSheetPdf, expandLoadingSheets, fitInvoiceBox, liveLoadText, placeLiveLoad, sheetCarrierText, sheetInvoiceText, type LoadingSheetLineItem, type LoadingSheetLoad, type LoadingSheetOrder } from "./loadingSheet";
import { parseLoadManifest, type LoadManifestItem } from "./loadManifest";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const LINE_ITEMS: LoadingSheetLineItem[] = [
  { part_number: "HB-10", description: "10in holey board", quantity: 120, dimensions: "48x24x10" },
  { part_number: "HB-12", description: "12in holey board", quantity: 80, dimensions: "48x24x12" },
];

function order(inv: string, loads: LoadingSheetLoad[]): LoadingSheetOrder {
  return {
    job_id: `job-${inv}`,
    invoice_number: inv,
    ship_date: "2026-10-14",
    customer: `Customer ${inv}`,
    carrier: "Carrier",
    delivery_time: null,
    notes: null,
    ship_to_company: null,
    ship_to_attention: null,
    ship_to_street: null,
    ship_to_street2: null,
    ship_to_city: null,
    ship_to_state: null,
    ship_to_zip: null,
    line_items: LINE_ITEMS,
    loads,
  };
}

function load(n: number | null, manifest: LoadManifestItem[] | null): LoadingSheetLoad {
  return { load_number: n, trailer_number: n != null ? `T${n}` : null, bay_number: n, bol_number: n != null ? `B${n}` : null, manifest, delivery_time: null, carrier: "Carrier" };
}

const m = (name: string, sku: string, pieces: number): LoadManifestItem => ({ name, sku, dims: "48 x 24 x 10", pieces });
const qty = (items: LoadingSheetLineItem[]) => items.reduce((s, li) => s + (Number(li.quantity) || 0), 0);

export async function runLoadingSheetSelfCheck(): Promise<{ pass: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });

  // Single-load order -> 1 page, the job line items, no banner (even with a manifest).
  {
    const pages = expandLoadingSheets([order("4001", [load(1, [m("10in block", "HB-10", 5)])])]);
    check("single load: 1 page", pages.length === 1, String(pages.length));
    check("single load: the job line items, not the manifest", pages[0].items === LINE_ITEMS);
    check("single load: no banner", pages[0].splitMissing === false);
    check("single load: load set, loadCount 1", pages[0].load?.load_number === 1 && pages[0].loadCount === 1 && pages[0].loadIndex === 1);
  }

  // No assignments, no BOLs -> 1 page, load null.
  {
    const pages = expandLoadingSheets([order("4002", [])]);
    check("no loads: 1 page, load null, line items, no banner", pages.length === 1 && pages[0].load === null && pages[0].items === LINE_ITEMS && !pages[0].splitMissing && pages[0].loadCount === 0);
  }

  // 3 loads, all with manifests -> 3 pages, each with only its own items.
  {
    const loads = [
      load(3, [m("12in block", "HB-12", 40)]),
      load(1, [m("10in block", "HB-10", 60), m("12in block", "", 10)]),
      load(2, [m("10in block", "HB-10", 60), m("12in block", "HB-12", 30)]),
    ];
    const pages = expandLoadingSheets([order("4434", loads)]);
    check("3 loads: 3 pages", pages.length === 3, String(pages.length));
    check("3 loads: load_number order, Load n of 3", pages.map((p) => `${p.load?.load_number}:${p.loadIndex}/${p.loadCount}`).join(",") === "1:1/3,2:2/3,3:3/3", pages.map((p) => `${p.load?.load_number}:${p.loadIndex}/${p.loadCount}`).join(","));
    check("3 loads: per-page qty sums (70 / 90 / 40)", pages.map((p) => qty(p.items)).join(",") === "70,90,40", pages.map((p) => qty(p.items)).join(","));
    check("3 loads: no banner on any page", pages.every((p) => !p.splitMissing));
    check(
      "3 loads: manifest rows map to part 'name (sku)', no description, dims kept",
      pages[0].items[0].part_number === "10in block (HB-10)" && pages[0].items[0].description === null && pages[0].items[0].dimensions === "48 x 24 x 10" && pages[0].items[1].part_number === "12in block",
      JSON.stringify(pages[0].items)
    );
  }

  // 3 loads, load 2 missing a manifest -> page 2 is the full order + banner; 1 and 3 are split.
  {
    const pages = expandLoadingSheets([order("4500", [load(1, [m("10in block", "HB-10", 60)]), load(2, null), load(3, [m("12in block", "HB-12", 80)])])]);
    check("missing split: page 2 lists the full order's line items", pages[1].items === LINE_ITEMS && qty(pages[1].items) === 200);
    check("missing split: page 2 has the banner", pages[1].splitMissing === true);
    check("missing split: pages 1 and 3 are split, no banner", !pages[0].splitMissing && !pages[2].splitMissing && qty(pages[0].items) === 60 && qty(pages[2].items) === 80);
    const empty = expandLoadingSheets([order("4501", [load(1, []), load(2, [m("x", "", 1)])])]);
    check("missing split: an empty manifest counts as missing", empty[0].splitMissing && empty[0].items === LINE_ITEMS);
  }

  // parseLoadManifest.
  {
    const good = [m("10in block", "HB-10", 5)];
    check("parse: drops a zero-piece item and a nameless item", JSON.stringify(parseLoadManifest([...good, { name: "z", sku: "", dims: "", pieces: 0 }, { name: "  ", sku: "", dims: "", pieces: 3 }])) === JSON.stringify(good));
    check("parse: accepts an array", JSON.stringify(parseLoadManifest(good)) === JSON.stringify(good));
    check("parse: accepts a JSON string", JSON.stringify(parseLoadManifest(JSON.stringify(good))) === JSON.stringify(good));
    check("parse: coerces pieces to an integer", parseLoadManifest([{ name: "a", pieces: "7.4" }])?.[0].pieces === 7);
    check("parse: missing sku/dims become \"\"", JSON.stringify(parseLoadManifest([{ name: "a", pieces: 2 }])) === JSON.stringify([{ name: "a", sku: "", dims: "", pieces: 2 }]));
    check(
      "parse: null on garbage / empty / no valid items",
      [parseLoadManifest("not json"), parseLoadManifest(""), parseLoadManifest(null), parseLoadManifest({ name: "a" }), parseLoadManifest(42), parseLoadManifest([]), parseLoadManifest([{ pieces: 3 }])].every((v) => v === null)
    );
  }

  // Day mode: two orders -> pages grouped per order, invoice order preserved.
  {
    const pages = expandLoadingSheets([order("4100", [load(1, [m("a", "", 1)]), load(2, [m("b", "", 2)])]), order("4200", [load(1, null)])]);
    check(
      "day mode: pages grouped per order, invoice order kept",
      pages.map((p) => `${p.order.invoice_number}/${p.loadIndex}`).join(",") === "4100/1,4100/2,4200/1",
      pages.map((p) => `${p.order.invoice_number}/${p.loadIndex}`).join(",")
    );
    check("day mode: the single-load order prints its line items, no banner", pages[2].items === LINE_ITEMS && !pages[2].splitMissing);
  }

  // dlv-04: invoice box text carries the per-load suffix on multi-load sheets only.
  {
    const single = expandLoadingSheets([order("4487", [load(1, null)])]);
    check("box text: single load unchanged", sheetInvoiceText(single[0]) === "4487", sheetInvoiceText(single[0]));
    const none = expandLoadingSheets([order("4488", [])]);
    check("box text: no loads unchanged", sheetInvoiceText(none[0]) === "4488", sheetInvoiceText(none[0]));
    const multi = expandLoadingSheets([order("4440", [load(3, null), load(1, null), load(2, null)])]);
    check(
      "box text: multi-load -> INV-0N by load_number",
      multi.map(sheetInvoiceText).join(",") === "4440-01,4440-02,4440-03",
      multi.map(sheetInvoiceText).join(",")
    );
    const unnumbered = expandLoadingSheets([order("4441", [load(null, null), load(null, null)])]);
    check("box text: unnumbered loads fall back to loadIndex", unnumbered.map(sheetInvoiceText).join(",") === "4441-01,4441-02", unnumbered.map(sheetInvoiceText).join(","));
    const blank = expandLoadingSheets([{ ...order("x", [load(1, null), load(2, null)]), invoice_number: null }]);
    check("box text: null invoice -> \"\" (no box)", sheetInvoiceText(blank[0]) === "");
  }

  // fitInvoiceBox (lgx-loadsheet-03). Bounds as drawn on a real sheet: logo right edge (40 + 97) + 16,
  // and the widest right-column string's left x - 16.
  {
    const doc = await PDFDocument.create();
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const top = 792 - 40;
    const L = 40 + 97 + 16;
    const R = 572 - fontBold.widthOfTextAtSize("Loading sheet", 18) - 16;
    const inBounds = (b: { x: number; width: number }, l: number, r: number) => b.x >= l - 1e-9 && b.x + b.width <= r + 1e-9;

    const short = fitInvoiceBox("4487", fontBold, L, R, 306, top);
    check("invoice box: \"4487\" fits at 28pt", short?.size === INVOICE_BOX_MAX_SIZE && !!short && inBounds(short, L, R), JSON.stringify(short));
    check("invoice box: bottom above the header rule at 28pt", !!short && short.size === 28 && short.y > top - HEADER_BAND_H, short ? `bottom ${short.y.toFixed(1)} vs rule ${top - HEADER_BAND_H}` : "null");

    const long = fitInvoiceBox("INV-2026-10-13", fontBold, L, R, 306, top);
    check(
      "invoice box: 14-char invoice shrinks below 28pt, not below 18pt, stays in bounds",
      !!long && long.size < INVOICE_BOX_MAX_SIZE && long.size >= INVOICE_BOX_MIN_SIZE && inBounds(long, L, R),
      long ? `size ${long.size}, x ${long.x.toFixed(1)}..${(long.x + long.width).toFixed(1)} in ${L}..${R.toFixed(1)}` : "null"
    );

    // Off-center bounds: centering on 306 would cross leftBound, so the box clamps to it.
    const clamped = fitInvoiceBox("4487", fontBold, 290, 520, 306, top);
    check("invoice box: clamped inside [leftBound, rightBound]", !!clamped && clamped.x === 290 && inBounds(clamped, 290, 520), clamped ? `x ${clamped.x}` : "null");

    check("invoice box: empty / blank / null invoice -> no box", [fitInvoiceBox("", fontBold, L, R), fitInvoiceBox("   ", fontBold, L, R), fitInvoiceBox(null, fontBold, L, R)].every((b) => b === null));
  }

  // mlc-04: per-load carrier prints only when it differs from the order carrier.
  {
    const o = order("4512", []);
    check("carrier: same as order -> order carrier", sheetCarrierText(o, { carrier: "Carrier" }) === "Carrier");
    check("carrier: case/whitespace-equal -> order carrier", sheetCarrierText({ carrier: "Seal Express" }, { carrier: " seal express " }) === "Seal Express");
    check("carrier: split load -> its own carrier", sheetCarrierText({ carrier: "Seal Express - Dry Van" }, { carrier: "XPanda truck" }) === "XPanda truck");
    check("carrier: null load / null load carrier -> order carrier",
      sheetCarrierText(o, null) === "Carrier" && sheetCarrierText(o, { carrier: null }) === "Carrier");
    check("carrier: no order carrier, no load carrier -> \"\"", sheetCarrierText({ carrier: null }, { carrier: null }) === "");
    const pages = expandLoadingSheets([order("4512", [{ ...load(1, null), carrier: "Seal Express" }, { ...load(2, null), carrier: "XPanda truck" }])]);
    check("carrier: expand keeps each load's carrier", pages.map((p) => p.load?.carrier).join("|") === "Seal Express|XPanda truck");
  }

  // live-03: red LIVE LOAD text placement beside / below / in the band's slot; non-live unchanged.
  {
    const doc = await PDFDocument.create();
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const rightW = 242; // the right column on a US Letter sheet (colRightX ≈ 330 → right 572)
    const band = (t: string) => fontBold.widthOfTextAtSize(`Delivery: ${t}`, 16) + 12;
    check("live text: no time", liveLoadText(null) === "LIVE LOAD" && liveLoadText("  ") === "LIVE LOAD");
    check("live text: with time", liveLoadText("Tue 3:30 PM") === "LIVE LOAD · Arrives Tue 3:30 PM");
    const fits = placeLiveLoad("LIVE LOAD", fontBold, rightW, band("9a"));
    check("live: fits beside a short band", fits.mode === "beside" && fits.lines.length === 1, JSON.stringify(fits));
    check("live: beside stays inside rightW",
      band("9a") + LIVE_LOAD_GAP + fontBold.widthOfTextAtSize("LIVE LOAD", LIVE_LOAD_TEXT_SIZE) <= rightW);
    const wraps = placeLiveLoad(liveLoadText("Tue 3:30 PM"), fontBold, rightW, band("Wed 9:00 AM"));
    check("live: wraps below a wide band", wraps.mode === "below" && wraps.lines.length >= 1, JSON.stringify(wraps));
    check("live: below lines fit rightW",
      wraps.lines.every((l) => fontBold.widthOfTextAtSize(l, LIVE_LOAD_TEXT_SIZE) <= rightW), JSON.stringify(wraps.lines));
    const slot = placeLiveLoad(liveLoadText("7:30 AM"), fontBold, rightW, null);
    check("live: no delivery → takes the band's slot", slot.mode === "slot" && slot.lines.join(" ") === "LIVE LOAD · Arrives 7:30 AM", JSON.stringify(slot));

    // Non-live: an order with live_load false renders the same bytes as one without the fields.
    const norm = (b: Uint8Array) => Buffer.from(b).toString("latin1").replace(/\/(CreationDate|ModDate) \([^)]*\)/g, "");
    const origWarn = console.warn, origErr = console.error;
    console.warn = () => {}; console.error = () => {};
    const base = order("4100", [load(1, null)]);
    const flagged: LoadingSheetOrder = { ...base, live_load: false, live_time: null, loads: [{ ...load(1, null), live_load: false, live_time: null }] };
    const [a, b] = [norm(await buildLoadingSheetPdf([base])), norm(await buildLoadingSheetPdf([flagged]))];
    console.warn = origWarn; console.error = origErr;
    check("live: non-live sheet unchanged", a === b, `${a.length} vs ${b.length}`);
  }

  return { pass: results.every((r) => r.pass), results };
}
