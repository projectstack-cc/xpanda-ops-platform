// src/app/api/qb/webhook/route.ts  →  POST /v2/api/qb/webhook
// qb-02: Intuit CloudEvents webhook — the ONLY unauthenticated route on the v2 Worker (middleware
// bypasses the session gate for this exact path + POST). Authenticity comes solely from the
// intuit-signature HMAC, verified fail-closed against the raw body before anything is parsed.
//
// SECURITY: never read X-User-* headers here — with the gate bypassed they are client-controlled.
// A valid request returns 200 immediately; all processing runs in ctx.waitUntil (Intuit expects a
// fast ack and does not retry once it gets 200 — see BACKLOG qb-05 CDC sweep).
import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { logActivity } from "@/lib/activityLog";
import { getQbEnv } from "@/lib/qb/client";
import { verifyIntuitSignature } from "@/lib/qb/webhook";
import { processWebhook } from "@/lib/qb/process";

export async function POST(request: NextRequest) {
  // 1. Raw body first — the signature is over these exact bytes.
  const raw = await request.text();
  const signature = request.headers.get("intuit-signature");
  const ip = request.headers.get("cf-connecting-ip") || "";

  const { env, ctx } = await getCloudflareContext();
  const DB = (env as any).DB;
  const qb = await getQbEnv();

  const valid = await verifyIntuitSignature(raw, signature, qb.QB_WEBHOOK_VERIFIER);
  if (!valid) {
    // RT-07: record the rejection off the response path; write nothing else.
    ctx.waitUntil(
      logActivity(DB, "reject", "qb_webhook", "-", "QB webhook rejected: bad signature", { ip, len: raw.length }, null)
    );
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const pushEnv = { VAPID_PUBLIC_KEY: (env as any).VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: (env as any).VAPID_PRIVATE_KEY };
  ctx.waitUntil(
    processWebhook(DB, pushEnv, qb, raw).catch((e) => console.error("qb webhook processing crashed:", String(e?.message || e)))
  );
  return NextResponse.json({ ok: true });
}
