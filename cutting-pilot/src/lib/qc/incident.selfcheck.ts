// src/lib/qc/incident.selfcheck.ts — qc-08
// Self-check for the pure incident helpers (incident.ts). No DB.
// Run with: npx tsx src/lib/qc/incident.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import { CATEGORIES, DEPARTMENTS, PRODUCTS, RISK_LEVELS, parseDepartments, productFromLines, validateIncident } from "./incident";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

const TODAY = "2026-10-21";

// Legacy's exact option strings.
eq("PRODUCTS", PRODUCTS, ["Block", "Holey Board", "Sheets", "Other"]);
eq("CATEGORIES", CATEGORIES, ["Fusion", "Density", "Tolerances", "Packaging", "Delivery", "Other"]);
eq("RISK_LEVELS", RISK_LEVELS, ["Low", "Medium", "High"]);
eq("DEPARTMENTS", DEPARTMENTS, ["Molding", "Cutting", "Packaging and Loading", "Delivery"]);

const base = {
  incident_date: "2026-10-20",
  person_completing: "  Steve Cook ",
  customer: "Blue Water Spa Covers",
  product_delivered: "Block",
  incident_category: "Tolerances",
  risk_level: "Medium",
  incident_details: "  Blocks 1/4 in short on length. ",
};

const ok = validateIncident(base, TODAY);
check("valid minimal → ok", ok.ok, JSON.stringify(ok));
if (ok.ok) {
  eq("trims names + details", [ok.value.person_completing, ok.value.incident_details], ["Steve Cook", "Blocks 1/4 in short on length."]);
  eq("optionals → null / []", [ok.value.reporting_individual, ok.value.job_id, ok.value.job_ref, ok.value.delivery_date, ok.value.root_cause, ok.value.corrective_actions, ok.value.implicated_departments], [null, null, null, null, null, null, []]);
}

// Each required field missing → its own error.
const required: [keyof typeof base, string][] = [
  ["incident_date", "Date is required."],
  ["person_completing", "Person completing is required."],
  ["customer", "Customer is required."],
  ["product_delivered", "Product delivered is required."],
  ["incident_category", "Category is required."],
  ["risk_level", "Risk level is required."],
  ["incident_details", "Incident details are required."],
];
for (const [field, msg] of required) {
  const r = validateIncident({ ...base, [field]: "   " }, TODAY);
  check(`missing ${field} → "${msg}"`, !r.ok && r.errors.length === 1 && r.errors[0] === msg, JSON.stringify(r));
}
const empty = validateIncident({}, TODAY);
check("empty → 7 errors", !empty.ok && empty.errors.length === 7, JSON.stringify(empty));

// Values outside the legacy lists.
check("bad product rejected", !validateIncident({ ...base, product_delivered: "Panels" }, TODAY).ok);
check("bad category rejected", !validateIncident({ ...base, incident_category: "fusion" }, TODAY).ok);
check("bad risk rejected", !validateIncident({ ...base, risk_level: "Critical" }, TODAY).ok);

// Dates.
const future = validateIncident({ ...base, incident_date: "2026-10-22" }, TODAY);
eq("future date rejected", future.ok ? [] : future.errors, ["Date can't be in the future."]);
check("today accepted", validateIncident({ ...base, incident_date: TODAY }, TODAY).ok);
const badDate = validateIncident({ ...base, incident_date: "2026-02-30" }, TODAY);
eq("impossible date rejected", badDate.ok ? [] : badDate.errors, ["Date must be YYYY-MM-DD."]);
const badDelivery = validateIncident({ ...base, delivery_date: "10/20/2026" }, TODAY);
eq("bad delivery date rejected", badDelivery.ok ? [] : badDelivery.errors, ["Delivery date must be YYYY-MM-DD."]);
const futureDelivery = validateIncident({ ...base, delivery_date: "2026-11-02" }, TODAY);
check("future delivery date allowed", futureDelivery.ok, JSON.stringify(futureDelivery));

// Departments: subset, deduped, canonical order.
const depts = validateIncident({ ...base, implicated_departments: ["Delivery", "Molding", "Delivery", " Cutting "] }, TODAY);
eq("departments deduped + canonical order", depts.ok ? depts.value.implicated_departments : null, ["Molding", "Cutting", "Delivery"]);
const badDept = validateIncident({ ...base, implicated_departments: ["Molding", "Shipping"] }, TODAY);
eq("unknown department rejected", badDept.ok ? [] : badDept.errors, ["Unknown department: Shipping."]);
const notList = validateIncident({ ...base, implicated_departments: "Molding" }, TODAY);
eq("departments not a list rejected", notList.ok ? [] : notList.errors, ["Implicated departments must be a list."]);

// Caps.
const long = validateIncident({ ...base, incident_details: "x".repeat(5000), root_cause: "r".repeat(4500), customer: "c".repeat(150) }, TODAY);
eq("caps: details/root 4000, names 100", long.ok ? [long.value.incident_details.length, long.value.root_cause?.length, long.value.customer.length] : null, [4000, 4000, 100]);

// Optionals kept.
const full = validateIncident(
  { ...base, reporting_individual: " Driver Dan ", job_id: "job-1", job_ref: " 4477 ", delivery_date: "2026-10-18", root_cause: " saw drift ", corrective_actions: " recalibrate " },
  TODAY
);
eq(
  "optionals trimmed + kept",
  full.ok ? [full.value.reporting_individual, full.value.job_id, full.value.job_ref, full.value.delivery_date, full.value.root_cause, full.value.corrective_actions] : null,
  ["Driver Dan", "job-1", "4477", "2026-10-18", "saw drift", "recalibrate"]
);

// productFromLines.
eq("productFromLines all Holey → Holey Board", productFromLines([{ category: "Holey Board" }, { category: "Holey Board" }]), "Holey Board");
eq("productFromLines mixed → Block", productFromLines([{ category: "Holey Board" }, { category: "Block" }]), "Block");
eq("productFromLines null category → Block", productFromLines([{ category: null }]), "Block");
eq("productFromLines no lines → Block", productFromLines([]), "Block");

// parseDepartments.
eq("parseDepartments JSON", parseDepartments('["Molding","Delivery"]'), ["Molding", "Delivery"]);
eq("parseDepartments null / bad → []", [parseDepartments(null), parseDepartments("not json"), parseDepartments('{"a":1}')], [[], [], []]);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
