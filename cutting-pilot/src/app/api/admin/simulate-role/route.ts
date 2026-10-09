// src/app/api/admin/simulate-role/route.ts  ->  POST/DELETE /v2/api/admin/simulate-role (admin-02)
// Port of legacy handleSimulateRoleStart/Stop (_worker.js/routes/auth.js). Delta: POST body key is
// `role_id` (legacy: `roleId`). The session id comes from the shared session cookie, never the body.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { requireRealAdmin } from "@/lib/admin/guard";
import { validateSession } from "@/lib/session";

async function sessionFor(request: NextRequest, DB: any) {
  try {
    return await validateSession(DB, request.headers.get("cookie"));
  } catch {
    return null;
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
  const roleId = String(body?.role_id || "").trim();
  if (!roleId) return NextResponse.json({ ok: false, error: "role_id is required." }, { status: 400 });
  if (roleId === "role-administrator") {
    return NextResponse.json({ ok: false, error: "Cannot simulate the administrator role." }, { status: 400 });
  }

  const role = await DB.prepare("SELECT id, name FROM roles WHERE id = ?").bind(roleId).first<{ id: string; name: string }>();
  if (!role) return NextResponse.json({ ok: false, error: "Role not found." }, { status: 404 });

  const user = await sessionFor(request, DB);
  if (!user || !user.isRealAdmin) return NextResponse.json({ ok: false, error: "Administrators only." }, { status: 403 });

  await DB.prepare("UPDATE sessions SET simulating_role_id = ? WHERE id = ?").bind(roleId, user.sessionId).run();
  await logActivity(DB, "simulate_role_start", "session", user.sessionId, `Testing as: ${role.name}`,
    { simulatedRoleId: roleId, simulatedRoleName: role.name }, user.userId);
  return NextResponse.json({ ok: true, simulatingRole: { id: role.id, name: role.name } });
}

export async function DELETE(request: NextRequest) {
  const denied = requireRealAdmin(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  const user = await sessionFor(request, DB);
  if (!user || !user.isRealAdmin) return NextResponse.json({ ok: false, error: "Administrators only." }, { status: 403 });

  await DB.prepare("UPDATE sessions SET simulating_role_id = NULL WHERE id = ?").bind(user.sessionId).run();
  await logActivity(DB, "simulate_role_stop", "session", user.sessionId, "Stopped role simulation", {}, user.userId);
  return NextResponse.json({ ok: true });
}
