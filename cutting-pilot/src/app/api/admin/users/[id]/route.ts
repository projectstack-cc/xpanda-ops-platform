// src/app/api/admin/users/[id]/route.ts  ->  PATCH/DELETE /v2/api/admin/users/:id (admin-02)
// Port of legacy handleApiUsers PUT/DELETE (_worker.js/routes/admin.js). Deltas: PATCH (not PUT), role
// replacement + user update in one batch, self-disable blocked, PATCH logs activity.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { requireRealAdmin } from "@/lib/admin/guard";
import { SHIFTS, legacyRoleFor, parseRoleIds } from "@/lib/admin/types";

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
  const actorId = request.headers.get("X-User-Id") || null;

  const fields: string[] = [];
  const binds: unknown[] = [];
  let roleIds: string[] | null = null;

  if (body.display_name !== undefined) {
    const dn = String(body.display_name).trim();
    if (!dn) return NextResponse.json({ ok: false, error: "Display name required." }, { status: 400 });
    fields.push("display_name = ?"); binds.push(dn);
  }
  if (body.role_ids !== undefined) {
    roleIds = parseRoleIds(body.role_ids);
    if (!roleIds) return NextResponse.json({ ok: false, error: "At least one role is required." }, { status: 400 });
    const legacy = legacyRoleFor(roleIds);
    fields.push("role_id = ?"); binds.push(legacy.roleId);
    fields.push("role = ?"); binds.push(legacy.role);
  }
  if (body.shift !== undefined) {
    fields.push("shift = ?"); binds.push(SHIFTS.includes(body.shift) ? body.shift : null);
  }
  if (body.is_active !== undefined) {
    if (!body.is_active && id === actorId) {
      return NextResponse.json({ ok: false, error: "You can't disable your own account." }, { status: 400 });
    }
    fields.push("is_active = ?"); binds.push(body.is_active ? 1 : 0);
  }
  if (body.first_login !== undefined) {
    fields.push("first_login = ?"); binds.push(body.first_login ? 1 : 0);
  }
  if (typeof body.password === "string" && body.password.length >= 1) {
    fields.push("password = ?"); binds.push(body.password);
  }
  if (fields.length === 0) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });

  const target = await DB.prepare("SELECT username FROM users WHERE id = ?").bind(id).first<{ username: string }>();
  if (!target) return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });

  fields.push("updated_at = ?"); binds.push(new Date().toISOString());
  const stmts = [];
  if (roleIds) {
    stmts.push(DB.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(id));
    for (const rid of roleIds) {
      stmts.push(DB.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(id, rid));
    }
  }
  // Column names come from the fixed list above; every value is bound.
  stmts.push(DB.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).bind(...binds, id));
  try {
    await DB.batch(stmts);
  } catch (e) {
    const msg = String((e as any)?.message || e);
    if (msg.includes("FOREIGN KEY")) return NextResponse.json({ ok: false, error: "Unknown role.", detail: msg }, { status: 400 });
    return NextResponse.json({ ok: false, error: "Server error.", detail: msg }, { status: 500 });
  }

  // Never log the password value itself — only that it changed.
  const changed = Object.keys(body).filter((k) =>
    ["display_name", "role_ids", "shift", "is_active", "first_login", "password"].includes(k));
  await logActivity(DB, "update", "user", id, `Updated user "${target.username}"`,
    { fields: changed, role_ids: roleIds ?? undefined }, actorId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireRealAdmin(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  const id = params.id;
  const actorId = request.headers.get("X-User-Id") || null;
  if (id === actorId) return NextResponse.json({ ok: false, error: "Cannot delete your own account." }, { status: 400 });

  const target = await DB.prepare("SELECT username FROM users WHERE id = ?").bind(id).first<{ username: string }>();
  if (!target) return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });

  try {
    // D1 enforces FKs and none cascade — clear every child row first (legacy order), atomically.
    await DB.batch([
      DB.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(id),
      DB.prepare("DELETE FROM notifications WHERE user_id = ?").bind(id),
      DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(id),
      DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
      DB.prepare("DELETE FROM users WHERE id = ?").bind(id),
    ]);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String((e as any)?.message || e) }, { status: 500 });
  }
  await logActivity(DB, "delete", "user", id, `Deleted user "${target.username}"`, { username: target.username }, actorId);
  return NextResponse.json({ ok: true });
}
