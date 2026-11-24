// src/lib/cutList.selfcheck.ts
// hbplan-02: render check for cutList.ts's chunk pages. Run: npx tsx src/lib/cutList.selfcheck.ts
// Compares inflated page content streams with pdf-lib's per-document font resource suffixes
// normalised (/Helvetica-Bold-1234 -> /Helvetica-Bold), so "no plan" is checked against the
// pre-hbplan-02 output recorded from main (71f12fd). Not part of the production build path.
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { buildCutListPdf, type CutListJob } from "./cutList";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: unknown) {
  results.push({ name, pass, detail: pass ? undefined : String(detail) });
}

async function pages(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const c = doc.getPage(i).node.Contents();
    const ss = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
    let s = "";
    for (const st of ss) if (st instanceof PDFRawStream) s += Array.from(decodePDFRawStream(st).decode(), (b) => String.fromCharCode(b)).join("");
    out.push(s.replace(/(\/Helvetica(?:-Bold)?)-\d+/g, "$1"));
  }
  return out;
}
function texts(page: string): string[] {
  return Array.from(page.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)).map((m) => (m[1].match(/../g) ?? []).map((h) => String.fromCharCode(parseInt(h, 16))).join("").replace(//g, "—"));
}
function fnv(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const lines = [
  { part_id: "p4", part_number: "HB-4", thickness: 4, qty: 72 },
  { part_id: "p2", part_number: "HB-2", thickness: 2, qty: 10 },
];
const breakdown = {
  chunks_required: 8, height: 50.5, kerf: 0.079, avg_util: 88,
  breakdown: [...Array(6)].map(() => ({ boards: Array(12).fill(4) })).concat([{ boards: Array(10).fill(2) }]),
  lines,
};
const netBreakdown = {
  ...breakdown,
  net: {
    chunks_required: 6, height: 50.5, kerf: 0.079, avg_util: 90,
    breakdown: [...Array(5)].map(() => ({ boards: Array(12).fill(4) })).concat([{ boards: Array(10).fill(2) }]),
    order_chunks_required: 8, chunks_on_hand_entered: 2, chunks_on_hand: 2, chunks_to_cut: 4,
    pcs: [{ part_id: "p4", part_number: "HB-4", thickness: 4, order_qty: 72, on_hand: 12, to_cut: 60 }],
  },
};
const baseJob: CutListJob = {
  id: "j1", invoice_number: "4527", ship_date: "2026-11-30", customer: "Fixture Co", ship_to_company: "Fixture Co",
  ship_to_attention: null, ship_to_street: "1 Main St", ship_to_street2: null, ship_to_city: "Tampa", ship_to_state: "FL",
  ship_to_zip: "33601", carrier: "LTL",
  line_items: [{ part_number: "HB-4", description: "4in holey", quantity: 72, dimensions: "48x24x4", density: "1.0" }, { part_number: "HB-2", description: "2in holey", quantity: 10, dimensions: "48x24x2", density: "1.0" }],
  hb_chunk_breakdown: JSON.stringify(breakdown),
};

const plan = (groups: Array<{ count: number; pieces: Array<{ thickness: number; qty: number }> }>) =>
  JSON.stringify({ v: 1, groups, total: groups.reduce((n, g) => n + g.count, 0), updated_by: "Fixture", updated_at: "2026-11-24 10:00:00" });
const fp = (ps: string[]) => `${fnv(ps.join(""))}/${ps.join("").length}`;

async function main() {
  // The logo is fetched from a relative URL, which can't resolve under Node; cutList.ts catches
  // that and draws without it (in both the recorded baseline and here). Mute its console noise.
  const origError = console.error;
  console.error = (...a: unknown[]) => { if (!String(a[0]).startsWith("Cut list: logo embed failed")) origError(...a); };
  // No plan: must equal the pre-hbplan-02 output (fingerprints recorded on 71f12fd, stable across runs).
  const noPlan = await pages(await buildCutListPdf(baseJob, { includeChunkBreakdown: true }));
  check("no plan: auto page unchanged (cf0ae88d/4402)", fp(noPlan) === "cf0ae88d/4402", fp(noPlan));
  const noPlanNet = await pages(await buildCutListPdf({ ...baseJob, hb_chunk_breakdown: JSON.stringify(netBreakdown) }, { includeChunkBreakdown: true }));
  check("no plan + floor stock: auto page unchanged (ef7813ae/5101)", fp(noPlanNet) === "ef7813ae/5101", fp(noPlanNet));
  const garbage = await pages(await buildCutListPdf({ ...baseJob, hb_chunk_plan: "{not json" }, { includeChunkBreakdown: true }));
  check("unparseable plan: falls back to the auto page", fp(garbage) === "cf0ae88d/4402", fp(garbage));
  const off = await pages(await buildCutListPdf({ ...baseJob, hb_chunk_plan: plan([{ count: 6, pieces: [{ thickness: 4, qty: 12 }] }]) }));
  check("toggle off: no chunk page even with a plan", off.every((pg) => !texts(pg).includes("CHUNK LIST") && !texts(pg).some((t) => t.startsWith("CHUNK BREAKDOWN"))));

  // Matching plan: 6 × (12 × 4") + 1 × (10 × 2") = 72 × 4", 10 × 2".
  const matchPages = await pages(await buildCutListPdf({ ...baseJob, hb_chunk_plan: plan([{ count: 6, pieces: [{ thickness: 4, qty: 12 }] }, { count: 1, pieces: [{ thickness: 2, qty: 10 }] }]) }, { includeChunkBreakdown: true }));
  const mt = texts(matchPages[matchPages.length - 1]);
  check("match: prints CHUNK LIST, not the auto page", mt[0] === "CHUNK LIST" && !matchPages.some((pg) => texts(pg).some((t) => t.startsWith("CHUNK BREAKDOWN"))), mt.slice(0, 3).join(" | "));
  check("match: header line", mt.includes('7 chunks · custom list · 48×24×50.5"'), mt.join(" | "));
  check("match: no mismatch warning", !mt.some((t) => t.startsWith("DOES NOT MATCH")));
  check("match: rows in plan order with fill", mt.includes("6×") && mt.includes('12× 4"') && mt.includes('48.9" fill') && mt.includes("1×") && mt.includes('10× 2"') && mt.includes('20.7" fill') && mt.indexOf('12× 4"') < mt.indexOf('10× 2"'), mt.join(" | "));

  // Mismatched plan: 5 × (12 × 4") + 1 × (10 × 2" + 2 × 1") -> short 12 × 4", over 2 × 1". Mixed group
  // listed thickest first. Floor stock block kept, new chunks = max(0, 6 − 2) = 4.
  const mm = plan([{ count: 5, pieces: [{ thickness: 4, qty: 12 }] }, { count: 1, pieces: [{ thickness: 1, qty: 2 }, { thickness: 2, qty: 10 }] }]);
  const mmPages = await pages(await buildCutListPdf({ ...baseJob, hb_chunk_plan: mm }, { includeChunkBreakdown: true }));
  const xt = texts(mmPages[mmPages.length - 1]);
  check("mismatch: bold warn line", xt.includes('DOES NOT MATCH ORDER — short 12 × 4"; over 2 × 1"'), xt.join(" | "));
  // (wrapText collapses the recipe's "   +   " spacing to single spaces — existing auto-page behaviour.)
  check("mismatch: mixed group thickest first", xt.includes('10× 2" + 2× 1"'), xt.join(" | "));
  const netPages = await pages(await buildCutListPdf({ ...baseJob, hb_chunk_breakdown: JSON.stringify(netBreakdown), hb_chunk_plan: plan([{ count: 5, pieces: [{ thickness: 4, qty: 12 }] }, { count: 1, pieces: [{ thickness: 2, qty: 10 }] }]) }, { includeChunkBreakdown: true }));
  const nt = texts(netPages[netPages.length - 1]);
  check("floor stock: needed is net (60 × 4\") so a 5 × 12 plan matches", !nt.some((t) => t.startsWith("DOES NOT MATCH")), nt.join(" | "));
  check("floor stock: FLOOR STOCK block kept, new chunks = total − on hand", nt.includes("FLOOR STOCK") && nt.some((t) => t.startsWith("HB-4  (4\")   order 72 · on hand 12 · cut 60")) && nt.includes("Uncut chunks on hand: 2  ->  new chunks to cut: 4"), nt.join(" | "));

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
  console.log(`
${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}
main();
