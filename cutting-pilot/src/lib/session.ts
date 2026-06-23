// src/lib/session.ts
// Auth bridge: re-implements the legacy worker's validateSession() against the SAME
// D1 tables (sessions / users / user_roles / roles). This Worker only READS the session
// row — login + cookie issuance stay entirely on the legacy app. The session row in D1
// is the shared state; no token exchange, no shared secret.
//
// Ported 1:1 from _worker.js/lib/core.js validateSession() so behavior (multi-role merge,
// admin detection, role simulation) stays identical. Keep in sync if the legacy logic changes.

import type { D1Database } from "@cloudflare/workers-types";

export interface SessionUser {
  userId: string;
  username: string;
  displayName: string;
  role: string;
  roleIds: string[];
  roleNames: string[];
  firstLogin: boolean;
  sessionId: string;
  isAdministrator: boolean;
  isRealAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
  simulatingRole: { id: string; name: string } | null;
}

export function getSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)xpanda_session=([^;]+)/);
  return m ? m[1] : null;
}

export async function validateSession(
  db: D1Database,
  cookieHeader: string | null
): Promise<SessionUser | null> {
  const token = getSessionToken(cookieHeader);
  if (!token) return null;

  try {
    const session = await db
      .prepare(
        `SELECT s.id, s.user_id, s.expires_at, s.simulating_role_id,
                u.id as uid, u.username, u.display_name, u.role, u.role_id, u.is_active, u.first_login
         FROM sessions s JOIN users u ON s.user_id = u.id
         WHERE s.id = ?`
      )
      .bind(token)
      .first<any>();

    if (!session || !session.is_active) return null;
    if (new Date(session.expires_at) < new Date()) {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
      return null;
    }

    const roleRows = await db
      .prepare(
        `SELECT r.id, r.name, r.permissions
         FROM user_roles ur JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = ?`
      )
      .bind(session.uid)
      .all<any>();

    const userRoles = roleRows.results || [];
    const isRealAdmin =
      userRoles.some((r) => r.id === "role-administrator") || session.role === "admin";

    const merged: Record<string, { view: boolean; edit: boolean }> = {};
    const mergeInto = (permsJson: string) => {
      let perms: any = {};
      try { perms = JSON.parse(permsJson || "{}"); } catch {}
      for (const [key, val] of Object.entries<any>(perms)) {
        if (!merged[key]) merged[key] = { view: false, edit: false };
        if (val.view) merged[key].view = true;
        if (val.edit) merged[key].edit = true;
      }
    };
    for (const role of userRoles) mergeInto(role.permissions);

    if (userRoles.length === 0 && session.role_id) {
      const fb = await db.prepare("SELECT * FROM roles WHERE id = ?").bind(session.role_id).first<any>();
      if (fb) { mergeInto(fb.permissions); userRoles.push(fb); }
    }

    let simulatingRole: { id: string; name: string } | null = null;
    let effectivePermissions = merged;
    let effectiveRole = userRoles.map((r) => r.name).join(", ") || session.role || "staff";

    if (isRealAdmin && session.simulating_role_id) {
      const sim = await db
        .prepare("SELECT id, name, permissions FROM roles WHERE id = ?")
        .bind(session.simulating_role_id)
        .first<any>();
      if (sim) {
        simulatingRole = { id: sim.id, name: sim.name };
        effectiveRole = sim.name;
        try { effectivePermissions = JSON.parse(sim.permissions || "{}"); } catch { effectivePermissions = {}; }
      }
    }

    const isSimulating = simulatingRole !== null;
    return {
      userId: session.uid,
      username: session.username,
      displayName: session.display_name,
      role: effectiveRole,
      roleIds: userRoles.map((r) => r.id),
      roleNames: userRoles.map((r) => r.name),
      firstLogin: session.first_login === 1,
      sessionId: session.id,
      isAdministrator: isRealAdmin && !isSimulating,
      isRealAdmin,
      permissions: effectivePermissions,
      simulatingRole,
    };
  } catch (e) {
    console.error("Session validation failed:", e);
    return null;
  }
}

// Mirror of core.js hasPermission(). admin bypasses; GET→view, mutate→edit.
export function hasPermission(
  user: SessionUser,
  permKey: string | null,
  action: "view" | "edit"
): boolean {
  if (user.isAdministrator) return true;
  if (!permKey) return true;
  const perm = user.permissions[permKey];
  if (!perm) return false;
  return action === "view" ? perm.view === true : perm.edit === true;
}
