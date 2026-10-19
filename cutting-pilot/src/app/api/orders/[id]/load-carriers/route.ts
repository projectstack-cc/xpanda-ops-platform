// src/app/api/orders/[id]/load-carriers/route.ts  →  GET/PUT /v2/api/orders/:id/load-carriers
// mlc-01: per-load carrier overrides (job_load_carriers, sparse — see lib/logistics/loadCarriers.ts).
// Gate (middleware PATTERN_PERMISSION_MAP): GET is open to the same keys as load-times (order entry,
// Job Board, and the logistics dashboard / BOL / Load Builder / dock readers). PUT is re-checked
// here: `orders` edit OR `logistics.dashboard` edit (same as load-times). Kept off the load-times
// route on purpose — that PUT rewrites rows as source='manual'.
// PUT takes one entry per load the editor shows; "" = follow the order carrier. Rows equal to the
// order carrier are pruned; unsigned BOLs of a load whose effective carrier changed are rewritten.
import { NextResponse, type NextRequest } from "next/server";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { normCarrier, propagateLoadCarrierToBols } from "@/lib/logistics/bolCarrier";
import { effectiveLoadCarrier, readLoadCarriers } from "@/lib/logistics/loadCarriers";

const MAX_CARRIER = 120;

function canEdit(request: NextRequest): boolean {
  if (request.headers.get("X-User-Is-Admin") === "1") return true;
  let perms: any = {};
  try { perms = JSON.parse(request.headers.get("X-User-Permissions") || "{}"); } catch {}
  return !!(perms["orders"]?.edit || perms["logistics.dashboard"]?.edit);
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  try {
    const payload = await readLoadCarriers(DB, id);
    if (!payload) return NextResponse.json({ ok: false, error: "Order not found.", detail: `no job ${id}` }, { status: 404 });
    return NextResponse.json({ ok: true, ...payload });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Couldn't load load carriers.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  if (!canEdit(request)) {
    return NextResponse.json({ ok: false, error: "You don't have permission to edit load carriers." }, { status: 403 });
  }
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(body?.carriers)) {
    return NextResponse.json({ ok: false, error: "carriers must be an array.", detail: "body.carriers" }, { status: 400 });
  }

  try {
    const before = await readLoadCarriers(DB, id);
    if (!before) return NextResponse.json({ ok: false, error: "Order not found.", detail: `no job ${id}` }, { status: 404 });
    const loadCount = before.load_count;
    const jobCarrier = before.default_carrier;

    // Validate everything before writing anything.
    const incoming = new Map<number, string>();
    for (const c of body.carriers) {
      const n = Number(c?.load_number);
      if (!Number.isInteger(n) || n < 1 || n > loadCount) {
        return NextResponse.json({ ok: false, error: `Load number must be 1–${loadCount}.`, detail: `load_number=${c?.load_number}` }, { status: 400 });
      }
      const carrier = String(c?.carrier ?? "").trim();
      if (carrier.length > MAX_CARRIER) {
        return NextResponse.json({ ok: false, error: `Carrier must be ${MAX_CARRIER} characters or fewer.`, detail: `load ${n}: ${carrier.length} chars` }, { status: 400 });
      }
      incoming.set(n, carrier);
    }

    const oldOverrides = new Map(before.carriers.map((r) => [r.load_number, r.carrier]));
    const stmts: D1PreparedStatement[] = [];
    const changed: { load_number: number; from: string | null; to: string | null }[] = [];
    for (const [n, carrier] of Array.from(incoming.entries())) {
      const oldEff = effectiveLoadCarrier(jobCarrier, oldOverrides, n);
      const keep = carrier !== "" && normCarrier(carrier) !== normCarrier(jobCarrier);
      if (keep) {
        if (oldOverrides.get(n) !== carrier) {
          stmts.push(
            DB.prepare(
              `INSERT INTO job_load_carriers (job_id, load_number, carrier, updated_at, updated_by)
               VALUES (?, ?, ?, datetime('now'), ?)
               ON CONFLICT(job_id, load_number) DO UPDATE SET
                 carrier = excluded.carrier, updated_at = datetime('now'), updated_by = excluded.updated_by`
            ).bind(id, n, carrier, actorId || null)
          );
        }
      } else if (oldOverrides.has(n)) {
        stmts.push(DB.prepare(`DELETE FROM job_load_carriers WHERE job_id = ? AND load_number = ?`).bind(id, n));
      }
      const newEff = keep ? carrier : jobCarrier;
      if (normCarrier(oldEff) !== normCarrier(newEff)) changed.push({ load_number: n, from: oldEff, to: newEff });
    }
    // Rows beyond load_count are invisible to readers; drop them now.
    stmts.push(DB.prepare(`DELETE FROM job_load_carriers WHERE job_id = ? AND load_number > ?`).bind(id, loadCount));
    await DB.batch(stmts);

    let bolsUpdated = 0;
    for (const c of changed) {
      bolsUpdated += await propagateLoadCarrierToBols(DB, id, c.load_number, c.from, c.to, actorId || null);
    }

    const after = await readLoadCarriers(DB, id);
    if (changed.length) {
      const overrides = new Map((after ?? before).carriers.map((r) => [r.load_number, r.carrier]));
      const parts: string[] = [];
      for (let n = 1; n <= loadCount; n++) parts.push(`L${n} ${effectiveLoadCarrier(jobCarrier, overrides, n) || "(none)"}`);
      await logActivity(
        DB, "update", "job", id,
        `${actorName || "Someone"} set load carriers: ${parts.join(", ")}`,
        { default_carrier: jobCarrier, changed, bols_updated: bolsUpdated, via: "load-carriers" },
        actorId || null,
      );
    }
    return NextResponse.json({ ok: true, ...(after ?? before) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Couldn't save load carriers.", detail: String(e?.message || e) }, { status: 500 });
  }
}
