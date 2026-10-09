// src/app/api/admin/roles/[id]/route.ts  ->  PATCH/DELETE /v2/api/admin/roles/:id (admin-02)
// Port of legacy handleApiRoles PUT/DELETE (_worker.js/routes/admin.js). Deltas: id in the path, real-admin
// gate, input validation, delete guard checks BOTH user_roles and legacy users.role_id, actor logged.
// permissions are stored VERBATIM (JSON.stringify of the body) -- never filter or normalise keys here:
// admin-01's no-access-change guarantee depends on a save never dropping a key this UI doesn't know.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { requireRealAdmin } from "@/lib/admin/guard";
import { ROLE_SELECT, toAdminRole } from "@/lib/admin/types";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
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
  if (!body || typeof body !== "object") body = {};
  const id = params.id;

  const existing = await DB.prepare("SELECT id, name FROM roles WHERE id = ?").bind(id).first<{ id: string; name: string }>();
  if (!existing) return NextResponse.json({ ok: false, error: "Role not found." }, { status: 404 });

  const fields: string[] = [];
  const binds: unknown[] = [];
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (id === "role-administrator" && name !== existing.name) {
      return NextResponse.json({ ok: false, error: "Cannot rename the Administrator role." }, { status: 400 });
    }
    if (name.length < 2) return NextResponse.json({ ok: false, error: "Role name must be at least 2 characters." }, { status: 400 });
    fields.push("name = ?"); binds.push(name);
  }
  if (body.description !== undefined) {
    fields.push("description = ?"); binds.push(String(body.description ?? "").trim());
  }
  if (body.permissions !== undefined) {
    const p = body.permissions;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      return NextResponse.json({ ok: false, error: "permissions must be an object." }, { status: 400 });
    }
    fields.push("permissions = ?"); binds.push(JSON.stringify(p));
  }
  if (body.notification_types !== undefined) {
    const n = body.notification_types;
    if (!Array.isArray(n) || n.some((x: unknown) => typeof x !== "string")) {
      return NextResponse.json({ ok: false, error: "notification_types must be an array of strings." }, { status: 400 });
    }
    fields.push("notification_types = ?"); binds.push(JSON.stringify(n));
  }
  if (fields.length === 0) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });

  fields.push("updated_at = ?"); binds.push(new Date().toISOString());
  try {
    // Column names come from the fixed list above; every value is bound.
    await DB.prepare(`UPDATE roles SET ${fields.join(", ")} WHERE id = ?`).bind(...binds, id).run();
  } catch (e) {
    const msg = String((e as any)?.message || e);
    if (/unique/i.test(msg)) return NextResponse.json({ ok: false, error: "Role name already exists." }, { status: 409 });
    return NextResponse.json({ ok: false, error: "Server error.", detail: msg }, { status: 500 });
  }
  const row = await DB.prepare(`${ROLE_SELECT} WHERE r.id = ? GROUP BY r.id`).bind(id).first();
  const role = toAdminRole(row);
  await logActivity(DB, "update", "role", id, `Updated role "${role.name}"`,
    { fields: Object.keys(body).filter((k) => ["name", "description", "permissions", "notification_types"].includes(k)) },
    request.headers.get("X-User-Id") || null);
  return NextResponse.json({ ok: true, role });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireRealAdmin(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  const id = params.id;
  const existing = await DB.prepare("SELECT id, name, is_system FROM roles WHERE id = ?").bind(id)
    .first<{ id: string; name: string; is_system: number }>();
  if (!existing) return NextResponse.json({ ok: false, error: "Role not found." }, { status: 404 });
  if (existing.is_system) {
    return NextResponse.json({ ok: false, error: "Cannot delete a system role. Edit its permissions instead." }, { status: 400 });
  }

  // Legacy checked only users.role_id; a user_roles-only member would then hit an FK 500 on delete.
  const members = await DB.prepare(
    `SELECT COUNT(*) AS cnt FROM (
       SELECT user_id FROM user_roles WHERE role_id = ?
       UNION
       SELECT id FROM users WHERE role_id = ?
     )`
  ).bind(id, id).first<{ cnt: number }>();
  const n = Number(members?.cnt ?? 0);
  if (n > 0) {
    return NextResponse.json(
      { ok: false, error: `Cannot delete role — ${n} user(s) are assigned to it. Reassign them first.` },
      { status: 400 }
    );
  }

  try {
    await DB.prepare("DELETE FROM roles WHERE id = ?").bind(id).run();
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String((e as any)?.message || e) }, { status: 500 });
  }
  await logActivity(DB, "delete", "role", id, `Deleted role "${existing.name}"`, { name: existing.name },
    request.headers.get("X-User-Id") || null);
  return NextResponse.json({ ok: true });
}
