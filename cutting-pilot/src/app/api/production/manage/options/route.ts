// src/app/api/production/manage/options/route.ts  →  /v2/api/production/manage/options
// Manager-only: add a new dropdown value, retire/restore an existing one. Suppliers are seeded,
// not addable here. Gated production.manage by the middleware prefix; also checked directly
// below as defense-in-depth, mirroring X-User-Can-Manage-Loading in api/loading-assignments.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

const ADDABLE_KINDS = ["block_type", "block_size", "bead_type"];

function normalizeValue(v: any): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  const canManage = request.headers.get("X-User-Can-Manage-Production") === "1";
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canManage) return NextResponse.json({ ok: false, error: "Manager access required." }, { status: 403 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const kind = body?.kind;
  const value = normalizeValue(body?.value);
  const grp = kind === "bead_type" ? normalizeValue(body?.grp) : "";

  if (!ADDABLE_KINDS.includes(kind)) {
    return NextResponse.json({ ok: false, error: "Invalid kind." }, { status: 400 });
  }
  if (!value) {
    return NextResponse.json({ ok: false, error: "Value is required." }, { status: 400 });
  }
  if (kind === "bead_type" && !grp) {
    return NextResponse.json({ ok: false, error: "Supplier is required for a bead type." }, { status: 400 });
  }

  try {
    if (kind === "bead_type") {
      const supplier = await DB.prepare(
        `SELECT id FROM production_options WHERE kind = 'bead_supplier' AND value = ? AND active = 1`
      ).bind(grp).first<{ id: string }>();
      if (!supplier) {
        return NextResponse.json({ ok: false, error: "Unknown supplier." }, { status: 400 });
      }
    }

    const dup = await DB.prepare(
      `SELECT value FROM production_options WHERE kind = ? AND grp = ? AND LOWER(value) = LOWER(?)`
    ).bind(kind, grp, value).first<{ value: string }>();
    if (dup) {
      return NextResponse.json({ ok: false, error: "option_exists", value: dup.value }, { status: 409 });
    }

    const maxSort = await DB.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM production_options WHERE kind = ? AND grp = ?`
    ).bind(kind, grp).first<{ max_sort: number }>();

    const id = crypto.randomUUID();
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);

    await DB.prepare(
      `INSERT INTO production_options (id, kind, grp, value, active, sort_order, created_by, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
    ).bind(id, kind, grp, value, (maxSort?.max_sort || 0) + 1, actorId, ts).run();

    await logActivity(
      DB, "create", "production_option", id,
      `${actorName || actorId} added a Production option (${kind}: ${value})`,
      { option_id: id, kind, grp, value }, actorId
    );

    return NextResponse.json({ ok: true, id, value }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const { DB } = await getEnv();
  const canManage = request.headers.get("X-User-Can-Manage-Production") === "1";
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canManage) return NextResponse.json({ ok: false, error: "Manager access required." }, { status: 403 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { id, active } = body ?? {};
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });

  try {
    const result = await DB.prepare(
      `UPDATE production_options SET active = ? WHERE id = ?`
    ).bind(active ? 1 : 0, id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

    await logActivity(
      DB, "update", "production_option", id,
      `${actorName || actorId} ${active ? "restored" : "retired"} a Production option`,
      { option_id: id, active: !!active }, actorId
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
