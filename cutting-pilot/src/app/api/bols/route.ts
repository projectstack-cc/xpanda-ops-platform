// src/app/api/bols/route.ts  ->  GET /v2/api/bols?job_id= (live) | POST /v2/api/bols (fenced)
// GET mirrors legacy's GET /api/bols?job_id= (_worker.js/routes/bols.js) -- read-only, live.
// POST is AUTHORED (full parity with bol-compose.js's generateAll payload + the legacy insert's
// regenerate-replaces-previous / access_token-carryover behavior) but FENCED behind
// V2_LOGISTICS_WRITES_ENABLED per the prompt's read/write fence -- v2 shares prod D1, and
// `wrangler dev` writes hit production. See BACKLOG.md for the flip-the-flag follow-up.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { V2_LOGISTICS_WRITES_ENABLED } from "@/lib/logistics/writeFence";

function generateAccessToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job_id") || "";
  const days = parseInt(url.searchParams.get("days") || "30", 10);

  let query = "SELECT * FROM bols";
  const conds: string[] = [];
  const binds: unknown[] = [];

  if (jobId) {
    conds.push("job_id = ?");
    binds.push(jobId);
  } else if (days > 0) {
    conds.push("date >= date('now', ?)");
    binds.push(`-${days} days`);
  }
  if (conds.length) query += " WHERE " + conds.join(" AND ");
  query += " ORDER BY bol_number DESC";

  try {
    const result = binds.length ? await DB.prepare(query).bind(...binds).all() : await DB.prepare(query).all();
    return NextResponse.json({ ok: true, bols: result.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Fence check FIRST -- before any D1 read/write, so the regenerate-replace delete below (and
  // its R2 cleanup) can never run while the flag is off.
  if (!V2_LOGISTICS_WRITES_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "v2 logistics writes disabled (read-only migration phase)" },
      { status: 501 }
    );
  }

  const { DB, BOL_PHOTOS } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const date = String(payload.date || "").trim();
  if (!date) return NextResponse.json({ ok: false, error: "date is required." }, { status: 400 });

  const bol_number = payload.bol_number ? String(payload.bol_number).trim() || null : null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const s = (f: string) => String(payload[f] || "").trim();

  const validTerms = ["prepaid", "collect", "3rd_party"];
  const freight_terms = validTerms.includes(s("freight_terms")) ? s("freight_terms") : "prepaid";
  const is_scrap_pickup = payload.is_scrap_pickup ? 1 : 0;

  let render_overrides: string | null = null;
  if (payload.render_overrides != null) {
    if (typeof payload.render_overrides === "object") {
      render_overrides = JSON.stringify(payload.render_overrides);
    } else if (typeof payload.render_overrides === "string" && payload.render_overrides.trim()) {
      try {
        JSON.parse(payload.render_overrides);
        render_overrides = payload.render_overrides;
      } catch {
        render_overrides = null;
      }
    }
  }

  let access_token = generateAccessToken();
  let job_id = payload.job_id ? String(payload.job_id).trim() : null;

  // A BOL arriving with no job_id but a known bol_group_id inherits the group's job link from
  // an already-linked sibling (mirrors legacy's P241 guard).
  if (!job_id && payload.bol_group_id) {
    try {
      const sib = await DB.prepare(
        "SELECT job_id FROM bols WHERE bol_group_id = ? AND job_id IS NOT NULL LIMIT 1"
      ).bind(String(payload.bol_group_id).trim()).first<any>();
      if (sib?.job_id) job_id = sib.job_id;
    } catch (e) {
      console.error("bols POST: bol_group_id job link inheritance failed", e);
    }
  }

  // Regenerate-replaces-previous: remove any prior BOL for the same job+load so regenerations
  // don't pile up stale rows. Preserve the most-recent prior access_token so a previously
  // printed tracking QR still works.
  if (job_id && payload.load_number != null) {
    try {
      const priorRows = await DB.prepare(
        "SELECT id, access_token, created_at FROM bols WHERE job_id = ? AND load_number = ? ORDER BY created_at ASC"
      ).bind(job_id, Number(payload.load_number)).all();
      const priors = (priorRows.results ?? []) as any[];
      for (const p of priors) {
        if (p.access_token) access_token = p.access_token;
        const docs = await DB.prepare("SELECT r2_key FROM bol_documents WHERE bol_id = ?").bind(p.id).all();
        for (const d of (docs.results ?? []) as any[]) {
          if (d.r2_key && BOL_PHOTOS) {
            try {
              await BOL_PHOTOS.delete(d.r2_key);
            } catch {
              // best-effort cleanup
            }
          }
        }
        await DB.prepare("DELETE FROM bol_documents WHERE bol_id = ?").bind(p.id).run();
        await DB.prepare("DELETE FROM bols WHERE id = ?").bind(p.id).run();
      }
    } catch (e) {
      console.error("Regenerate-replace prior BOL failed:", String((e as any)?.message || e));
    }
  }

  let shipper_name = "";
  if (actorId) {
    const su = await DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(actorId).first<any>();
    shipper_name = su?.display_name || "";
  }

  try {
    await DB.prepare(
      `INSERT INTO bols (
         id, bol_number, date, customer_id,
         ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
         ship_to_city, ship_to_state, ship_to_zip, location_no,
         carrier_id, carrier_name, trailer_no, seal_number, scac, pro_no,
         freight_terms, is_scrap_pickup, third_party_bill_to, special_instructions, contact_info, is_master_bol, siplast,
         commodity_description, handling_unit_qty, handling_unit_type,
         package_qty, package_type, weight, delivery_time, job_id, notes, po_number, render_overrides, access_token, shipper_name,
         bol_group_id, load_number, load_count, created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, bol_number, date,
      payload.customer_id ? String(payload.customer_id).trim() : null,
      s("ship_to_company"), s("ship_to_attention"), s("ship_to_street"), s("ship_to_street2"),
      s("ship_to_city"), s("ship_to_state"), s("ship_to_zip"), s("location_no"),
      payload.carrier_id ? String(payload.carrier_id).trim() : null,
      s("carrier_name"), s("trailer_no"), s("seal_number"), s("scac"), s("pro_no"),
      freight_terms, is_scrap_pickup, s("third_party_bill_to"), s("special_instructions"), s("contact_info"),
      payload.is_master_bol ? 1 : 0,
      payload.siplast ? 1 : 0,
      s("commodity_description"), s("handling_unit_qty"), s("handling_unit_type"),
      s("package_qty"), s("package_type"), s("weight"), s("delivery_time"),
      job_id, s("notes"), s("po_number"), render_overrides, access_token, shipper_name,
      payload.bol_group_id ? String(payload.bol_group_id).trim() : null,
      payload.load_number != null ? Number(payload.load_number) : null,
      payload.load_count != null ? Number(payload.load_count) : null,
      now
    ).run();

    const row = await DB.prepare("SELECT * FROM bols WHERE id = ?").bind(id).first();

    // Activity log -- shared D1 table, same schema as legacy logActivity().
    try {
      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'create', 'bol', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), now, id,
        `Created ${bol_number ? `BOL #${bol_number}` : "BOL"} for ${s("ship_to_company")}`,
        JSON.stringify({ bol_number, ship_to_company: s("ship_to_company"), carrier_name: s("carrier_name"), date }),
        actorId, now
      ).run();
    } catch (e) {
      console.error("activity_log failed:", String((e as any)?.message || e));
    }

    return NextResponse.json({ ok: true, message: "BOL created.", bol: row }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
