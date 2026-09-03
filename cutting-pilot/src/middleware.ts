// src/middleware.ts
// The strangler gate for the v2 surface. Runs on every /v2/* request,
// reads the shared xpanda_session cookie, validates against the shared D1, and enforces
// a per-path permission key (mirrors the legacy PATH_PERMISSION_MAP/API_PERMISSION_MAP in
// _worker.js/lib/core.js — one permission key per feature, not one blanket key for all of /v2).
//
// In production (workerd): getCloudflareContext() returns real D1/R2 bindings.
// In `next dev`: the edge runtime can't load wrangler via dynamic import, so the
// try/catch passes through — auth is validated at the Worker layer, not next dev.
//
// Unauthenticated page  → redirect to the LEGACY login (cross-app, same host).
// Unauthenticated API   → 401. Forbidden → 403 (api) / legacy home (page).
// On success, injects X-User-* headers so route handlers/pages read identity cheaply,
// exactly like the legacy worker does.

import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { validateSession, hasPermission, SessionLookupError } from "@/lib/session";

// First matching prefix wins. A path with no match falls through with no permission gate
// (still session-gated above) — same as an un-mapped path in the legacy PATH_PERMISSION_MAP.
const PERMISSION_MAP: Array<{ prefix: string; keys: string[] }> = [
  // Both schedule views read the same data API — EITHER key grants read access.
  { prefix: "/v2/api/schedule-board", keys: ["schedule", "schedule.desk"] },
  // Desk page must come BEFORE the general /v2/schedule prefix (first match wins).
  { prefix: "/v2/schedule/desk", keys: ["schedule.desk"] },
  { prefix: "/v2/schedule", keys: ["schedule"] },
  { prefix: "/v2/api/loading-board", keys: ["logistics.loading.tv"] },
  { prefix: "/v2/loading", keys: ["logistics.loading.tv"] },
  { prefix: "/v2/api/cutting/manage", keys: ["manufacturing.cutting.manage"] },
  { prefix: "/v2/api/cutting/kick", keys: ["manufacturing.cutting.override"] },
  { prefix: "/v2/api/cutting", keys: ["manufacturing.cutting"] },
  { prefix: "/v2/cutting", keys: ["manufacturing.cutting"] },
  { prefix: "/v2/api/board", keys: ["jobs"] },
  { prefix: "/v2/board", keys: ["jobs"] },
  { prefix: "/v2/api/orders", keys: ["orders"] },
  { prefix: "/v2/orders", keys: ["orders"] },
  { prefix: "/v2/api/notes/mark-viewed", keys: ["notes.manage"] },
  { prefix: "/v2/api/notes", keys: ["notes"] },
  { prefix: "/v2/notes", keys: ["notes"] },
  { prefix: "/v2/api/blocks", keys: ["manufacturing.blocks"] },
  { prefix: "/v2/blocks", keys: ["manufacturing.blocks"] },
  { prefix: "/v2/api/carrier", keys: ["logistics.carrier_view"] },
  { prefix: "/v2/carrier", keys: ["logistics.carrier_view"] },
  { prefix: "/v2/api/production", keys: ["production.log"] },
  { prefix: "/v2/production", keys: ["production.log"] },
];

function permissionKeysFor(pathname: string): string[] | null {
  return PERMISSION_MAP.find((m) => pathname.startsWith(m.prefix))?.keys ?? null;
}

export const config = {
  // basePath: "/v2" in next.config.mjs prepends /v2 to every matcher automatically.
  // Do NOT include /v2 here — that would compile to /v2/v2/... (double-prefix).
  // Negative lookahead excludes _next/static, _next/image, and favicon from the auth gate.
  // This already covers /v2/api/schedule-board and /v2/schedule — no change needed here.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export async function middleware(request: NextRequest) {
  let db: any;
  try {
    const { env } = await getCloudflareContext();
    db = (env as any).DB;
  } catch {
    // next dev: edge runtime can't load wrangler — pass through for local dev.
    return NextResponse.next();
  }

  const url = new URL(request.url);
  const isApi = url.pathname.startsWith("/v2/api/");

  if (!db) {
    return isApi
      ? NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 })
      : new NextResponse("Missing D1 binding", { status: 500 });
  }

  let user;
  try {
    user = await validateSession(db, request.headers.get("Cookie"));
  } catch (e) {
    if (e instanceof SessionLookupError) {
      const body = { ok: false, error: "session_unavailable", transient: true };
      return isApi
        ? NextResponse.json(body, { status: 503, headers: { "Retry-After": "2", "Cache-Control": "no-store" } })
        : new NextResponse("Session temporarily unavailable, please retry.", {
            status: 503,
            headers: { "Retry-After": "2", "Cache-Control": "no-store" },
          });
    }
    throw e;
  }

  if (!user) {
    if (isApi) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login.html", url.origin));
  }

  const action = request.method === "GET" || request.method === "HEAD" ? "view" : "edit";
  // Unmapped path (null) stays ungated as before; a mapped path passes if the user holds ANY of its keys.
  const requiredKeys = permissionKeysFor(url.pathname);
  const permitted = requiredKeys === null || requiredKeys.some((k) => hasPermission(user, k, action));
  if (!permitted) {
    if (isApi) return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
    return NextResponse.redirect(new URL("/?access_denied=1", url.origin));
  }

  const headers = new Headers(request.headers);
  headers.set("X-User-Id", String(user.userId));
  headers.set("X-User-Role", user.role);
  headers.set("X-User-Name", user.displayName || user.username);
  headers.set("X-User-Is-Admin", user.isAdministrator ? "1" : "0");
  headers.set(
    "X-User-Can-Manage-Cutting",
    hasPermission(user, "manufacturing.cutting.manage", "edit") ? "1" : "0"
  );
  headers.set(
    "X-User-Can-Override-Cutting",
    hasPermission(user, "manufacturing.cutting.override", "edit") ? "1" : "0"
  );
  headers.set(
    "X-User-Can-Manage-Notes",
    hasPermission(user, "notes.manage", "edit") ? "1" : "0"
  );
  // P439 — JSON blob of the user's merged role permissions, so legacy endpoints (e.g.
  // /api/jobs/:id/assignments, /api/jobs/:id/shifts) and the new v2 /v2/api/orders/:id/shifts
  // route can gate manager-only writes on the same blob the legacy worker already trusts.
  // Value is "{}" if the user has no role permissions (e.g. legacy `role` TEXT-column row with
  // no roles.id assignment); consumers must JSON.parse it defensively.
  headers.set("X-User-Permissions", JSON.stringify(user.permissions || {}));

  return NextResponse.next({ request: { headers } });
}
