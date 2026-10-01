// src/app/api/qb/connection/route.ts  →  /v2/api/qb/connection
// qb-01: admin-only QuickBooks connection status. Never returns token values.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { getQbEnv, getConnection } from "@/lib/qb/client";

export async function GET(request: NextRequest) {
  if (request.headers.get("X-User-Is-Admin") !== "1") {
    return NextResponse.json({ ok: false, error: "Admin only." }, { status: 403 });
  }
  try {
    const { DB } = await getEnv();
    const qb = await getQbEnv();
    const realmId = qb.QB_REALM_ID || "";
    const conn = realmId ? await getConnection(DB, realmId) : null;
    const expiresAt = conn?.token_expires_at ?? null;
    const t = expiresAt ? new Date(expiresAt).getTime() : NaN;
    return NextResponse.json({
      ok: true,
      connected: !!conn,
      realm_id: conn?.realm_id ?? (realmId || null),
      token_expires_at: expiresAt,
      expired: conn ? !(Number.isFinite(t) && Date.now() < t) : null,
      env: qb.QB_ENV ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
