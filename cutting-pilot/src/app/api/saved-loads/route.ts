// src/app/api/saved-loads/route.ts  ->  GET /v2/api/saved-loads (live) | POST /v2/api/saved-loads (fenced)
// lb-ui-04. `saved_loads` already exists (DB_Migrations/saved-loads.sql, live in prod, shared
// unfenced with legacy's own GET/POST/PUT/DELETE in _worker.js/routes/bols.js's
// handleApiSavedLoads) -- no migration needed here. This route reimplements the same table's write
// path as a v2-owned, fenced route, the identical precedent ../bols/route.ts already set for the
// (also pre-existing) `bols` table -- the fence has to live in a v2-owned handler to apply at all.
//
// GET's list query mirrors legacy's exactly, but the expiry sweep (`DELETE FROM saved_loads WHERE
// expires_at < ?`, bols.js:781) that legacy runs unconditionally as a side effect of every list
// read is itself gated on V2_LOGISTICS_WRITES_ENABLED here, even though GET is otherwise live. This
// route is reachable from a dark-launched page (admin-only via middleware's logistics.v2 gate) with
// no other write path open -- an ungated DELETE on that path is exactly the category the fence
// exists to prevent, regardless of the fact that the same DELETE already runs unconditionally on
// legacy's own equivalent surface. Until the flag flips, v2's list may show a handful of rows
// legacy has already swept -- a named, bounded, cosmetic divergence, not an ungated prod write.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { V2_LOGISTICS_WRITES_ENABLED } from "@/lib/logistics/writeFence";
import { logActivity } from "@/lib/activityLog";

export async function GET(_request: NextRequest) {
  const { DB } = await getEnv();

  try {
    if (V2_LOGISTICS_WRITES_ENABLED) {
      const now = new Date().toISOString();
      await DB.prepare("DELETE FROM saved_loads WHERE expires_at < ?").bind(now).run();
    }

    const result = await DB.prepare(
      "SELECT id, name, job_id, customer, trailer_type, created_at, updated_at FROM saved_loads ORDER BY updated_at DESC"
    ).all();
    return NextResponse.json({ ok: true, loads: result.results ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Fence check FIRST -- before any D1 write.
  if (!V2_LOGISTICS_WRITES_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "v2 logistics writes disabled (read-only migration phase)" },
      { status: 501 }
    );
  }

  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof payload.state_json !== "string" || !payload.state_json.trim()) {
    return NextResponse.json({ ok: false, error: "state_json is required." }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expires_at = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  try {
    await DB.prepare(
      `INSERT INTO saved_loads (id, name, job_id, customer, trailer_type, state_json, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        String(payload.name || "").trim(),
        payload.job_id ? String(payload.job_id).trim() : null,
        String(payload.customer || "").trim(),
        String(payload.trailer_type || "").trim(),
        payload.state_json,
        now,
        now,
        expires_at
      )
      .run();

    await logActivity(
      DB,
      "create",
      "saved_load",
      id,
      `Saved load "${payload.name || id}" for ${payload.customer || ""}`,
      { name: payload.name, customer: payload.customer, trailer_type: payload.trailer_type },
      actorId
    );

    const row = await DB.prepare("SELECT * FROM saved_loads WHERE id = ?").bind(id).first();
    return NextResponse.json({ ok: true, load: row }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
