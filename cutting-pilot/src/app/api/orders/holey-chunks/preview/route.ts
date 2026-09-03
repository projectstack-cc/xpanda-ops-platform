// POST /v2/api/orders/holey-chunks/preview
// Compute-only chunk preview for /v2/orders. Mirrors legacy _worker.js/routes/jobs.js
// handleHoleyChunksPreview 1:1 — no DB writes, no persistence. Order entry already resolved
// each HB line to {thickness, qty} client-side; the nester only needs to pack. Gated on
// `orders` by middleware (POST → edit); first /v2/api/orders/holey-chunks prefix matches the
// existing `/v2/api/orders` PERMISSION_MAP row, so no middleware change.
import { NextResponse, type NextRequest } from "next/server";
import { nestHoleyChunks, type NestInputItem } from "@/lib/holeyNester";

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const items: NestInputItem[] = Array.isArray(body?.items) ? body.items : [];
  const opts: { height?: number; kerf?: number } = {};
  if (Number.isFinite(Number(body?.height))) opts.height = Number(body.height);
  if (Number.isFinite(Number(body?.kerf))) opts.kerf = Number(body.kerf);

  const result = nestHoleyChunks(items, opts);
  return NextResponse.json({ ok: true, ...result });
}