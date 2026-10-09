// src/app/api/admin/roles/route.ts  ->  GET/POST /v2/api/admin/roles (admin-02)
// Port of legacy handleApiRoles GET/POST (_worker.js/routes/admin.js). Deltas: real-admin gate,
// member_count via user_roles (legacy counted only users.role_id), permissions seeded server-side from
// lib/permissions.ts (legacy seeded client-side), permissions/notification_types returned parsed.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { requireRealAdmin } from "@/lib/admin/guard";
import { PERMISSION_LABELS } from "@/lib/permissions";
import { ROLE_SELECT, toAdminRole, type PermissionMap } from "@/lib/admin/types";

export async function GET(request: NextRequest) {
  const denied = requireRealAdmin(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  try {
    const rows = await DB.prepare(`${ROLE_SELECT} GROUP BY r.id ORDER BY r.is_system DESC, r.name ASC`).all();
    return NextResponse.json({ ok: true, roles: (rows.results || []).map(toAdminRole) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String((e as any)?.message || e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = requireRealAdmin(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const name = String(body?.name || "").trim();
  const description = String(body?.description || "").trim();
  if (!name) return NextResponse.json({ ok: false, error: "Role name is required." }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ ok: false, error: "Role name must be at least 2 characters." }, { status: 400 });

  const permissions: PermissionMap = {};
  for (const key of Object.keys(PERMISSION_LABELS)) permissions[key] = { view: false, edit: false };

  const id = "role-" + crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await DB.prepare(
      `INSERT INTO roles (id, name, description, permissions, notification_types, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', 0, ?, ?)`
    ).bind(id, name, description, JSON.stringify(permissions), now, now).run();
  } catch (e) {
    const msg = String((e as any)?.message || e);
    if (/unique/i.test(msg)) return NextResponse.json({ ok: false, error: "Role name already exists." }, { status: 409 });
    return NextResponse.json({ ok: false, error: "Server error.", detail: msg }, { status: 500 });
  }
  await logActivity(DB, "create", "role", id, `Created role "${name}"`, { name, description },
    request.headers.get("X-User-Id") || null);
  const row = await DB.prepare(`${ROLE_SELECT} WHERE r.id = ? GROUP BY r.id`).bind(id).first();
  return NextResponse.json({ ok: true, role: toAdminRole(row) }, { status: 201 });
}
