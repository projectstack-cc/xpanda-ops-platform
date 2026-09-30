// src/lib/logistics/dashboardPerms.ts
// lgx-fuel-01: hoisted verbatim from app/api/shipments/[id]/route.ts so the fuel-surcharge route can
// share it. Admin bypass first, then the granular logistics.dashboard edit permission.
import type { NextRequest } from "next/server";

export function canEditDashboard(request: NextRequest): boolean {
  if (request.headers.get("X-User-Is-Admin") === "1") return true;
  let perms: any = {};
  try {
    perms = JSON.parse(request.headers.get("X-User-Permissions") || "{}");
  } catch {
    // fall through to false
  }
  return !!perms["logistics.dashboard"]?.edit;
}
