// src/app/api/carrier-options/route.ts  →  GET/POST /v2/api/carrier-options
// mlc-05: the shared carrier list behind every v2 carrier dropdown (components/orders/CarrierSelect).
// Backed by bol_carriers (active rows, ORDER BY sort_order — column added by the mlc-05 migration).
// Gate (middleware PATTERN_PERMISSION_MAP, checked before the /v2/api/carrier prefix row): order entry,
// logistics dashboard, BOL and Load Builder readers. POST ("Add carrier") is re-checked here:
// `orders` edit OR `logistics.dashboard` edit (admin passes). Adding an existing name (any casing)
// reactivates and returns it — an idempotent pick, never a 409.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

const MIN_NAME = 2;
const MAX_NAME = 60;

function canAdd(request: NextRequest): boolean {
  if (request.headers.get("X-User-Is-Admin") === "1") return true;
  let perms: any = {};
  try { perms = JSON.parse(request.headers.get("X-User-Permissions") || "{}"); } catch {}
  return !!(perms["orders"]?.edit || perms["logistics.dashboard"]?.edit);
}

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const rows = await DB.prepare(
      `SELECT id, name FROM bol_carriers WHERE is_active = 1 ORDER BY sort_order, name`
    ).all<{ id: string; name: string }>();
    return NextResponse.json({ ok: true, carriers: rows.results || [], can_add: canAdd(request) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Couldn't load carriers.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  if (!canAdd(request)) {
    return NextResponse.json({ ok: false, error: "You don't have permission to add carriers." }, { status: 403 });
  }
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const name = String(body?.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < MIN_NAME || name.length > MAX_NAME) {
    return NextResponse.json(
      { ok: false, error: `Carrier name must be ${MIN_NAME}–${MAX_NAME} characters.`, detail: `length=${name.length}` },
      { status: 400 }
    );
  }

  const findExisting = () =>
    DB.prepare(`SELECT id, name, is_active FROM bol_carriers WHERE name = ? COLLATE NOCASE LIMIT 1`)
      .bind(name)
      .first<{ id: string; name: string; is_active: number }>();

  try {
    let existing = await findExisting();
    if (!existing) {
      const id = crypto.randomUUID();
      try {
        await DB.prepare(
          `INSERT INTO bol_carriers (id, name, sort_order)
           VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM bol_carriers))`
        ).bind(id, name).run();
      } catch (e: any) {
        // Lost a race against a concurrent add of the same name (ux_bol_carriers_name) → pick that row.
        if (!/UNIQUE/i.test(String(e?.message || e))) throw e;
        existing = await findExisting();
        if (!existing) throw e;
      }
      if (!existing) {
        await logActivity(
          DB, "create", "bol_carrier", id,
          `${actorName || "Someone"} added carrier "${name}"`,
          { name, via: "carrier-options" },
          actorId || null,
        );
        return NextResponse.json({ ok: true, carrier: { id, name } }, { status: 201 });
      }
    }
    if (!existing.is_active) {
      await DB.prepare(`UPDATE bol_carriers SET is_active = 1 WHERE id = ?`).bind(existing.id).run();
      await logActivity(
        DB, "update", "bol_carrier", existing.id,
        `${actorName || "Someone"} reactivated carrier "${existing.name}"`,
        { name: existing.name, is_active: { from: 0, to: 1 }, via: "carrier-options" },
        actorId || null,
      );
    }
    return NextResponse.json({ ok: true, carrier: { id: existing.id, name: existing.name } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Couldn't add carrier.", detail: String(e?.message || e) }, { status: 500 });
  }
}
