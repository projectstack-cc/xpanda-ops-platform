// src/app/api/admin/activity/route.ts  ->  GET /v2/api/admin/activity (admin-02)
// Port of legacy handleApiActivityLog (_worker.js/routes/admin.js), gated on `admin` by middleware.
// Adds user_id + range filters and the actor's display name. WHERE fragments are fixed strings; every
// filter value is bound. activity_log.timestamp is mixed-format (ISO "…T…Z" from logActivity, "YYYY-MM-DD
// HH:MM:SS" from the column default), so the range compares datetime(a.timestamp) — a raw string compare
// against datetime('now', …) would let every entry on the cutoff date through. ORDER BY normalises the
// same way (both formats are written every day; a raw sort puts every ISO row above every SQLite-format
// row of that day); a.id breaks ties so offset paging stays stable.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import type { ActivityEntry, ActivityRange } from "@/lib/admin/types";

const RANGE_MODIFIER: Record<ActivityRange, string | null> = {
  "24h": "-1 day",
  "7d": "-7 days",
  "30d": "-30 days",
  all: null,
};

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  const sp = new URL(request.url).searchParams;
  const limitRaw = parseInt(sp.get("limit") || "50", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);
  const offsetRaw = parseInt(sp.get("offset") || "0", 10);
  const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);
  const rangeParam = sp.get("range") as ActivityRange | null;
  const range: ActivityRange = rangeParam && rangeParam in RANGE_MODIFIER ? rangeParam : "7d";

  const where: string[] = [];
  const binds: unknown[] = [];
  const action = sp.get("action") || "";
  const entityType = sp.get("entity_type") || "";
  const userId = sp.get("user_id") || "";
  if (action) { where.push("a.action = ?"); binds.push(action); }
  if (entityType) { where.push("a.entity_type = ?"); binds.push(entityType); }
  if (userId) { where.push("a.user_id = ?"); binds.push(userId); }
  const modifier = RANGE_MODIFIER[range];
  if (modifier) { where.push("datetime(a.timestamp) >= datetime('now', ?)"); binds.push(modifier); }
  const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";

  try {
    const [rows, count] = await DB.batch([
      DB.prepare(
        `SELECT a.*, u.display_name AS user_name
           FROM activity_log a LEFT JOIN users u ON u.id = a.user_id${whereSql}
          ORDER BY datetime(a.timestamp) DESC, a.id DESC LIMIT ? OFFSET ?`
      ).bind(...binds, limit, offset),
      DB.prepare(`SELECT COUNT(*) AS total FROM activity_log a${whereSql}`).bind(...binds),
    ]);
    const entries: ActivityEntry[] = ((rows.results || []) as any[]).map((r) => {
      let detail: unknown = r.detail;
      try { detail = JSON.parse(r.detail); } catch {}
      return {
        id: r.id,
        timestamp: r.timestamp,
        action: r.action,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        summary: r.summary ?? null,
        detail,
        user_id: r.user_id ?? null,
        user_name: r.user_name ?? null,
      };
    });
    const total = Number((count.results?.[0] as any)?.total ?? 0);
    return NextResponse.json({ ok: true, entries, total });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String((e as any)?.message || e) }, { status: 500 });
  }
}
