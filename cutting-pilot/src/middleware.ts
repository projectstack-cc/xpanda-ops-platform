// src/middleware.ts
// The strangler gate for the v2 surface. Runs on every /v2/* request,
// reads the shared xpanda_session cookie, validates against the shared D1, and enforces
// manufacturing.cutting. Mirrors the legacy session gate in _worker.js/index.js.
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
import { validateSession, hasPermission } from "@/lib/session";

const PERMISSION_KEY = "manufacturing.cutting";

export const config = {
  matcher: ["/v2/:path*"],
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

  const user = await validateSession(db, request.headers.get("Cookie"));

  if (!user) {
    if (isApi) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login.html", url.origin));
  }

  const action = request.method === "GET" || request.method === "HEAD" ? "view" : "edit";
  if (!hasPermission(user, PERMISSION_KEY, action)) {
    if (isApi) return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
    return NextResponse.redirect(new URL("/?access_denied=1", url.origin));
  }

  const headers = new Headers(request.headers);
  headers.set("X-User-Id", String(user.userId));
  headers.set("X-User-Role", user.role);
  headers.set("X-User-Name", user.displayName || user.username);
  headers.set("X-User-Is-Admin", user.isAdministrator ? "1" : "0");

  return NextResponse.next({ request: { headers } });
}
