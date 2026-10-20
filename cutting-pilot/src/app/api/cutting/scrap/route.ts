// src/app/api/cutting/scrap/route.ts  ->  POST /v2/api/cutting/scrap
// qc-05: scrap logged from the cutting board — Mark Complete (CompleteLineModal) and clock-out
// (HandoffModal) on Main Line / Blue Line. Writes scrap_events through the same saveScrapEntries path as
// the /v2/qc popup, with source='cutting'. The operator only sends the part, size, density, reason and
// notes; everything else is filled in here and any client-sent operator_name / inv_number / event_date /
// line_machine is ignored:
//   operator = the session user (X-User-Id → operator_id, X-User-Name → operator_name)
//   line_machine = the line, event_date = today in ET, INV + customer = the job,
//   cutting_line_id = cutting_lines (job_id, line).
// Body: { job_id, line, shift, entries: [{ line_item_id?, part_product, material_density?, pieces,
//         thickness_in, width_in, length_in, scrap_reason, notes? }] } (1–20, all-or-nothing).
// Gated on `manufacturing.cutting` by middleware's /v2/api/cutting row (POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { etNowWallClock } from "@/lib/etDateTime";
import { SHIFT_VALUES } from "@/lib/qc/scrap";
import { saveScrapEntries } from "@/lib/qc/scrapWrite";

// P295: v2 cutting is Main Line / Blue Line only.
const CUTTING_SCRAP_LINES = ["Main Line", "Blue Line"];

function bad(error: string, detail = "", status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
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
  const jobId = typeof body?.job_id === "string" ? body.job_id.trim() : "";
  const line = typeof body?.line === "string" ? body.line : "";
  const shift = typeof body?.shift === "string" ? body.shift : "";
  if (!jobId) return bad("job_id is required.");
  if (!CUTTING_SCRAP_LINES.includes(line)) return bad("Invalid line.", `line=${line}`);
  if (!(SHIFT_VALUES as readonly string[]).includes(shift)) return bad("Shift is required.", `shift=${shift}`);
  if (!actorName.trim()) return bad("Your user has no name on file.");

  try {
    const { DB } = await getEnv();
    const job = await DB.prepare(`SELECT id, invoice_number FROM jobs WHERE id = ?`)
      .bind(jobId)
      .first<{ id: string; invoice_number: string | null }>();
    if (!job) return bad("That job no longer exists.", `job_id=${jobId}`, 404);
    const inv = (job.invoice_number ?? "").trim();
    if (!inv) return bad("This job has no INV # on file — scrap can't be logged against it.", `job_id=${jobId}`);

    const eventDate = etNowWallClock().date;
    const raw: unknown[] = Array.isArray(body?.entries) ? body.entries : [];
    const built = raw.map((e: any) => ({
      event_date: eventDate,
      shift,
      inv_number: inv,
      job_id: jobId,
      line_item_id: e?.line_item_id ?? null,
      line_machine: line,
      operator_name: actorName,
      part_product: e?.part_product,
      material_density: e?.material_density,
      pieces: e?.pieces,
      thickness_in: e?.thickness_in,
      width_in: e?.width_in,
      length_in: e?.length_in,
      scrap_reason: e?.scrap_reason,
      notes: e?.notes,
    }));

    const r = await saveScrapEntries(DB, built, {
      source: "cutting",
      actorId,
      actorName,
      operatorId: actorId,
      cuttingLineIdByJob: async (id) => {
        const row = await DB.prepare(`SELECT id FROM cutting_lines WHERE job_id = ? AND line = ? LIMIT 1`)
          .bind(id, line)
          .first<{ id: string }>();
        return row?.id ?? null;
      },
    });
    if (r.ok) return NextResponse.json({ ok: true, entries: r.rows }, { status: 201 });
    return NextResponse.json(
      { ok: false, error: r.error, detail: r.detail ?? "", ...(r.errors ? { errors: r.errors } : {}) },
      { status: r.status }
    );
  } catch (e: any) {
    return bad("Couldn't save the scrap entries.", String(e?.message || e), 500);
  }
}
