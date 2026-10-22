// src/app/api/qc/inspections/route.ts  ->  POST /v2/api/qc/inspections
// qc-02: record a Final Inspection for one order line (the /v2/qc Inspect modal). One inspection per
// line: re-inspecting supersedes the current row (superseded_at set, kept for audit) in the same
// DB.batch as the insert. Each record snapshots INV / customer / part / dimensions / quantity and
// has no FKs, so it outlives later order edits and job deletion. Holey Board lines are refused
// (same parts.category test as the board). The overall result is computed here from the samples —
// the client never sends it. drive_status starts 'pending'; qc-03: right after save, ctx.waitUntil
// forwards it to the Inspection Tool Apps Script (PDF → customer's Drive folder) — never awaited, the
// modal doesn't wait on Google. No ctx (next dev) → skipped; the */5 cron sweep picks the row up.
// Inspector = the session user (X-User-Id / X-User-Name from middleware), never a form field.
// qc-06: validation stays here; the supersede/insert/samples batch and its activity row moved to
// lib/qc/inspectionWrite.ts (shared with the admin bulk route), written with entry_method 'manual'.
// Gated on `qc` by middleware (POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/db";
import { forwardInspection, POST_SAVE_CUSTOMERS_TIMEOUT_MS } from "@/lib/qc/driveForward";
import { TOLERANCES, isSampleComplete, sampleSizeFor } from "@/lib/qc/board";
import { inspectionNow, saveInspection, type LineRow } from "@/lib/qc/inspectionWrite";

function bad(error: string, detail = "") {
  return NextResponse.json({ ok: false, error, detail }, { status: 400 });
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

export async function POST(request: NextRequest) {
  const actorId = request.headers.get("X-User-Id");
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const actorName = request.headers.get("X-User-Name") || "";

  let body: any;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const lineItemId = str(body?.line_item_id, 100);
  if (!lineItemId) return bad("line_item_id is required.");

  try {
    const { DB } = await getEnv();

    const line = await DB.prepare(
      `SELECT li.id, li.job_id, li.description, li.dimensions, li.quantity, p.category,
              j.invoice_number, j.customer
         FROM job_line_items li
         JOIN jobs j ON j.id = li.job_id
         LEFT JOIN parts p ON p.id = li.part_id
        WHERE li.id = ?`
    )
      .bind(lineItemId)
      .first<LineRow>();
    if (!line) return NextResponse.json({ ok: false, error: "Line not found.", detail: lineItemId }, { status: 404 });
    if (line.category === "Holey Board") return bad("Holey Board lines aren't inspected.");

    const lot = body?.lot_size;
    if (typeof lot !== "number" || !Number.isInteger(lot) || lot < 1) {
      return bad("Lot size must be a whole number of at least 1.", `lot_size=${JSON.stringify(lot)}`);
    }
    const tolerance = body?.tolerance_in;
    if (!TOLERANCES.some((t) => t.value === tolerance)) {
      return bad("Tolerance must be one of 1/16, 1/8, 3/16 or 1/4 in.", `tolerance_in=${JSON.stringify(tolerance)}`);
    }

    const sampleSize = sampleSizeFor(lot) as number;
    const samples: any[] = Array.isArray(body?.samples) ? body.samples : [];
    if (samples.length !== sampleSize) {
      return bad(`Expected ${sampleSize} samples.`, `got ${samples.length}`);
    }
    // isSampleComplete also requires result ∈ {pass, fail}, so a bad result is reported here too.
    const incomplete = samples.map((s, i) => (isSampleComplete(s ?? {}) ? 0 : i + 1)).filter(Boolean);
    if (incomplete.length) return bad(`Sample(s) ${incomplete.join(", ")} incomplete.`);

    const nominal = body?.nominal ?? {};
    const { id, inspection } = await saveInspection(DB, {
      line,
      lot,
      tolerance,
      nominal,
      samples,
      actorId,
      actorName,
      now: inspectionNow(),
      entryMethod: "manual",
    });

    // qc-03: forward to Drive off the response path. forwardInspection never throws. Production
    // builds only: under next dev, getPlatformProxy hands back a ctx AND the real QC_GAS_URL from
    // wrangler.toml, so a local test save would file a real PDF into Steve's Drive.
    if (process.env.NODE_ENV === "production") {
      try {
        const { env, ctx } = await getCloudflareContext();
        ctx?.waitUntil?.(forwardInspection(DB, (env as any).QC_GAS_URL, id, { manual: false, customersTimeoutMs: POST_SAVE_CUSTOMERS_TIMEOUT_MS, secret: (env as any).QC_GAS_SECRET }));
      } catch {
        // No Cloudflare context — the */5 cron sweep forwards it.
      }
    }

    return NextResponse.json({ ok: true, inspection }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't save the inspection.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
