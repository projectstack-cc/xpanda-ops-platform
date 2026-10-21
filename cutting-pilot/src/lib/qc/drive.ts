// src/lib/qc/drive.ts — qc-03
// Pure helpers for forwarding a v2 Final Inspection to the "Inspection Tool" Apps Script, whose
// handleFinalInspection(payload) (read from its source, 2026-10-16) copies the template Doc, fills
// it, exports a PDF into the customer's Drive folder and returns { ok, pdfFileId, pdfName } — with
// HTTP 200 even on error. The payload shape below is legacy qc/final-inspection.html's, field for
// field. No DB, no fetch — exercised by drive.selfcheck.ts (`npx tsx src/lib/qc/drive.selfcheck.ts`).
// qc-08: buildIncidentPayload — legacy qc/_archived/incident-report.html's createIncidentReport payload, key for
// key (handleIncidentReport fills the incident Doc and appends the tracker-Sheet row); parseGasResponse
// now reads the incident Doc reply too, normalized to { fileId, fileName }.
import { etNowWallClock, parseStoredUtc } from "@/lib/etDateTime";

// ── Customer → master-sheet name ────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// The script routes by exact (case-insensitive) sheet name, but order customers are messy
// ("Joe Perrini Community Roofing" → "Community Roofing"). Exact norm match wins; otherwise a sheet
// name matches when its tokens appear as a consecutive run in the job's tokens (each job token equal
// to the name token, or name token + "s"). Most tokens wins; a tie between different names, or no
// match, returns null (the script then files to its default folder).
export function matchSheetCustomer(jobCustomer: string, sheetNames: string[]): string | null {
  const job = norm(jobCustomer);
  if (!job) return null;
  const exact = sheetNames.find((n) => norm(n) === job);
  if (exact) return exact;

  const jt = job.split(" ");
  let best: string | null = null;
  let bestScore = 0;
  let tied = false;
  for (const name of sheetNames) {
    const n = norm(name);
    if (!n) continue;
    const nt = n.split(" ");
    let hit = false;
    for (let i = 0; i + nt.length <= jt.length && !hit; i++) {
      hit = nt.every((tok, k) => jt[i + k] === tok || jt[i + k] === `${tok}s`);
    }
    if (!hit) continue;
    if (nt.length > bestScore) {
      best = name;
      bestScore = nt.length;
      tied = false;
    } else if (nt.length === bestScore && norm(name) !== norm(best ?? "")) {
      tied = true;
    }
  }
  return tied ? null : best;
}

// ── Payload ─────────────────────────────────────────────────────────────────────────────────────

// Legacy's exact tolerance strings (the template prints them verbatim).
const TOLERANCE_LABELS: [number, string][] = [
  [0.0625, "1/16 (.0625) inch"],
  [0.125, "1/8 (.125) inch"],
  [0.1875, "3/16 (.1875) inch"],
  [0.25, "1/4 (.25) inch"],
];

export function toleranceLabel(tol: number): string {
  const hit = TOLERANCE_LABELS.find(([v]) => Math.abs(v - tol) < 1e-9);
  return hit ? hit[1] : `${numStr(tol)} inch`;
}

// No float noise: 3.5625 stays "3.5625", 0.1 + 0.2 → "0.3". null/non-finite → "".
function numStr(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(+n.toFixed(4)) : "";
}

export interface QcDriveRecord {
  invoice_number: string | null;
  customer: string | null;
  part_description: string | null;
  dimensions_text: string | null;
  line_quantity: number | null;
  lot_size: number;
  sample_size: number;
  tolerance_in: number;
  nominal_length: number | null;
  nominal_width: number | null;
  nominal_height: number | null;
  nominal_taper: string | null;
  inspector_name: string | null;
  inspected_at: string; // "YYYY-MM-DD HH:MM:SS" UTC
}

export interface QcDriveSample {
  sample_no: number;
  length: number | null;
  width: number | null;
  height: number | null;
  taper: string | null;
  visual_pass: number | boolean;
  result: "pass" | "fail";
}

export interface GasPayload {
  jobId: string;
  date: string;
  time: string;
  productCut: string;
  totalPieces: string;
  inspector: string;
  lotSize: string;
  sampleSizeRequired: string;
  tolerance: string;
  dimLength: string;
  dimWidth: string;
  dimHeight: string;
  dimTapers: string;
  customer: string;
  samples: { length: string; width: string; height: string; taper: string; visualPass: boolean; passFail: "Y" | "N" }[];
}

// ET wall clock of a stored UTC timestamp: { date "YYYY-MM-DD", time "HH:MM" 24h }.
function etDateTime(ts: string): { date: string; time: string } {
  const ms = parseStoredUtc(ts) ?? Date.now();
  const { date, minutes } = etNowWallClock(ms);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return { date, time: `${hh}:${mm}` };
}

// qc-03b: the template's Product Cut cell (and the PDF name) — dimensions, not the line description,
// which ran the PDF onto two pages. Thickness first, as orders are written: "3-5 x 47 x 96" (taper en
// dash → ASCII "-") or "3.5625 x 15.5 x 37.5"; no H/taper → "W x L". Fallbacks: dimensions text, then
// the first 40 chars of the description, then "".
export function productCutFor(rec: Pick<QcDriveRecord, "nominal_length" | "nominal_width" | "nominal_height" | "nominal_taper" | "dimensions_text" | "part_description">): string {
  const w = numStr(rec.nominal_width);
  const l = numStr(rec.nominal_length);
  if (w && l) {
    const thick = rec.nominal_taper ? rec.nominal_taper.replace(/–/g, "-") : numStr(rec.nominal_height);
    return thick ? `${thick} x ${w} x ${l}` : `${w} x ${l}`;
  }
  const dims = (rec.dimensions_text ?? "").trim();
  if (dims) return dims;
  return (rec.part_description ?? "").trim().slice(0, 40).trim();
}

export function buildGasPayload(rec: QcDriveRecord, samples: QcDriveSample[], customerForSheet: string | null): GasPayload {
  const { date, time } = etDateTime(rec.inspected_at);
  return {
    jobId: rec.invoice_number ?? "",
    date,
    time,
    productCut: productCutFor(rec),
    totalPieces: String(rec.line_quantity ?? ""),
    inspector: rec.inspector_name ?? "",
    lotSize: String(rec.lot_size),
    sampleSizeRequired: String(rec.sample_size),
    tolerance: toleranceLabel(rec.tolerance_in),
    dimLength: numStr(rec.nominal_length),
    dimWidth: numStr(rec.nominal_width),
    dimHeight: numStr(rec.nominal_height),
    dimTapers: rec.nominal_taper ?? "",
    customer: customerForSheet ?? rec.customer ?? "",
    samples: [...samples]
      .sort((a, b) => a.sample_no - b.sample_no)
      .map((s) => ({
        length: numStr(s.length),
        width: numStr(s.width),
        height: numStr(s.height),
        taper: s.taper ?? "",
        visualPass: !!s.visual_pass,
        passFail: s.result === "pass" ? "Y" : "N",
      })),
  };
}

// ── Incident payload (qc-08) ────────────────────────────────────────────────────────────────────

export interface QcIncidentDriveRecord {
  incident_date: string;
  person_completing: string;
  reporting_individual: string | null;
  customer: string;
  job_ref: string | null;
  product_delivered: string;
  delivery_date: string | null;
  incident_category: string;
  incident_details: string;
  root_cause: string | null;
  implicated_departments: string[];
  corrective_actions: string | null;
  risk_level: string;
}

export interface GasIncidentPayload {
  action: "createIncidentReport";
  date: string;
  personCompletingReport: string;
  reportingIndividual: string;
  customer: string;
  jobId: string;
  productDelivered: string;
  deliveryDate: string;
  incidentCategory: string;
  incidentDetails: string;
  rootCauseDescription: string;
  implicatedDepartments: string[];
  correctiveActions: string;
  riskLevel: string;
}

// Exactly legacy's keys; nulls → "". jobId is the INV as entered (job_ref), customer the sheet name
// when one matched (else the raw name → the script's default incident folder).
export function buildIncidentPayload(rec: QcIncidentDriveRecord, customerForSheet: string | null): GasIncidentPayload {
  return {
    action: "createIncidentReport",
    date: rec.incident_date ?? "",
    personCompletingReport: rec.person_completing ?? "",
    reportingIndividual: rec.reporting_individual ?? "",
    customer: customerForSheet ?? rec.customer ?? "",
    jobId: rec.job_ref ?? "",
    productDelivered: rec.product_delivered ?? "",
    deliveryDate: rec.delivery_date ?? "",
    incidentCategory: rec.incident_category ?? "",
    incidentDetails: rec.incident_details ?? "",
    rootCauseDescription: rec.root_cause ?? "",
    implicatedDepartments: [...(rec.implicated_departments ?? [])],
    correctiveActions: rec.corrective_actions ?? "",
    riskLevel: rec.risk_level ?? "",
  };
}

// ── Response ────────────────────────────────────────────────────────────────────────────────────

// qc-08: normalized — the inspection reply carries pdfFileId/pdfName, the incident reply docFileId/docName.
export type GasResult = { ok: true; fileId: string; fileName: string } | { ok: false; error: string };

// The script answers HTTP 200 for errors too, so the body decides. Non-JSON (a Google HTML error or
// login page) is a failure with the first 200 chars, tags stripped.
export function parseGasResponse(text: string): GasResult {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    const snippet = String(text ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    return { ok: false, error: `Apps Script returned non-JSON: ${snippet}` };
  }
  const fileId = json?.pdfFileId || json?.docFileId;
  if (json && json.ok === true && fileId) {
    return { ok: true, fileId: String(fileId), fileName: String(json.pdfName ?? json.docName ?? "") };
  }
  return { ok: false, error: String(json?.error || "Apps Script returned ok:false with no error.") };
}
