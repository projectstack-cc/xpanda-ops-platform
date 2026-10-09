// src/app/api/admin/stats/route.ts  ->  GET /v2/api/admin/stats (admin-02)
// Header counts for /v2/admin. Real-admin only. Timestamps are mixed-format in activity_log (ISO
// "…T…Z" from logActivity, "YYYY-MM-DD HH:MM:SS" from the column default) — datetime() normalises both.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { requireRealAdmin } from "@/lib/admin/guard";
import type { AdminStats } from "@/lib/admin/types";

export async function GET(request: NextRequest) {
  const denied = requireRealAdmin(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  try {
    const res = await DB.batch([
      DB.prepare("SELECT COUNT(*) AS n FROM users WHERE is_active = 1"),
      DB.prepare("SELECT COUNT(*) AS n FROM users"),
      DB.prepare("SELECT COUNT(*) AS n FROM roles"),
      DB.prepare("SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)"),
      DB.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE datetime(timestamp) >= datetime('now', '-1 day')"),
      DB.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE datetime(timestamp) >= datetime('now', '-7 days')"),
    ]);
    const n = (i: number) => Number((res[i].results?.[0] as any)?.n ?? 0);
    const stats: AdminStats = {
      users_active: n(0),
      users_total: n(1),
      roles: n(2),
      users_without_role: n(3),
      activity_24h: n(4),
      activity_7d: n(5),
    };
    return NextResponse.json({ ok: true, stats });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String((e as any)?.message || e) }, { status: 500 });
  }
}
