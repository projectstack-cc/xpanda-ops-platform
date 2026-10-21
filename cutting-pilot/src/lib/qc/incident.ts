// src/lib/qc/incident.ts — qc-08
// Pure helpers for native QC incident reports (qc_incidents) — the /v2/qc Incident report popup and
// POST /v2/api/qc/incidents. The option lists are legacy qc/_archived/incident-report.html's exact strings: the
// Inspection Tool Apps Script prints them into the incident Doc and the tracker Sheet verbatim, and
// legacy Reports reads that Sheet. No DB, no React — exercised by incident.selfcheck.ts
// (`npx tsx src/lib/qc/incident.selfcheck.ts`).
import { etNowWallClock } from "../etDateTime";
import { isValidYmd } from "./scrap";

export const PRODUCTS = ["Block", "Holey Board", "Sheets", "Other"] as const;
export type Product = (typeof PRODUCTS)[number];

export const CATEGORIES = ["Fusion", "Density", "Tolerances", "Packaging", "Delivery", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const RISK_LEVELS = ["Low", "Medium", "High"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const DEPARTMENTS = ["Molding", "Cutting", "Packaging and Loading", "Delivery"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const NAME_MAX = 100;
export const LONG_TEXT_MAX = 4000;
export const JOB_REF_MAX = 50;

export interface IncidentInput {
  incident_date?: unknown;
  person_completing?: unknown;
  reporting_individual?: unknown;
  customer?: unknown;
  job_id?: unknown;
  job_ref?: unknown;
  product_delivered?: unknown;
  delivery_date?: unknown;
  incident_category?: unknown;
  risk_level?: unknown;
  incident_details?: unknown;
  root_cause?: unknown;
  implicated_departments?: unknown;
  corrective_actions?: unknown;
}

export interface IncidentValue {
  incident_date: string;
  person_completing: string;
  reporting_individual: string | null;
  customer: string;
  job_id: string | null;
  job_ref: string | null;
  product_delivered: Product;
  delivery_date: string | null;
  incident_category: Category;
  risk_level: RiskLevel;
  incident_details: string;
  root_cause: string | null;
  implicated_departments: Department[];
  corrective_actions: string | null;
}

// The columns the list / create / retry routes select.
export const INCIDENT_COLUMNS = `id, incident_date, person_completing, reporting_individual, customer, job_id, job_ref,
  product_delivered, delivery_date, incident_category, risk_level, incident_details, root_cause, implicated_departments,
  corrective_actions, created_by_id, created_by_name, created_at, drive_status, drive_error, drive_synced_at,
  drive_file_id, drive_file_name, drive_customer, drive_attempted_at, drive_attempts`;

// A stored qc_incidents row as the list / retry routes return it (implicated_departments is the JSON text).
export interface IncidentRow {
  id: string;
  incident_date: string;
  person_completing: string;
  reporting_individual: string | null;
  customer: string;
  job_id: string | null;
  job_ref: string | null;
  product_delivered: string;
  delivery_date: string | null;
  incident_category: string;
  risk_level: string;
  incident_details: string;
  root_cause: string | null;
  implicated_departments: string | null;
  corrective_actions: string | null;
  created_by_id: string | null;
  created_by_name: string | null;
  created_at: string;
  drive_status: "pending" | "synced" | "failed";
  drive_error: string | null;
  drive_synced_at: string | null;
  drive_file_id: string | null;
  drive_file_name: string | null;
  drive_customer: string | null;
  drive_attempted_at: string | null;
  drive_attempts: number;
}

function text(v: unknown, max: number): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function oneOf<T extends string>(list: readonly T[], v: string): v is T {
  return (list as readonly string[]).includes(v);
}

/** Validate + normalize one incident. `todayEt` (YYYY-MM-DD) defaults to today in ET. */
export function validateIncident(
  input: IncidentInput,
  todayEt: string = etNowWallClock().date
): { ok: true; value: IncidentValue } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const incident_date = text(input.incident_date, 10);
  const person_completing = text(input.person_completing, NAME_MAX);
  const reporting_individual = text(input.reporting_individual, NAME_MAX);
  const customer = text(input.customer, NAME_MAX);
  const job_id = text(input.job_id, 100);
  const job_ref = text(input.job_ref, JOB_REF_MAX);
  const product = text(input.product_delivered, 50);
  const delivery_date = text(input.delivery_date, 10);
  const category = text(input.incident_category, 50);
  const risk = text(input.risk_level, 20);
  const incident_details = text(input.incident_details, LONG_TEXT_MAX);
  const root_cause = text(input.root_cause, LONG_TEXT_MAX);
  const corrective_actions = text(input.corrective_actions, LONG_TEXT_MAX);

  if (!incident_date) errors.push("Date is required.");
  else if (!isValidYmd(incident_date)) errors.push("Date must be YYYY-MM-DD.");
  else if (incident_date > todayEt) errors.push("Date can't be in the future.");
  if (!person_completing) errors.push("Person completing is required.");
  if (!customer) errors.push("Customer is required.");
  if (!oneOf(PRODUCTS, product)) errors.push("Product delivered is required.");
  if (delivery_date && !isValidYmd(delivery_date)) errors.push("Delivery date must be YYYY-MM-DD.");
  if (!oneOf(CATEGORIES, category)) errors.push("Category is required.");
  if (!oneOf(RISK_LEVELS, risk)) errors.push("Risk level is required.");
  if (!incident_details) errors.push("Incident details are required.");

  let departments: Department[] = [];
  const rawDepts = input.implicated_departments;
  if (rawDepts != null && !Array.isArray(rawDepts)) {
    errors.push("Implicated departments must be a list.");
  } else if (Array.isArray(rawDepts)) {
    const picked = rawDepts.map((d) => (typeof d === "string" ? d.trim() : ""));
    const unknown = picked.filter((d) => !oneOf(DEPARTMENTS, d));
    if (unknown.length) errors.push(`Unknown department: ${unknown.join(", ")}.`);
    // Deduplicated, in the canonical (legacy checkbox) order.
    departments = DEPARTMENTS.filter((d) => picked.includes(d));
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      incident_date,
      person_completing,
      reporting_individual: reporting_individual || null,
      customer,
      job_id: job_id || null,
      job_ref: job_ref || null,
      product_delivered: product as Product,
      delivery_date: delivery_date || null,
      incident_category: category as Category,
      risk_level: risk as RiskLevel,
      incident_details,
      root_cause: root_cause || null,
      implicated_departments: departments,
      corrective_actions: corrective_actions || null,
    },
  };
}

/** INV lookup prefill: "Holey Board" when there's ≥ 1 line and every line is Holey Board, else "Block". */
export function productFromLines(lines: { category: string | null }[]): Product {
  return lines.length > 0 && lines.every((l) => l.category === "Holey Board") ? "Holey Board" : "Block";
}

/** implicated_departments column (JSON text) → array; bad/missing → []. */
export function parseDepartments(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
}
