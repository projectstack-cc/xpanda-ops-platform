// src/app/api/safety/manage/records/route.ts  →  GET /v2/api/safety/manage/records   (saf-01)
// Training-records view data for the trainee population (lib/safety/records.ts TRAINEE_SQL): ready blocks, people
// (sorted by display name), latest non-voided completion per person × block, and the summary.
// Gated on safety.manage by middleware; re-checked here (canManageSafety) as defense in depth.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { readyBlocks } from "@/lib/safety/trainingBlocks";
import {
  actorOf, canManageSafety, etToday, latestByUserBlock, listActiveCompletions, listTrainees, summarize,
} from "@/lib/safety/records";

export async function GET(request: NextRequest) {
  if (!actorOf(request.headers)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageSafety(request.headers)) return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
  try {
    const { DB } = await getEnv();
    const [people, rows] = await Promise.all([listTrainees(DB), listActiveCompletions(DB)]);
    const ready = readyBlocks();
    const readyIds = ready.map((b) => b.id);
    const latestMap = latestByUserBlock(rows);

    const latest: Record<string, Record<string, { completed_on: string; source: string }>> = {};
    for (const p of people) {
      const mine = latestMap.get(p.user_id);
      if (!mine) continue;
      const out: Record<string, { completed_on: string; source: string }> = {};
      for (const id of readyIds) {
        const e = mine.get(id);
        if (e) out[id] = { completed_on: e.completed_on, source: e.source };
      }
      if (Object.keys(out).length) latest[p.user_id] = out;
    }

    return NextResponse.json({
      ok: true,
      blocks: ready.map((b) => ({ id: b.id, n: b.n, titleEn: b.titleEn, minutes: b.minutes })),
      people,
      latest,
      summary: summarize(people, latestMap, readyIds, etToday().slice(0, 7), rows),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
