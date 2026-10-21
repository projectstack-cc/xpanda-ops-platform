// src/lib/qc/drive.selfcheck.ts — qc-03
// Self-check for the pure Drive-forward helpers (drive.ts). No DB, no network.
// qc-08: incident payload key set, Doc response parsing, matching against the incident customer sheet.
// Run with: npx tsx src/lib/qc/drive.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import { buildGasPayload, buildIncidentPayload, matchSheetCustomer, parseGasResponse, productCutFor, toleranceLabel, type QcDriveRecord, type QcDriveSample } from "./drive";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

// Real names from "Customer Name - FINAL INSPECTION - Master Sheet" (Customers tab), 2026-10-16.
const SHEET = [
  "DiversiTech", "Blue Water Spa Cover", "YanaEx", "Blue Hippo", "AccuDock", "AccuSolar", "New Panel Kits",
  "Deck Systems", "Quadriga Architectural", "John Abell Corp", "Alumflo", "Lansing Building Products",
  "Bellingham Marine Industries", "All Florida", "Cellucrete", "Plaid Jackalope", "Italian Cast Stone Inc",
  "Precast and Foam Works LLC", "Joyner Lumber & Supply Co", "Ocala Arch Foam", "Cast Systems", "EM Studios",
  "Community Roofing", "Spray Rock Manufacturing", "Coolstructures", "HarborMasters", "Crown Packaging", "Virginia Foam",
];
const match: [string, string | null][] = [
  ["DiversiTech", "DiversiTech"],
  ["Blue Water Spa Covers", "Blue Water Spa Cover"],
  ["YanaEx, Inc - Attn: Misha Gryb 8802 Corporate Square", "YanaEx"],
  ["PRECAST AND FOAM WORKS LLC", "Precast and Foam Works LLC"],
  ["Joe Perrini Community Roofing", "Community Roofing"],
  ["All Florida Weatherproofing & Construction", "All Florida"],
  ["Lansing Building Products Inc - OCALA 095 5371 Southeast", "Lansing Building Products"],
  ["Customer pickup via DeCruiz Transport Crown Packaging - Orlando", "Crown Packaging"],
  ["AccuSolar", "AccuSolar"],
  ["Kramer America", null],
  ["Marina Foam, LLC", null],
];
for (const [job, want] of match) eq(`matchSheetCustomer(${JSON.stringify(job)})`, matchSheetCustomer(job, SHEET), want);
eq("matchSheetCustomer tie → null", matchSheetCustomer("Alpha Beta", ["Alpha", "Beta"]), null);
eq("matchSheetCustomer longer run beats shorter", matchSheetCustomer("Ocala Arch Foam Inc", ["Ocala", "Ocala Arch Foam"]), "Ocala Arch Foam");
eq("matchSheetCustomer empty", matchSheetCustomer("", SHEET), null);

// toleranceLabel — legacy's exact strings.
eq("toleranceLabel(.0625)", toleranceLabel(0.0625), "1/16 (.0625) inch");
eq("toleranceLabel(.125)", toleranceLabel(0.125), "1/8 (.125) inch");
eq("toleranceLabel(.1875)", toleranceLabel(0.1875), "3/16 (.1875) inch");
eq("toleranceLabel(.25)", toleranceLabel(0.25), "1/4 (.25) inch");

// buildGasPayload — 3 samples, ET date/time, Y/N, booleans, no float noise.
const rec: QcDriveRecord = {
  invoice_number: "4477",
  customer: "Blue Water Spa Covers",
  part_description: "1.5# VIRGIN - TAPERED",
  dimensions_text: null,
  line_quantity: 16,
  lot_size: 17,
  sample_size: 3,
  tolerance_in: 0.125,
  nominal_length: 80,
  nominal_width: 39,
  nominal_height: 0.1 + 0.2 + 3.7, // float noise → "4"
  nominal_taper: "2.5–4",
  inspector_name: "Pat Inspector",
  inspected_at: "2026-10-16 13:05:00",
};
const samples: QcDriveSample[] = [
  { sample_no: 3, length: 80, width: 39, height: 3.5625, taper: null, visual_pass: 1, result: "fail" },
  { sample_no: 1, length: 80.0625, width: 39, height: 4, taper: "2.5-4", visual_pass: 1, result: "pass" },
  { sample_no: 2, length: 79.9, width: 39.1, height: 4, taper: "", visual_pass: 0, result: "pass" },
];
const p = buildGasPayload(rec, samples, "Blue Water Spa Cover");
eq("payload jobId", p.jobId, "4477");
eq("payload ET date", p.date, "2026-10-16");
eq("payload ET time (13:05 UTC → 09:05 EDT)", p.time, "09:05");
eq("payload tolerance label", p.tolerance, "1/8 (.125) inch");
eq("payload numbers as strings, no float noise", [p.totalPieces, p.lotSize, p.sampleSizeRequired, p.dimLength, p.dimWidth, p.dimHeight], ["16", "17", "3", "80", "39", "4"]);
eq("payload taper + customer (sheet name)", [p.dimTapers, p.customer, p.productCut, p.inspector], ["2.5–4", "Blue Water Spa Cover", "2.5-4 x 39 x 80", "Pat Inspector"]);
eq("payload samples ordered by sample_no", p.samples.map((s) => s.length), ["80.0625", "79.9", "80"]);
eq("payload passFail Y/N", p.samples.map((s) => s.passFail), ["Y", "Y", "N"]);
eq("payload visualPass boolean", p.samples.map((s) => s.visualPass), [true, false, true]);
eq("payload sample taper/height", [p.samples[0].taper, p.samples[2].taper, p.samples[2].height], ["2.5-4", "", "3.5625"]);
eq("payload raw customer when unmatched", buildGasPayload(rec, [], null).customer, "Blue Water Spa Covers");
eq("payload ET date in winter (EST)", buildGasPayload({ ...rec, inspected_at: "2026-12-01 03:30:00" }, [], null).date, "2026-11-30");

// productCutFor — qc-03b: dimensions, thickness first; fallbacks dims text → description[0..40] → "".
const cutBase = { nominal_length: null, nominal_width: null, nominal_height: null, nominal_taper: null, dimensions_text: null, part_description: null };
eq("productCut no taper H/W/L", productCutFor({ ...cutBase, nominal_height: 3.5625, nominal_width: 15.5, nominal_length: 37.5 }), "3.5625 x 15.5 x 37.5");
eq("productCut W x L only", productCutFor({ ...cutBase, nominal_width: 47, nominal_length: 96 }), "47 x 96");
eq("productCut no nominals → dimensions_text trimmed", productCutFor({ ...cutBase, dimensions_text: '  2" x 48" x 144"  ' }), '2" x 48" x 144"');
const longDesc = "1.5# VIRGIN EPS - TAPERED SPA COVER INSERT 2.5 TO 4 INCH WITH CHAMFER";
eq("productCut description only → first 40 chars", productCutFor({ ...cutBase, part_description: longDesc }), longDesc.slice(0, 40).trim());
eq("productCut nothing → empty", productCutFor(cutBase), "");

// parseGasResponse.
// qc-08: normalized to { fileId, fileName } (was { pdfFileId, pdfName }).
eq("parse ok", parseGasResponse('{"ok":true,"type":"finalInspection","pdfFileId":"abc123","pdfName":"X-4477","savedFolderId":"f"}'), { ok: true, fileId: "abc123", fileName: "X-4477" });
eq(
  "parse incident Doc ok",
  parseGasResponse('{"ok":true,"type":"incidentReport","docFileId":"doc9","docName":"XPanda Incident Report - All Florida - 20261020","savedFolderId":"f"}'),
  { ok: true, fileId: "doc9", fileName: "XPanda Incident Report - All Florida - 20261020" }
);
eq("parse ok:true without a file id → failure", parseGasResponse('{"ok":true,"type":"incidentReport"}'), { ok: false, error: "Apps Script returned ok:false with no error." });
eq("parse ok:false passes error", parseGasResponse('{"ok":false,"error":"Template not found"}'), { ok: false, error: "Template not found" });
const html = parseGasResponse("<!DOCTYPE html><html><head><title>Sign in - Google Accounts</title></head><body><p>Sign in</p></body></html>");
check("parse HTML → non-JSON failure, tags stripped", !html.ok && html.error.startsWith("Apps Script returned non-JSON: ") && !html.error.includes("<"), JSON.stringify(html));

// ── qc-08: incidents ────────────────────────────────────────────────────────────────────────────

// The incident customer sheet (1jmNy…, Customers tab), read 2026-10-21: the FINAL INSPECTION list plus
// two more, with "All Florida" and "Coolstructures" listed twice each.
const INCIDENT_SHEET = [...SHEET, "Architectural Foam Fabricators", "TCI ORL", "All Florida", "Coolstructures"];
eq("incident sheet: duplicate All Florida isn't a tie", matchSheetCustomer("All Florida Weatherproofing & Construction", INCIDENT_SHEET), "All Florida");
eq("incident sheet: duplicate Coolstructures isn't a tie", matchSheetCustomer("Coolstructures Inc", INCIDENT_SHEET), "Coolstructures");
eq("incident sheet: TCI store → null", matchSheetCustomer("ABC Outdoor Solutions aka TCI #768 HUDSON", INCIDENT_SHEET), null);
eq("incident sheet: Architectural Foam Fabricators exact", matchSheetCustomer("ARCHITECTURAL FOAM FABRICATORS", INCIDENT_SHEET), "Architectural Foam Fabricators");

const incident = {
  incident_date: "2026-10-20",
  person_completing: "Steve Cook",
  reporting_individual: null,
  customer: "All Florida Weatherproofing & Construction",
  job_ref: "4477",
  product_delivered: "Block",
  delivery_date: null,
  incident_category: "Tolerances",
  incident_details: "Short on length.",
  root_cause: null,
  implicated_departments: ["Cutting", "Delivery"],
  corrective_actions: null,
  risk_level: "High",
};
const ip = buildIncidentPayload(incident, "All Florida");
// Legacy qc/incident-report.html's createIncidentReport payload, key for key.
const LEGACY_INCIDENT_KEYS = [
  "action", "date", "personCompletingReport", "reportingIndividual", "customer", "jobId", "productDelivered",
  "deliveryDate", "incidentCategory", "incidentDetails", "rootCauseDescription", "implicatedDepartments",
  "correctiveActions", "riskLevel",
].sort();
eq("incident payload key set = legacy", Object.keys(ip).sort(), LEGACY_INCIDENT_KEYS);
eq("incident payload values", ip, {
  action: "createIncidentReport",
  date: "2026-10-20",
  personCompletingReport: "Steve Cook",
  reportingIndividual: "",
  customer: "All Florida",
  jobId: "4477",
  productDelivered: "Block",
  deliveryDate: "",
  incidentCategory: "Tolerances",
  incidentDetails: "Short on length.",
  rootCauseDescription: "",
  implicatedDepartments: ["Cutting", "Delivery"],
  correctiveActions: "",
  riskLevel: "High",
});
eq("incident payload raw customer when unmatched", buildIncidentPayload(incident, null).customer, "All Florida Weatherproofing & Construction");
eq("incident payload no job_ref → empty jobId", buildIncidentPayload({ ...incident, job_ref: null }, null).jobId, "");

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
