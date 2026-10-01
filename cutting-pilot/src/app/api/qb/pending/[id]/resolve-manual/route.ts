// src/app/api/qb/pending/[id]/resolve-manual/route.ts  →  POST /v2/api/qb/pending/:id/resolve-manual
// qb-02: Body { note } (required) → status resolved_manual (handled outside the apply path).
// Session-gated: /v2/api/qb → `jobs` edit. Actor from middleware-injected X-User-* only.
import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/db";
import { closeWithoutApply } from "@/lib/qb/review";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await request.json(); } catch { body = {}; }
  const note = String(body?.note ?? "").trim();
  if (true && !note) return NextResponse.json({ ok: false, error: "A note is required." }, { status: 400 });
  try {
    const { id } = await params;
    const { DB } = await getEnv();
    const { env: cf } = await getCloudflareContext();
    const pushEnv = { VAPID_PUBLIC_KEY: (cf as any).VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: (cf as any).VAPID_PRIVATE_KEY };
    const r = await closeWithoutApply(DB, pushEnv, id, "resolved_manual", { id: actorId, name: actorName }, note || null);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
