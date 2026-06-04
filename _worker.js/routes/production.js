import { json, logActivity, safeJsonParse } from '../lib/core.js';

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
    const now = new Date().toISOString();

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

    const now = new Date().toISOString();
    try {
      const bundle_qty_upd = payload.bundle_qty !== undefined ? (parseInt(payload.bundle_qty, 10) || 0) : undefined;
      const updateSql = bundle_qty_upd !== undefined
        ? `UPDATE parts SET part_number=?, customer=?, density_material=?, length_in=?, width_in=?, height_in=?, notes=?, bundle_qty=?, updated_at=? WHERE id=?`
        : `UPDATE parts SET part_number=?, customer=?, density_material=?, length_in=?, width_in=?, height_in=?, notes=?, updated_at=? WHERE id=?`;
      const updateBinds = bundle_qty_upd !== undefined
        ? [part_number, customer, density_material, length_in, width_in, height_in, notes, bundle_qty_upd, now, id]
        : [part_number, customer, density_material, length_in, width_in, height_in, notes, now, id];
      await db.prepare(updateSql).bind(...updateBinds).run();

      const part = await db.prepare("SELECT * FROM parts WHERE id = ?").bind(id).first();
      await logActivity(db, 'update', 'part', id,
        `Updated part ${part_number}`,
        { part_number, customer, length_in, width_in, height_in }
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

export async function handleApiBeadTypes(request, env) {
  const db = env.DB;
  const method = request.method.toUpperCase();

  if (method === "GET") {
    try {
      const { results } = await db
        .prepare("SELECT * FROM bead_types ORDER BY name ASC")
        .all();
      return json({ ok: true, data: results });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const name = String(payload.name || "").trim();
    if (!name) return json({ ok: false, error: "name is required." }, 400);

    const grade = String(payload.grade || "").trim();
    const color = String(payload.color || "").trim();
    const notes = String(payload.notes || "").trim();

    const exists = await db
      .prepare("SELECT id FROM bead_types WHERE name = ?")
      .bind(name).first();
    if (exists) return json({ ok: false, error: "A bead type with that name already exists." }, 409);

    const id = crypto.randomUUID();
    try {
      await db.prepare(
        "INSERT INTO bead_types (id, name, grade, color, notes) VALUES (?, ?, ?, ?, ?)"
      ).bind(id, name, grade, color, notes).run();
      const row = await db.prepare("SELECT * FROM bead_types WHERE id = ?").bind(id).first();
      return json({ ok: true, data: row }, 201);
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "PUT") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db
      .prepare("SELECT id FROM bead_types WHERE id = ?")
      .bind(id).first();
    if (!existing) return json({ ok: false, error: "Bead type not found." }, 404);

    const allowed = ["name", "grade", "color", "notes"];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (key in payload) {
        sets.push(`${key} = ?`);
        vals.push(String(payload[key] ?? "").trim());
      }
    }
    if (sets.length === 0) return json({ ok: false, error: "No fields to update." }, 400);

    if ("name" in payload) {
      const conflict = await db
        .prepare("SELECT id FROM bead_types WHERE name = ? AND id != ?")
        .bind(payload.name.trim(), id).first();
      if (conflict) return json({ ok: false, error: "Name already in use." }, 409);
    }

    sets.push("updated_at = datetime('now')");
    vals.push(id);
    try {
      await db.prepare(`UPDATE bead_types SET ${sets.join(", ")} WHERE id = ?`)
        .bind(...vals).run();
      const row = await db.prepare("SELECT * FROM bead_types WHERE id = ?").bind(id).first();
      return json({ ok: true, data: row });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "DELETE") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db
      .prepare("SELECT id FROM bead_types WHERE id = ?")
      .bind(id).first();
    if (!existing) return json({ ok: false, error: "Bead type not found." }, 404);

    try {
      await db.prepare("DELETE FROM bead_types WHERE id = ?").bind(id).run();
      return json({ ok: true, message: "Bead type deleted." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

// =============================================================================
// HANDLER: /api/bead-stock  (GET / POST / PUT / DELETE)
// =============================================================================
export async function handleApiBeadStock(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);
  const method = request.method.toUpperCase();

  function enrichBead(r) {
    return {
      ...r,
      total_weight_lbs: (r.bag_weight_lbs || 0) * (r.bags_on_hand || 0),
      below_reorder: r.reorder_point_bags > 0 && r.bags_on_hand <= r.reorder_point_bags,
    };
  }

  if (method === "GET") {
    try {
      const { results } = await db
        .prepare("SELECT * FROM bead_stock ORDER BY manufacturer ASC, bead_type ASC")
        .all();
      return json({ ok: true, data: (results || []).map(enrichBead) });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const manufacturer = String(payload.manufacturer || "").trim();
    const bead_type    = String(payload.bead_type    || "").trim();
    if (!manufacturer) return json({ ok: false, error: "manufacturer is required." }, 400);
    if (!bead_type)    return json({ ok: false, error: "bead_type is required." }, 400);

    const bag_weight_lbs = Number(payload.bag_weight_lbs ?? 0);
    if (!(bag_weight_lbs > 0)) return json({ ok: false, error: "bag_weight_lbs must be > 0." }, 400);

    const bags_on_hand       = Math.max(0, Math.round(Number(payload.bags_on_hand       ?? 0)));
    const reorder_point_bags = Math.max(0, Math.round(Number(payload.reorder_point_bags ?? 0)));
    const notes              = String(payload.notes || "").trim();

    const exists = await db
      .prepare("SELECT id FROM bead_stock WHERE manufacturer = ? AND bead_type = ?")
      .bind(manufacturer, bead_type).first();
    if (exists) return json({ ok: false, error: "That manufacturer + bead type combination already exists." }, 409);

    const id  = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await db.prepare(
        "INSERT INTO bead_stock (id, manufacturer, bead_type, bag_weight_lbs, bags_on_hand, reorder_point_bags, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(id, manufacturer, bead_type, bag_weight_lbs, bags_on_hand, reorder_point_bags, notes, now, now).run();
      const row = await db.prepare("SELECT * FROM bead_stock WHERE id = ?").bind(id).first();
      return json({ ok: true, data: enrichBead(row) }, 201);
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "PUT") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db.prepare("SELECT id FROM bead_stock WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Bead stock entry not found." }, 404);

    const allowed = ["manufacturer", "bead_type", "bag_weight_lbs", "bags_on_hand", "reorder_point_bags", "notes"];
    const sets = ["updated_at = datetime('now')"];
    const vals = [];

    for (const key of allowed) {
      if (!(key in payload)) continue;
      sets.push(`${key} = ?`);
      if (["bags_on_hand", "reorder_point_bags"].includes(key)) {
        vals.push(Math.max(0, Math.round(Number(payload[key] ?? 0))));
      } else if (key === "bag_weight_lbs") {
        vals.push(Number(payload[key] ?? 0));
      } else {
        vals.push(String(payload[key] || "").trim());
      }
    }

    vals.push(id);
    try {
      await db.prepare(`UPDATE bead_stock SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
      const row = await db.prepare("SELECT * FROM bead_stock WHERE id = ?").bind(id).first();
      return json({ ok: true, data: enrichBead(row) });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "DELETE") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db.prepare("SELECT id FROM bead_stock WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Bead stock entry not found." }, 404);

    try {
      await db.prepare("DELETE FROM bead_stock WHERE id = ?").bind(id).run();
      return json({ ok: true, message: "Bead stock entry deleted." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

// =============================================================================
// HANDLER: /api/block-inventory  (GET / POST / PUT / DELETE)
// =============================================================================
export async function handleApiBlockInventory(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);
  const method = request.method.toUpperCase();

  function enrichBlock(r) {
    return {
      ...r,
      display: `${r.blocks_on_hand}× ${r.density_material} ${r.length_in}×${r.width_in}×${r.height_in}`,
    };
  }

  if (method === "GET") {
    try {
      const { results } = await db
        .prepare("SELECT * FROM block_inventory ORDER BY density_material ASC, length_in ASC, width_in ASC, height_in ASC")
        .all();
      return json({ ok: true, data: (results || []).map(enrichBlock) });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const density_material = String(payload.density_material || "").trim();
    if (!density_material) return json({ ok: false, error: "density_material is required." }, 400);

    const length_in = Number(payload.length_in ?? 0);
    const width_in  = Number(payload.width_in  ?? 0);
    const height_in = Number(payload.height_in ?? 0);
    if (!(length_in > 0)) return json({ ok: false, error: "length_in must be > 0." }, 400);
    if (!(width_in  > 0)) return json({ ok: false, error: "width_in must be > 0." }, 400);
    if (!(height_in > 0)) return json({ ok: false, error: "height_in must be > 0." }, 400);

    const blocks_on_hand = Math.max(0, Math.round(Number(payload.blocks_on_hand ?? 0)));
    const notes          = String(payload.notes || "").trim();

    const exists = await db
      .prepare("SELECT id FROM block_inventory WHERE density_material = ? AND length_in = ? AND width_in = ? AND height_in = ?")
      .bind(density_material, length_in, width_in, height_in).first();
    if (exists) return json({ ok: false, error: "That density + dimensions combination already exists." }, 409);

    const id  = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await db.prepare(
        "INSERT INTO block_inventory (id, density_material, length_in, width_in, height_in, blocks_on_hand, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(id, density_material, length_in, width_in, height_in, blocks_on_hand, notes, now, now).run();
      const row = await db.prepare("SELECT * FROM block_inventory WHERE id = ?").bind(id).first();
      return json({ ok: true, data: enrichBlock(row) }, 201);
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "PUT") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db.prepare("SELECT id FROM block_inventory WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Block inventory entry not found." }, 404);

    const allowed = ["density_material", "length_in", "width_in", "height_in", "blocks_on_hand", "notes"];
    const sets = ["updated_at = datetime('now')"];
    const vals = [];

    for (const key of allowed) {
      if (!(key in payload)) continue;
      sets.push(`${key} = ?`);
      if (key === "blocks_on_hand") {
        vals.push(Math.max(0, Math.round(Number(payload[key] ?? 0))));
      } else if (["length_in", "width_in", "height_in"].includes(key)) {
        vals.push(Number(payload[key] ?? 0));
      } else {
        vals.push(String(payload[key] || "").trim());
      }
    }

    vals.push(id);
    try {
      await db.prepare(`UPDATE block_inventory SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
      const row = await db.prepare("SELECT * FROM block_inventory WHERE id = ?").bind(id).first();
      return json({ ok: true, data: enrichBlock(row) });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "DELETE") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db.prepare("SELECT id FROM block_inventory WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Block inventory entry not found." }, 404);

    try {
      await db.prepare("DELETE FROM block_inventory WHERE id = ?").bind(id).run();
      return json({ ok: true, message: "Block inventory entry deleted." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

// =============================================================================
// HANDLER: /api/molding-log  (GET / POST)
// =============================================================================
export async function handleApiMoldingLog(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);
  const method = request.method.toUpperCase();

  if (method === "GET") {
    const url  = new URL(request.url);
    const days = Math.max(1, parseInt(url.searchParams.get("days") || "30", 10));
    try {
      const { results } = await db.prepare(`
        SELECT
          m.*,
          bs.manufacturer, bs.bead_type, bs.bag_weight_lbs,
          bi.density_material, bi.length_in, bi.width_in, bi.height_in
        FROM molding_log m
        LEFT JOIN bead_stock      bs ON bs.id = m.bead_stock_id
        LEFT JOIN block_inventory bi ON bi.id = m.block_inventory_id
        WHERE m.created_at >= datetime('now', ? || ' days')
        ORDER BY m.created_at DESC
      `).bind(`-${days}`).all();
      return json({ ok: true, data: results || [] });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const bead_stock_id      = String(payload.bead_stock_id      || "").trim();
    const block_inventory_id = String(payload.block_inventory_id || "").trim();
    const bags_consumed      = Math.round(Number(payload.bags_consumed  ?? 0));
    const blocks_produced    = Math.round(Number(payload.blocks_produced ?? 0));
    const notes              = String(payload.notes || "").trim();

    if (!bead_stock_id)         return json({ ok: false, error: "bead_stock_id is required." }, 400);
    if (!block_inventory_id)    return json({ ok: false, error: "block_inventory_id is required." }, 400);
    if (!(bags_consumed > 0))   return json({ ok: false, error: "bags_consumed must be > 0." }, 400);
    if (!(blocks_produced > 0)) return json({ ok: false, error: "blocks_produced must be > 0." }, 400);

    const beadStock = await db.prepare("SELECT * FROM bead_stock WHERE id = ?").bind(bead_stock_id).first();
    if (!beadStock) return json({ ok: false, error: "Bead stock entry not found." }, 404);
    if (bags_consumed > beadStock.bags_on_hand) {
      return json({ ok: false, error: `Not enough bags. Have ${beadStock.bags_on_hand}, need ${bags_consumed}.` }, 422);
    }

    const blockInv = await db.prepare("SELECT id FROM block_inventory WHERE id = ?").bind(block_inventory_id).first();
    if (!blockInv) return json({ ok: false, error: "Block inventory entry not found." }, 404);

    const id  = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await db.batch([
        db.prepare("UPDATE bead_stock SET bags_on_hand = bags_on_hand - ?, updated_at = datetime('now') WHERE id = ?")
          .bind(bags_consumed, bead_stock_id),
        db.prepare("UPDATE block_inventory SET blocks_on_hand = blocks_on_hand + ?, updated_at = datetime('now') WHERE id = ?")
          .bind(blocks_produced, block_inventory_id),
        db.prepare("INSERT INTO molding_log (id, bead_stock_id, block_inventory_id, bags_consumed, blocks_produced, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id, bead_stock_id, block_inventory_id, bags_consumed, blocks_produced, notes, now),
      ]);
      return json({ ok: true, data: { id, bead_stock_id, block_inventory_id, bags_consumed, blocks_produced, notes, created_at: now } }, 201);
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

// =============================================================================
// HANDLER: /api/block-consumption  (GET / POST)
// =============================================================================
export async function handleApiBlockConsumption(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);
  const method = request.method.toUpperCase();

  if (method === "GET") {
    const url   = new URL(request.url);
    const days  = Math.max(1, parseInt(url.searchParams.get("days") || "30", 10));
    const jobId = (url.searchParams.get("job_id") || "").trim();

    const where = [`c.created_at >= datetime('now', ? || ' days')`];
    const vals  = [`-${days}`];
    if (jobId) { where.push("c.job_id = ?"); vals.push(jobId); }

    try {
      const { results } = await db.prepare(`
        SELECT
          c.*,
          bi.density_material, bi.length_in, bi.width_in, bi.height_in,
          j.customer AS job_customer, j.invoice_number AS job_invoice
        FROM block_consumption_log c
        LEFT JOIN block_inventory bi ON bi.id = c.block_inventory_id
        LEFT JOIN jobs             j  ON j.id  = c.job_id
        WHERE ${where.join(" AND ")}
        ORDER BY c.created_at DESC
      `).bind(...vals).all();
      return json({ ok: true, data: results || [] });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const block_inventory_id = String(payload.block_inventory_id || "").trim();
    const blocks_consumed    = Math.round(Number(payload.blocks_consumed ?? 0));
    const job_id             = payload.job_id ? String(payload.job_id).trim() : null;
    const notes              = String(payload.notes || "").trim();

    if (!block_inventory_id)    return json({ ok: false, error: "block_inventory_id is required." }, 400);
    if (!(blocks_consumed > 0)) return json({ ok: false, error: "blocks_consumed must be > 0." }, 400);

    const blockInv = await db.prepare("SELECT * FROM block_inventory WHERE id = ?").bind(block_inventory_id).first();
    if (!blockInv) return json({ ok: false, error: "Block inventory entry not found." }, 404);
    if (blocks_consumed > blockInv.blocks_on_hand) {
      return json({ ok: false, error: `Not enough blocks. Have ${blockInv.blocks_on_hand}, need ${blocks_consumed}.` }, 422);
    }

    const id  = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await db.batch([
        db.prepare("UPDATE block_inventory SET blocks_on_hand = blocks_on_hand - ?, updated_at = datetime('now') WHERE id = ?")
          .bind(blocks_consumed, block_inventory_id),
        db.prepare("INSERT INTO block_consumption_log (id, block_inventory_id, job_id, blocks_consumed, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id, block_inventory_id, job_id, blocks_consumed, notes, now),
      ]);
      return json({ ok: true, data: { id, block_inventory_id, job_id, blocks_consumed, notes, created_at: now } }, 201);
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}


// =============================================================================
// HANDLER: /api/shipments  (GET / POST / PUT / DELETE)
// =============================================================================
