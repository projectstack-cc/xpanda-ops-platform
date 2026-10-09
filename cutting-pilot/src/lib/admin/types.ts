// src/lib/admin/types.ts — admin-02. Contract between /v2/api/admin/* and the /v2/admin UI (admin-03/04/05).
import { hasPermission, type SessionUser } from "@/lib/session";

export type PermFlags = { view: boolean; edit: boolean };
export type PermissionMap = Record<string, PermFlags>;

export interface AdminUser {
  id: string; username: string; display_name: string; password: string;
  shift: "1st" | "2nd" | "3rd" | null; is_active: boolean; first_login: boolean;
  created_at: string; updated_at: string | null;
  roles: { role_id: string; role_name: string }[];
}
export interface AdminRole {
  id: string; name: string; description: string; is_system: boolean;
  permissions: PermissionMap; notification_types: string[]; member_count: number;
}
export interface ActivityEntry {
  id: string; timestamp: string; action: string; entity_type: string; entity_id: string;
  summary: string | null; detail: unknown; user_id: string | null; user_name: string | null;
}
export interface ActivityFacets { actions: string[]; entity_types: string[]; users: { id: string; name: string }[]; }
export type ActivityRange = "24h" | "7d" | "30d" | "all";
export interface AdminStats {
  users_active: number; users_total: number; roles: number;
  users_without_role: number; activity_24h: number; activity_7d: number;
}
export type AdminTab = "users" | "roles" | "parts" | "activity";
export interface AdminAccess {
  users: boolean; roles: boolean; parts: boolean; activity: boolean;
  isRealAdmin: boolean; simulatingRole: { id: string; name: string } | null;
}

/** Per-tab access for /v2/admin. Mirrors legacy: /api/users + /api/roles self-check isRealAdmin;
 *  /api/activity-log is gated on `admin`; /api/parts on `manufacturing.calculators`. isRealAdmin (not
 *  isAdministrator) so an admin who is testing as a role keeps the Users/Roles tabs and can stop. */
export function computeAdminAccess(s: SessionUser): AdminAccess {
  const real = s.isRealAdmin;
  return {
    users: real,
    roles: real,
    activity: real || hasPermission(s, "admin", "view"),
    parts: real || hasPermission(s, "manufacturing.calculators", "view"),
    isRealAdmin: real,
    simulatingRole: s.simulatingRole,
  };
}

// Shared by users/route.ts and users/[id]/route.ts (route files may only export handlers).
export const SHIFTS: readonly string[] = ["1st", "2nd", "3rd"];

/** Legacy users.role / users.role_id columns, derived from the first role exactly as legacy does. */
export function legacyRoleFor(roleIds: string[]): { role: string; roleId: string } {
  const roleId = roleIds[0] || "role-staff";
  const role = roleId === "role-administrator" ? "admin" : roleId === "role-readonly" ? "readonly" : "staff";
  return { role, roleId };
}

export function parseRoleIds(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const ids = Array.from(new Set(v.map((x) => String(x || "").trim()).filter(Boolean)));
  return ids.length ? ids : null;
}

/** Shared by roles/route.ts and roles/[id]/route.ts. member_count counts user_roles (multi-role aware). */
export const ROLE_SELECT =
  `SELECT r.id, r.name, r.description, r.is_system, r.permissions, r.notification_types,
          COUNT(DISTINCT ur.user_id) AS member_count
     FROM roles r LEFT JOIN user_roles ur ON ur.role_id = r.id`;

export function toAdminRole(r: any): AdminRole {
  let permissions: PermissionMap = {};
  try {
    const p = JSON.parse(r.permissions || "{}");
    if (p && typeof p === "object" && !Array.isArray(p)) permissions = p;
  } catch {}
  let notification_types: string[] = [];
  try {
    const n = JSON.parse(r.notification_types || "[]");
    if (Array.isArray(n)) notification_types = n.map(String);
  } catch {}
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    is_system: r.is_system === 1,
    permissions,
    notification_types,
    member_count: Number(r.member_count ?? 0),
  };
}
