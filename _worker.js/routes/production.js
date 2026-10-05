import { json, logActivity, safeJsonParse, nowSqlite } from '../lib/core.js';

// quickwin-01: PUT /api/parts SET builder. The 7 core fields are always written (validated by the
// caller); each optional field is written ONLY when its key is present in the payload, so callers
// that send a subset (block calculator: core 7 only) never blank out name/color/etc. Column names
// come from this fixed whitelist — payload keys are never interpolated into SQL. Normalization
// matches the POST branch.
const PART_OPTIONAL_FIELDS = [
  ["name",           (v) => String(v || "").trim()],
  ["weight",         (v) => Number.isFinite(Number(v)) ? Number(v) : 1],
  ["color",          (v) => String(v || "#D97706").trim()],
  ["allow_rotation", (v) => v ? 1 : 0],
  ["sort_order",     (v) => Number.isFinite(Number(v)) ? Number(v) : 0],
  ["category",       (v) => String(v || "").trim()],
  ["parent_group",   (v) => String(v || "").trim()],
  ["bundle_qty",     (v) => parseInt(v, 10) || 0],
];

function buildPartUpdate(payload, core, now, id) {
  const sets  = ["part_number=?", "customer=?", "density_material=?", "length_in=?", "width_in=?", "height_in=?", "notes=?"];
  const binds = [core.part_number, core.customer, core.density_material, core.length_in, core.width_in, core.height_in, core.notes];
  const fields = [];
  for (const [col, norm] of PART_OPTIONAL_FIELDS) {
    if (payload[col] !== undefined) {
      sets.push(`${col}=?`);
      binds.push(norm(payload[col]));
      fields.push(col);
    }
  }
  sets.push("updated_at=?");
  binds.push(now, id);
  return { sql: `UPDATE parts SET ${sets.join(", ")} WHERE id=?`, binds, fields };
}

export async function handleApiParts(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  if (request.method === "GET") {
    try {
      const rows = await db
        .prepare("SELECT * FROM parts ORDER BY category ASC, sort_order ASC, part_number ASC")
        .all();
      return json({ ok: true, parts: rows.results || [] });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (request.method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const part_number      = String(payload.part_number || "").trim();
    const name             = String(payload.name || payload.part_number || "").trim();
    const customer         = String(payload.customer || "").trim();
    const density_material = String(payload.density_material || "").trim();
    const length_in        = Number(payload.length_in);
    const width_in         = Number(payload.width_in);
    const height_in        = Number(payload.height_in);
    const weight           = Number.isFinite(Number(payload.weight)) ? Number(payload.weight) : 1;
    const notes            = String(payload.notes || "").trim();
    const color            = String(payload.color || "#D97706").trim();
    const allow_rotation   = payload.allow_rotation ? 1 : 0;
    const sort_order       = Number.isFinite(Number(payload.sort_order)) ? Number(payload.sort_order) : 0;
    const category         = String(payload.category || "").trim();
    const parent_group     = String(payload.parent_group || "").trim();
    const bundle_qty       = parseInt(payload.bundle_qty, 10) || 0;

    if (!part_number) return json({ ok: false, error: "Part number is required." }, 400);
    if (!Number.isFinite(length_in) || length_in <= 0) return json({ ok: false, error: "Length must be greater than 0." }, 400);
    if (!Number.isFinite(width_in)  || width_in  <= 0) return json({ ok: false, error: "Width must be greater than 0." }, 400);
    if (!Number.isFinite(height_in) || height_in <= 0) return json({ ok: false, error: "Height must be greater than 0." }, 400);

    const id  = crypto.randomUUID();
    const now = nowSqlite();

    try {
      await db.prepare(
        `INSERT INTO parts (id, part_number, name, customer, density_material, length_in, width_in, height_in, weight, notes, color, allow_rotation, sort_order, category, parent_group, bundle_qty, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, part_number, name, customer, density_material, length_in, width_in, height_in, weight, notes, color, allow_rotation, sort_order, category, parent_group, bundle_qty, now, now).run();

      const part = await db.prepare("SELECT * FROM parts WHERE id = ?").bind(id).first();
      await logActivity(db, 'create', 'part', id,
        `Created part ${part_number}`,
        { part_number, customer, length_in, width_in, height_in }
      );
      return json({ ok: true, message: "Part created.", part }, 201);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/unique/i.test(msg) || /constraint/i.test(msg)) {
        return json({ ok: false, error: "A part with that number already exists.", code: "DUPLICATE_PART_NUMBER" }, 409);
      }
      return json({ ok: false, error: "Server error.", detail: msg }, 500);
    }
  }

  if (request.method === "PUT") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id               = String(payload.id || "").trim();
    const part_number      = String(payload.part_number || "").trim();
    const customer         = String(payload.customer || "").trim();
    const density_material = String(payload.density_material || "").trim();
    const length_in        = Number(payload.length_in);
    const width_in         = Number(payload.width_in);
    const height_in        = Number(payload.height_in);
    const notes            = String(payload.notes || "").trim();

    if (!id) return json({ ok: false, error: "id is required." }, 400);
    if (!part_number) return json({ ok: false, error: "Part number is required." }, 400);
    if (!Number.isFinite(length_in) || length_in <= 0) return json({ ok: false, error: "Length must be greater than 0." }, 400);
    if (!Number.isFinite(width_in)  || width_in  <= 0) return json({ ok: false, error: "Width must be greater than 0." }, 400);
    if (!Number.isFinite(height_in) || height_in <= 0) return json({ ok: false, error: "Height must be greater than 0." }, 400);

    const existing = await db.prepare("SELECT id FROM parts WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Part not found." }, 404);

    const now = nowSqlite();
    try {
      const upd = buildPartUpdate(payload,
        { part_number, customer, density_material, length_in, width_in, height_in, notes }, now, id);
      await db.prepare(upd.sql).bind(...upd.binds).run();

      const part = await db.prepare("SELECT * FROM parts WHERE id = ?").bind(id).first();
      await logActivity(db, 'update', 'part', id,
        `Updated part ${part_number}`,
        { part_number, customer, length_in, width_in, height_in, fields: upd.fields }
      );
      return json({ ok: true, message: "Part updated.", part });
    } catch (e) {
      const msg = String(e?.message || e);
      if (/unique/i.test(msg) || /constraint/i.test(msg)) {
        return json({ ok: false, error: "A part with that number already exists.", code: "DUPLICATE_PART_NUMBER" }, 409);
      }
      return json({ ok: false, error: "Server error.", detail: msg }, 500);
    }
  }

  if (request.method === "DELETE") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db.prepare("SELECT id FROM parts WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Part not found." }, 404);

    try {
      await db.prepare("DELETE FROM parts WHERE id = ?").bind(id).run();
      await logActivity(db, 'delete', 'part', id, `Deleted part ${id}`, { id });
      return json({ ok: true, message: "Part deleted." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

export async function handleApiCombos(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  if (request.method === "GET") {
    try {
      const rows = await db
        .prepare("SELECT * FROM saved_combos ORDER BY updated_at DESC")
        .all();
      const combos = (rows.results || []).map((r) => ({
        ...r,
        machines_active: safeJsonParse(r.machines_active, []),
        primary_part_snapshot: safeJsonParse(r.primary_part_snapshot, {}),
        secondary_parts_snapshot: safeJsonParse(r.secondary_parts_snapshot, []),
        result_snapshot: safeJsonParse(r.result_snapshot, {}),
      }));
      return json({ ok: true, combos });
    } catch (e) {
      return json(
        { ok: false, error: "Server error.", detail: String(e?.message || e) },
        500,
      );
    }
  }

  if (request.method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const name = String(payload.name || "").trim();
    const description = String(payload.description || "").trim();
    const block_l = Number(payload.block_l);
    const block_w = Number(payload.block_w);
    const block_h = Number(payload.block_h);
    const kerf = Number(payload.kerf ?? 0.079);
    const orientation_mode = String(payload.orientation_mode || "auto").trim();
    const machines_active = Array.isArray(payload.machines_active)
      ? payload.machines_active
      : ["cross_cutter", "main_line", "blue_line"];
    const primary_part_id = payload.primary_part_id
      ? String(payload.primary_part_id).trim()
      : null;
    const primary_part_snapshot = payload.primary_part_snapshot;
    const secondary_parts_snapshot = Array.isArray(payload.secondary_parts_snapshot)
      ? payload.secondary_parts_snapshot
      : [];
    const result_snapshot = payload.result_snapshot || {};

    if (!name) return json({ ok: false, error: "Name is required." }, 400);
    if (!Number.isFinite(block_l) || block_l <= 0)
      return json({ ok: false, error: "Block Length must be greater than 0." }, 400);
    if (!Number.isFinite(block_w) || block_w <= 0)
      return json({ ok: false, error: "Block Width must be greater than 0." }, 400);
    if (!Number.isFinite(block_h) || block_h <= 0)
      return json({ ok: false, error: "Block Height must be greater than 0." }, 400);
    if (!primary_part_snapshot || typeof primary_part_snapshot !== "object")
      return json({ ok: false, error: "primary_part_snapshot is required." }, 400);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await db
        .prepare(
          `INSERT INTO saved_combos
           (id, name, description, block_l, block_w, block_h, kerf, orientation_mode,
            machines_active, primary_part_id, primary_part_snapshot,
            secondary_parts_snapshot, result_snapshot, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id, name, description, block_l, block_w, block_h, kerf, orientation_mode,
          JSON.stringify(machines_active), primary_part_id,
          JSON.stringify(primary_part_snapshot),
          JSON.stringify(secondary_parts_snapshot),
          JSON.stringify(result_snapshot),
          now, now,
        )
        .run();

      const row = await db
        .prepare("SELECT * FROM saved_combos WHERE id = ?")
        .bind(id)
        .first();
      await logActivity(db, 'create', 'combo', id,
        `Saved combination ${name}`,
        { name, block_l, block_w, block_h }
      );
      return json(
        {
          ok: true,
          message: "Combination saved.",
          combo: {
            ...row,
            machines_active: safeJsonParse(row.machines_active, []),
            primary_part_snapshot: safeJsonParse(row.primary_part_snapshot, {}),
            secondary_parts_snapshot: safeJsonParse(row.secondary_parts_snapshot, []),
            result_snapshot: safeJsonParse(row.result_snapshot, {}),
          },
        },
        201,
      );
    } catch (e) {
      return json(
        { ok: false, error: "Server error.", detail: String(e?.message || e) },
        500,
      );
    }
  }

  if (request.method === "DELETE") {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db
      .prepare("SELECT id FROM saved_combos WHERE id = ?")
      .bind(id)
      .first();
    if (!existing)
      return json({ ok: false, error: "Combination not found." }, 404);

    try {
      await db.prepare("DELETE FROM saved_combos WHERE id = ?").bind(id).run();
      await logActivity(db, 'delete', 'combo', id,
        `Deleted combination ${id}`,
        { id }
      );
      return json({ ok: true, message: "Combination deleted." });
    } catch (e) {
      return json(
        { ok: false, error: "Server error.", detail: String(e?.message || e) },
        500,
      );
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

// =============================================================================
// HANDLER: /api/shipments  (GET / POST / PUT / DELETE)
// =============================================================================
