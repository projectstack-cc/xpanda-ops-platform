// src/lib/admin/guard.ts — admin-02
import { NextResponse, type NextRequest } from "next/server";
/** Defense-in-depth behind the middleware gate: Users, Roles, Stats and simulation are real-admin only
 *  (legacy handleApiUsers / handleSimulateRole* self-check isRealAdmin). Header is set by middleware on
 *  every request (never trusted from the client — middleware overwrites it). */
export function requireRealAdmin(request: NextRequest): NextResponse | null {
  return request.headers.get("X-User-Is-Real-Admin") === "1"
    ? null
    : NextResponse.json({ ok: false, error: "Administrators only." }, { status: 403 });
}
