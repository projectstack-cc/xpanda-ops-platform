// src/app/api/admin/users/route.ts  ->  GET/POST /v2/api/admin/users (admin-02)
// Port of legacy handleApiUsers GET/POST (_worker.js/routes/admin.js). Deltas: role_ids required (≥1),
// user + user_roles rows written in one batch, booleans out as booleans, POST logs activity.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { requireRealAdmin } from "@/lib/admin/guard";
import { SHIFTS, legacyRoleFor, parseRoleIds, type AdminUser } from "@/lib/admin/types";

export async function GET(request: NextRequest) {
  const denied = requireRealAdmin(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  try {
    const [userRows, assignRows] = await DB.batch([
      DB.prepare(
        "SELECT id, username, display_name, password, shift, is_active, first_login, created_at, updated_at FROM users ORDER BY username COLLATE NOCASE"
      ),
      DB.prepare("SELECT ur.user_id, ur.role_id, r.name AS role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id"),
    ]);
    const byUser: Record<string, { role_id: string; role_name: string }[]> = {};
    for (const a of (assignRows.results || []) as any[]) {
      (byUser[a.user_id] ||= []).push({ role_id: a.role_id, role_name: a.role_name });
    }
    const users: AdminUser[] = ((userRows.results || []) as any[]).map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      password: u.password,
      shift: SHIFTS.includes(u.shift) ? u.shift : null,
      is_active: u.is_active === 1,
      first_login: u.first_login === 1,
      created_at: u.created_at,
      updated_at: u.updated_at ?? null,
      roles: byUser[u.id] || [],
    }));
    return NextResponse.json({ ok: true, users });
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
  const username = String(body?.username || "").trim().toLowerCase();
  const displayName = String(body?.display_name || "").trim();
  const password = String(body?.password || "") || username;
  const roleIds = parseRoleIds(body?.role_ids);
  const shift = SHIFTS.includes(body?.shift) ? body.shift : null;

  if (!username) return NextResponse.json({ ok: false, error: "Username required." }, { status: 400 });
  if (!displayName) return NextResponse.json({ ok: false, error: "Display name required." }, { status: 400 });
  if (!roleIds) return NextResponse.json({ ok: false, error: "At least one role is required." }, { status: 400 });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const legacy = legacyRoleFor(roleIds);
  try {
    await DB.batch([
      DB.prepare(
        `INSERT INTO users (id, username, display_name, password, role, role_id, shift, is_active, first_login, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
      ).bind(id, username, displayName, password, legacy.role, legacy.roleId, shift, now, now),
      ...roleIds.map((rid) => DB.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(id, rid)),
    ]);
  } catch (e) {
    const msg = String((e as any)?.message || e);
    if (msg.includes("UNIQUE")) return NextResponse.json({ ok: false, error: "Username already exists." }, { status: 409 });
    if (msg.includes("FOREIGN KEY")) return NextResponse.json({ ok: false, error: "Unknown role.", detail: msg }, { status: 400 });
    return NextResponse.json({ ok: false, error: "Server error.", detail: msg }, { status: 500 });
  }
  await logActivity(DB, "create", "user", id, `Created user "${username}"`,
    { username, display_name: displayName, role_ids: roleIds, shift }, request.headers.get("X-User-Id") || null);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
