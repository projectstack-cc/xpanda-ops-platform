// src/app/api/qb/pending/[id]/apply/route.ts  →  POST /v2/api/qb/pending/:id/apply
// qb-02: apply a QuickBooks review item (session-gated: /v2/api/qb → `jobs` edit).
// Body: { confirm_overwrite?: boolean }. Actor from middleware-injected X-User-* only.
import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/db";
import { applyPending } from "@/lib/qb/review";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await request.json(); } catch { body = {}; }
  try {
    const { id } = await params;
    const env = await getEnv();
    const { env: cf } = await getCloudflareContext();
    const pushEnv = { VAPID_PUBLIC_KEY: (cf as any).VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: (cf as any).VAPID_PRIVATE_KEY };
    const r = await applyPending(env, pushEnv, id, { id: actorId, name: actorName }, { confirmOverwrite: body?.confirm_overwrite === true });
    return NextResponse.json(r.body, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
