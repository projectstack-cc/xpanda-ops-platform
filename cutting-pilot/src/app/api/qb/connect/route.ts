// src/app/api/qb/connect/route.ts  →  /v2/api/qb/connect
// qb-01: admin-only manual token seed (OAuth Playground tokens) until qb-04's OAuth callback.
// realm_id must equal the QB_REALM_ID secret. Tokens are encrypted at rest and never echoed.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { getQbEnv, qbMode, saveConnection } from "@/lib/qb/client";
import { logActivity } from "@/lib/activityLog";

export async function POST(request: NextRequest) {
  if (request.headers.get("X-User-Is-Admin") !== "1") {
    return NextResponse.json({ ok: false, error: "Admin only." }, { status: 403 });
  }
  const actorId = request.headers.get("X-User-Id") || null;
  const actorName = request.headers.get("X-User-Name") || "Someone";

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  try {
    const { DB } = await getEnv();
    const qb = await getQbEnv();
    const env = qbMode(qb);
    const realmId = String(body?.realm_id ?? "").trim();
    const accessToken = String(body?.access_token ?? "");
    const refreshToken = String(body?.refresh_token ?? "");
    const expiresIn = Number.isFinite(Number(body?.expires_in)) && Number(body?.expires_in) > 0 ? Number(body.expires_in) : 3600;
    if (!accessToken || !refreshToken || !realmId) {
      return NextResponse.json({ ok: false, error: "access_token, refresh_token and realm_id are required." }, { status: 400 });
    }
    if (!qb.QB_REALM_ID || realmId !== qb.QB_REALM_ID) {
      return NextResponse.json({ ok: false, error: "realm_id does not match the configured QB_REALM_ID." }, { status: 400 });
    }
    const { token_expires_at } = await saveConnection(DB, qb, { realmId, accessToken, refreshToken, expiresIn });
    await logActivity(DB, "create", "qb_connection", realmId, `QB connection seeded by ${actorName}`, { env }, actorId);
    return NextResponse.json({ ok: true, realm_id: realmId, token_expires_at });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
