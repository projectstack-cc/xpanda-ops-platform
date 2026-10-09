// src/app/api/admin/activity/facets/route.ts  ->  GET /v2/api/admin/activity/facets (admin-02)
// Filter options for the Activity tab, gated on `admin` by middleware. No legacy equivalent.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import type { ActivityFacets } from "@/lib/admin/types";

// Takes `request` (unused) so Next 14 treats the handler as dynamic, not a build-time static GET.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  try {
    const [actions, entityTypes, users] = await DB.batch([
      DB.prepare("SELECT DISTINCT action FROM activity_log ORDER BY 1"),
      DB.prepare("SELECT DISTINCT entity_type FROM activity_log ORDER BY 1"),
      DB.prepare(
        `SELECT DISTINCT a.user_id AS id, u.display_name AS name
           FROM activity_log a JOIN users u ON u.id = a.user_id
          WHERE a.user_id IS NOT NULL
          ORDER BY u.display_name COLLATE NOCASE`
      ),
    ]);
    const facets: ActivityFacets = {
      actions: ((actions.results || []) as any[]).map((r) => r.action),
      entity_types: ((entityTypes.results || []) as any[]).map((r) => r.entity_type),
      users: ((users.results || []) as any[]).map((r) => ({ id: r.id, name: r.name })),
    };
    return NextResponse.json({ ok: true, facets });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String((e as any)?.message || e) }, { status: 500 });
  }
}
