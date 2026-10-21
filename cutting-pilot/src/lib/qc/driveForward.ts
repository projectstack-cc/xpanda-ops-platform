// src/lib/qc/driveForward.ts — qc-03 (server-only)
// Forwards a qc_inspections row to the "Inspection Tool" Apps Script (QC_GAS_URL), which files the
// inspection PDF into the customer's Drive folder. Three callers, one atomic claim so a row is never
// forwarded twice at once: the POST route's ctx.waitUntil right after save, the */5 cron sweep
// (runQcDriveSweep, from custom-worker.ts — picks up dropped waitUntils and retries failed rows up to
// 3 attempts), and the board's manual Retry Drive (ignores the attempts cap). Only the latest
// inspection of a line (superseded_at IS NULL) is ever sent. Never throws: every failure is recorded
// as drive_status 'failed' + drive_error. Cron context: no session, never getCloudflareContext() —
// the env comes in from scheduled() (same as shiftRiskCron.ts).
// qc-08: generalized over a fixed target table — "inspection" (qc_inspections → PDF) and "incident"
// (qc_incidents → incident Doc + incident-tracker Sheet row, customers from getIncidentCustomers).
// Both share the claim, timeouts, response parsing and recording below; forwardInspection is unchanged
// for its callers, forwardIncident sits beside it, and the */5 sweep covers both tables.
import type { D1Database } from "@cloudflare/workers-types";
import { logActivity } from "@/lib/activityLog";
import {
  buildGasPayload,
  buildIncidentPayload,
  matchSheetCustomer,
  parseGasResponse,
  type QcDriveRecord,
  type QcDriveSample,
} from "./drive";
import { parseDepartments, type IncidentRow } from "./incident";

export interface QcDriveEnv {
  DB: D1Database;
  QC_GAS_URL?: string;
}

export type DriveOutcome = "synced" | "failed" | "skipped";

const POST_TIMEOUT_MS = 25_000; // < the 2-minute claim window, so attempts never overlap
const CUSTOMERS_TIMEOUT_MS = 10_000;
// qc-03b: post-save path only — 3 s + 25 s script = 28 s, inside waitUntil's ~30 s.
export const POST_SAVE_CUSTOMERS_TIMEOUT_MS = 3_000;
const MAX_AUTO_ATTEMPTS = 3;
const SWEEP_BATCH = 10;
export const TIMEOUT_ERROR = "Timed out — the PDF may still have been created; check Drive before retrying.";
export const INCIDENT_TIMEOUT_ERROR = "Timed out — the Doc may still have been created; check Drive before retrying.";

export type DriveTarget = "inspection" | "incident";

// Fixed map — the table name in every SQL string below comes only from here, never from input.
const TARGETS: Record<
  DriveTarget,
  { table: string; entity: string; customersAction: string; claimExtra: string; sweepOrder: string; timeoutError: string }
> = {
  inspection: {
    table: "qc_inspections",
    entity: "qc_inspection",
    customersAction: "getCustomers",
    claimExtra: "AND superseded_at IS NULL", // only the latest inspection of a line is ever sent
    sweepOrder: "inspected_at",
    timeoutError: TIMEOUT_ERROR,
  },
  incident: {
    table: "qc_incidents",
    entity: "qc_incident",
    customersAction: "getIncidentCustomers",
    claimExtra: "",
    sweepOrder: "created_at",
    timeoutError: INCIDENT_TIMEOUT_ERROR,
  },
};

interface InspectionRecord extends QcDriveRecord {
  id: string;
}

function isAbort(e: unknown): boolean {
  const name = (e as any)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

// One deadline for the whole exchange — headers AND body. A response that sends headers then stalls
// its body would otherwise outlive the timeout (clearing the timer at the headers leaves res.text()
// unbounded). The race rejects with an AbortError even if the body stream ignores the signal.
async function fetchTextWithTimeout(url: string, init: RequestInit, ms: number): Promise<string> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(Object.assign(new Error("timed out"), { name: "AbortError" }));
    }, ms);
  });
  try {
    return await Promise.race([fetch(url, { ...init, signal: ac.signal }).then((res) => res.text()), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// Active customer names from one of the script's customer sheets — getCustomers (FINAL INSPECTION
// master sheet) or getIncidentCustomers (incident sheet). qc-08: deduped case-insensitively, since the
// incident sheet lists some names twice. Any failure → [] (raw-name fallback; the script then files to
// its default folder) — never fails the forward.
export async function fetchSheetCustomers(
  gasUrl: string,
  timeoutMs: number = CUSTOMERS_TIMEOUT_MS,
  action: string = "getCustomers"
): Promise<string[]> {
  try {
    const sep = gasUrl.includes("?") ? "&" : "?";
    const text = await fetchTextWithTimeout(`${gasUrl}${sep}action=${action}`, { redirect: "follow" }, timeoutMs);
    const json = JSON.parse(text);
    if (!Array.isArray(json)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of json) {
      if (typeof n !== "string" || n.trim() === "") continue;
      const key = n.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out;
  } catch (e) {
    console.error(`qc-drive: ${action} failed`, String((e as any)?.message || e));
    return [];
  }
}

export interface ForwardOpts {
  manual: boolean;
  customerNames?: string[];
  // actorId: the retrying user, for the manual-retry activity row (cron/auto runs log nothing).
  actorId?: string | null;
  customersTimeoutMs?: number;
}

// What a target's loader hands the shared send: the manual-retry log label, the raw customer to map
// onto a sheet name, and the payload for that sheet name.
interface Loaded {
  label: string;
  customer: string;
  payload: (sheetCustomer: string | null) => Promise<unknown>;
}

async function forwardRow(
  db: D1Database,
  gasUrl: string | undefined,
  target: DriveTarget,
  id: string,
  opts: ForwardOpts,
  load: () => Promise<Loaded | null>
): Promise<DriveOutcome> {
  const t = TARGETS[target];
  let label = target === "inspection" ? "INV —" : "incident —";
  const finish = async (status: "synced" | "failed", detail: Record<string, unknown>): Promise<DriveOutcome> => {
    if (opts.manual) {
      await logActivity(db, "update", t.entity, id, `Drive retry ${label}: ${status}`, { drive_status: status, ...detail }, opts.actorId ?? null);
    }
    return status;
  };
  const fail = async (error: string): Promise<DriveOutcome> => {
    const msg = error.slice(0, 500);
    try {
      await db.prepare(`UPDATE ${t.table} SET drive_status = 'failed', drive_error = ? WHERE id = ?`).bind(msg, id).run();
    } catch (e) {
      console.error("qc-drive: could not record failure", id, String((e as any)?.message || e));
    }
    console.error("qc-drive: forward failed", id, msg);
    return finish("failed", { drive_error: msg });
  };

  try {
    // 1. Atomic claim — only the run whose UPDATE changed the row proceeds.
    const claim = await db
      .prepare(
        `UPDATE ${t.table}
            SET drive_attempted_at = datetime('now'), drive_attempts = drive_attempts + 1
          WHERE id = ? ${t.claimExtra} AND drive_status <> 'synced'
            AND (drive_attempted_at IS NULL OR drive_attempted_at < datetime('now','-2 minutes'))
            AND (? = 1 OR drive_attempts < ${MAX_AUTO_ATTEMPTS})`
      )
      .bind(id, opts.manual ? 1 : 0)
      .run();
    if (Number(claim.meta?.changes ?? 0) !== 1) return "skipped";

    // 3. Load the record (before the URL check so a manual retry's log can name it).
    const rec = await load();
    if (!rec) return "skipped";
    label = rec.label;

    // 2. No URL configured → recorded failure, never a throw.
    if (!gasUrl) return fail("QC_GAS_URL not configured");

    // 4–5. Map the customer onto a sheet name (null → raw name, default folder).
    const names = opts.customerNames ?? (await fetchSheetCustomers(gasUrl, opts.customersTimeoutMs, t.customersAction));
    const sheetCustomer = matchSheetCustomer(rec.customer, names);
    const payload = await rec.payload(sheetCustomer);

    // 6. POST form-encoded `payload` (the script reads e.parameter.payload); Apps Script 302s to
    // googleusercontent, which fetch follows. The 25 s deadline covers the body read too.
    let text: string;
    try {
      text = await fetchTextWithTimeout(
        gasUrl,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
          redirect: "follow",
        },
        POST_TIMEOUT_MS
      );
    } catch (e) {
      return fail(isAbort(e) ? t.timeoutError : `Apps Script request failed: ${String((e as any)?.message || e)}`);
    }

    // 7. The script answers 200 even on error — the body decides.
    const parsed = parseGasResponse(text);
    if (!parsed.ok) return fail(parsed.error);

    await db
      .prepare(
        `UPDATE ${t.table}
            SET drive_status = 'synced', drive_synced_at = datetime('now'), drive_file_id = ?, drive_file_name = ?,
                drive_customer = ?, drive_error = NULL
          WHERE id = ?`
      )
      .bind(parsed.fileId, parsed.fileName, sheetCustomer, id)
      .run();
    return finish("synced", { drive_file_id: parsed.fileId, drive_customer: sheetCustomer });
  } catch (e) {
    // 8. Never throw.
    return fail(isAbort(e) ? t.timeoutError : String((e as any)?.message || e));
  }
}

export async function forwardInspection(
  db: D1Database,
  gasUrl: string | undefined,
  id: string,
  opts: ForwardOpts
): Promise<DriveOutcome> {
  return forwardRow(db, gasUrl, "inspection", id, opts, async () => {
    const rec = await db
      .prepare(
        `SELECT id, invoice_number, customer, part_description, dimensions_text, line_quantity, lot_size, sample_size, tolerance_in,
                nominal_length, nominal_width, nominal_height, nominal_taper, inspector_name, inspected_at
           FROM qc_inspections WHERE id = ?`
      )
      .bind(id)
      .first<InspectionRecord>();
    if (!rec) return null;
    return {
      label: `INV ${rec.invoice_number || "—"}`,
      customer: rec.customer ?? "",
      payload: async (sheetCustomer) => {
        const { results: samples } = await db
          .prepare(
            `SELECT sample_no, length, width, height, taper, visual_pass, result
               FROM qc_inspection_samples WHERE inspection_id = ? ORDER BY sample_no`
          )
          .bind(id)
          .all<QcDriveSample>();
        return buildGasPayload(rec, samples ?? [], sheetCustomer);
      },
    };
  });
}

// qc-08: an incident report → the script's createIncidentReport (incident Doc into the customer's
// incident folder + a row on the incident tracker Sheet that legacy Reports reads via gviz).
export async function forwardIncident(
  db: D1Database,
  gasUrl: string | undefined,
  id: string,
  opts: ForwardOpts
): Promise<DriveOutcome> {
  return forwardRow(db, gasUrl, "incident", id, opts, async () => {
    const rec = await db
      .prepare(
        `SELECT incident_date, person_completing, reporting_individual, customer, job_ref, product_delivered, delivery_date,
                incident_category, incident_details, root_cause, implicated_departments, corrective_actions, risk_level
           FROM qc_incidents WHERE id = ?`
      )
      .bind(id)
      .first<IncidentRow>();
    if (!rec) return null;
    return {
      label: `incident ${rec.customer || "—"} ${rec.incident_date}`,
      customer: rec.customer ?? "",
      payload: async (sheetCustomer) =>
        buildIncidentPayload({ ...rec, implicated_departments: parseDepartments(rec.implicated_departments) }, sheetCustomer),
    };
  });
}

const FORWARDERS: Record<DriveTarget, typeof forwardInspection> = {
  inspection: forwardInspection,
  incident: forwardIncident,
};

// Cron: per target, up to 10 unsynced rows (inspections: latest only), oldest first, attempts < 3,
// claim window clear. Each target's customer list is fetched once, and only when it has rows;
// forwards run sequentially. Inspections first, then incidents — each in its own block, so an empty
// (or failing) inspection batch never starves incidents.
export async function runQcDriveSweep(env: QcDriveEnv): Promise<void> {
  if (!env.QC_GAS_URL) return;
  for (const target of ["inspection", "incident"] as DriveTarget[]) {
    const t = TARGETS[target];
    try {
      const { results } = await env.DB.prepare(
        `SELECT id FROM ${t.table}
          WHERE drive_status <> 'synced' ${t.claimExtra}
            AND drive_attempts < ${MAX_AUTO_ATTEMPTS}
            AND (drive_attempted_at IS NULL OR drive_attempted_at < datetime('now','-2 minutes'))
          ORDER BY ${t.sweepOrder}
          LIMIT ${SWEEP_BATCH}`
      ).all<{ id: string }>();
      const ids = (results ?? []).map((r) => r.id);
      if (!ids.length) continue;
      const customerNames = await fetchSheetCustomers(env.QC_GAS_URL, CUSTOMERS_TIMEOUT_MS, t.customersAction);
      for (const id of ids) {
        await FORWARDERS[target](env.DB, env.QC_GAS_URL, id, { manual: false, customerNames });
      }
    } catch (e) {
      console.error(`qc-drive: ${target} sweep failed`, String((e as any)?.message || e));
    }
  }
}
