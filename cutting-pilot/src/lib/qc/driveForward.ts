// src/lib/qc/driveForward.ts — qc-03 (server-only)
// Forwards a qc_inspections row to the "Inspection Tool" Apps Script (QC_GAS_URL), which files the
// inspection PDF into the customer's Drive folder. Three callers, one atomic claim so a row is never
// forwarded twice at once: the POST route's ctx.waitUntil right after save, the */5 cron sweep
// (runQcDriveSweep, from custom-worker.ts — picks up dropped waitUntils and retries failed rows up to
// 3 attempts), and the board's manual Retry Drive (ignores the attempts cap). Only the latest
// inspection of a line (superseded_at IS NULL) is ever sent. Never throws: every failure is recorded
// as drive_status 'failed' + drive_error. Cron context: no session, never getCloudflareContext() —
// the env comes in from scheduled() (same as shiftRiskCron.ts).
import type { D1Database } from "@cloudflare/workers-types";
import { logActivity } from "@/lib/activityLog";
import { buildGasPayload, matchSheetCustomer, parseGasResponse, type QcDriveRecord, type QcDriveSample } from "./drive";

export interface QcDriveEnv {
  DB: D1Database;
  QC_GAS_URL?: string;
}

export type DriveOutcome = "synced" | "failed" | "skipped";

const POST_TIMEOUT_MS = 25_000; // < the 2-minute claim window, so attempts never overlap
const CUSTOMERS_TIMEOUT_MS = 10_000;
const MAX_AUTO_ATTEMPTS = 3;
const SWEEP_BATCH = 10;
export const TIMEOUT_ERROR = "Timed out — the PDF may still have been created; check Drive before retrying.";

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

// Active customer names from the script's master sheet. Any failure → [] (raw-name fallback; the
// script then files to its default folder) — never fails the forward.
export async function fetchSheetCustomers(gasUrl: string): Promise<string[]> {
  try {
    const sep = gasUrl.includes("?") ? "&" : "?";
    const text = await fetchTextWithTimeout(`${gasUrl}${sep}action=getCustomers`, { redirect: "follow" }, CUSTOMERS_TIMEOUT_MS);
    const json = JSON.parse(text);
    return Array.isArray(json) ? json.filter((n): n is string => typeof n === "string" && n.trim() !== "") : [];
  } catch (e) {
    console.error("qc-drive: getCustomers failed", String((e as any)?.message || e));
    return [];
  }
}

export async function forwardInspection(
  db: D1Database,
  gasUrl: string | undefined,
  id: string,
  // actorId: the retrying user, for the manual-retry activity row (cron/auto runs log nothing).
  opts: { manual: boolean; customerNames?: string[]; actorId?: string | null }
): Promise<DriveOutcome> {
  let invoice = "";
  const finish = async (status: "synced" | "failed", detail: Record<string, unknown>): Promise<DriveOutcome> => {
    if (opts.manual) {
      await logActivity(db, "update", "qc_inspection", id, `Drive retry INV ${invoice || "—"}: ${status}`, { drive_status: status, ...detail }, opts.actorId ?? null);
    }
    return status;
  };
  const fail = async (error: string): Promise<DriveOutcome> => {
    const msg = error.slice(0, 500);
    try {
      await db.prepare(`UPDATE qc_inspections SET drive_status = 'failed', drive_error = ? WHERE id = ?`).bind(msg, id).run();
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
        `UPDATE qc_inspections
            SET drive_attempted_at = datetime('now'), drive_attempts = drive_attempts + 1
          WHERE id = ? AND superseded_at IS NULL AND drive_status <> 'synced'
            AND (drive_attempted_at IS NULL OR drive_attempted_at < datetime('now','-2 minutes'))
            AND (? = 1 OR drive_attempts < ${MAX_AUTO_ATTEMPTS})`
      )
      .bind(id, opts.manual ? 1 : 0)
      .run();
    if (Number(claim.meta?.changes ?? 0) !== 1) return "skipped";

    // 3. Load the record + samples (before the URL check so a manual retry's log can name the INV).
    const rec = await db
      .prepare(
        `SELECT id, invoice_number, customer, part_description, line_quantity, lot_size, sample_size, tolerance_in,
                nominal_length, nominal_width, nominal_height, nominal_taper, inspector_name, inspected_at
           FROM qc_inspections WHERE id = ?`
      )
      .bind(id)
      .first<InspectionRecord>();
    if (!rec) return "skipped";
    invoice = rec.invoice_number ?? "";

    // 2. No URL configured → recorded failure, never a throw.
    if (!gasUrl) return fail("QC_GAS_URL not configured");

    const { results: samples } = await db
      .prepare(
        `SELECT sample_no, length, width, height, taper, visual_pass, result
           FROM qc_inspection_samples WHERE inspection_id = ? ORDER BY sample_no`
      )
      .bind(id)
      .all<QcDriveSample>();

    // 4–5. Map the order customer onto a master-sheet name (null → raw name, default folder).
    const names = opts.customerNames ?? (await fetchSheetCustomers(gasUrl));
    const sheetCustomer = matchSheetCustomer(rec.customer ?? "", names);

    // 6. POST form-encoded `payload` (the script reads e.parameter.payload); Apps Script 302s to
    // googleusercontent, which fetch follows. The 25 s deadline covers the body read too.
    let text: string;
    try {
      text = await fetchTextWithTimeout(
        gasUrl,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ payload: JSON.stringify(buildGasPayload(rec, samples ?? [], sheetCustomer)) }).toString(),
          redirect: "follow",
        },
        POST_TIMEOUT_MS
      );
    } catch (e) {
      return fail(isAbort(e) ? TIMEOUT_ERROR : `Apps Script request failed: ${String((e as any)?.message || e)}`);
    }

    // 7. The script answers 200 even on error — the body decides.
    const parsed = parseGasResponse(text);
    if (!parsed.ok) return fail(parsed.error);

    await db
      .prepare(
        `UPDATE qc_inspections
            SET drive_status = 'synced', drive_synced_at = datetime('now'), drive_file_id = ?, drive_file_name = ?,
                drive_customer = ?, drive_error = NULL
          WHERE id = ?`
      )
      .bind(parsed.pdfFileId, parsed.pdfName, sheetCustomer, id)
      .run();
    return finish("synced", { drive_file_id: parsed.pdfFileId, drive_customer: sheetCustomer });
  } catch (e) {
    // 8. Never throw.
    return fail(isAbort(e) ? TIMEOUT_ERROR : String((e as any)?.message || e));
  }
}

// Cron: up to 10 unsynced latest-inspection rows, oldest first, attempts < 3, claim window clear.
// getCustomers is fetched once per sweep; forwards run sequentially.
export async function runQcDriveSweep(env: QcDriveEnv): Promise<void> {
  if (!env.QC_GAS_URL) return;
  const { results } = await env.DB.prepare(
    `SELECT id FROM qc_inspections
      WHERE superseded_at IS NULL AND drive_status <> 'synced'
        AND drive_attempts < ${MAX_AUTO_ATTEMPTS}
        AND (drive_attempted_at IS NULL OR drive_attempted_at < datetime('now','-2 minutes'))
      ORDER BY inspected_at
      LIMIT ${SWEEP_BATCH}`
  ).all<{ id: string }>();
  const ids = (results ?? []).map((r) => r.id);
  if (!ids.length) return;
  const customerNames = await fetchSheetCustomers(env.QC_GAS_URL);
  for (const id of ids) {
    await forwardInspection(env.DB, env.QC_GAS_URL, id, { manual: false, customerNames });
  }
}
