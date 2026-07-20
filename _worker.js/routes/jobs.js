import { json, logActivity, safeJsonParse } from '../lib/core.js';
import { reconcileCuttingSteps, mirrorProcessesToSteps, syncJobFromSteps } from '../lib/cutting.js';

export async function handleApiJobs(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  const url      = new URL(request.url);
  const parts    = url.pathname.split("/").filter(Boolean);
  const jobId    = parts.length >= 3 ? parts[2] : null;
  const subRoute = parts.length >= 4 ? parts[3] : null;

  // Columns returned in list responses — packing_slip_pdf is intentionally excluded (too large)
  const JOB_LIST_COLS = `
    j.id, j.status, j.customer, j.po_number, j.invoice_number, j.ship_date, j.ship_day,
    j.location, j.delivery_time, j.method, j.carrier, j.load_count, j.total_bdft,
    j.scrap_pickup, j.sales_lead, j.bol_info, j.payment_info, j.notes,
    j.packing_instructions, j.contact_name, j.contact_phone, j.combo_id,
    j.priority, j.priority_level, j.confirmed_to_ship, j.processes, j.created_at, j.updated_at,
    j.packing_slip_filename, j.packing_slip_invoice, j.source, j.ship_to_verified,
    j.ship_to_company, j.ship_to_attention, j.ship_to_street, j.ship_to_street2,
    j.ship_to_city, j.ship_to_state, j.ship_to_zip,
    CASE WHEN EXISTS (SELECT 1 FROM shipments s WHERE s.job_id = j.id AND s.direction = 'outbound') THEN 1 ELSE 0 END AS has_shipment,
    (SELECT GROUP_CONCAT(la.trailer_number, ', ')
       FROM loading_assignments la
      WHERE la.job_id = j.id
        AND COALESCE(la.trailer_number, '') != ''
        AND la.loading_status != 'archived') AS assigned_trailers,
    (SELECT la.loading_status
       FROM loading_assignments la
      WHERE la.job_id = j.id AND la.loading_status != 'archived'
      ORDER BY CASE la.loading_status
        WHEN 'loading' THEN 1 WHEN 'not_started' THEN 2 WHEN 'awaiting' THEN 3
        WHEN 'loaded' THEN 4 WHEN 'in_transit' THEN 5 WHEN 'delivered' THEN 6 ELSE 7 END
      LIMIT 1) AS loading_status_indicator
  `;

  // ── GET /api/jobs/:id/packing-slip ───────────────────────────────────────
  if (request.method === "GET" && jobId && subRoute === "packing-slip") {
    try {
      const row = await db
        .prepare("SELECT packing_slip_key, packing_slip_pdf, packing_slip_filename FROM jobs WHERE id = ?")
        .bind(jobId).first();
      if (!row) return json({ ok: false, error: "Job not found." }, 404);

      const filename = row.packing_slip_filename || "packing-slip.pdf";
      const disposition = `inline; filename="${filename.replace(/"/g, '')}"`;

      // Prefer R2 key; fall back to legacy base64 for un-backfilled rows
      if (row.packing_slip_key) {
        const obj = await env.BOL_PHOTOS.get(row.packing_slip_key);
        if (!obj) return json({ ok: false, error: "Packing slip not found in storage." }, 404);
        return new Response(obj.body, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": disposition,
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
      if (row.packing_slip_pdf) {
        const binary = Uint8Array.from(atob(row.packing_slip_pdf), c => c.charCodeAt(0));
        return new Response(binary, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": disposition,
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
      return json({ ok: false, error: "No packing slip attached to this job." }, 404);
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── GET /api/jobs/:id ─────────────────────────────────────────────────────
  if (request.method === "GET" && jobId) {
    try {
      const row = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first();
      if (!row) return json({ ok: false, error: "Job not found." }, 404);
      const liResult = await db
        .prepare("SELECT * FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC")
        .bind(jobId).all();
      return json({
        ok:  true,
        job: {
          ...row,
          processes: safeJsonParse(row.processes, []),
          ship_to_standardized: row.ship_to_standardized ? safeJsonParse(row.ship_to_standardized, null) : null,
          line_items: liResult.results || [],
        },
      });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── GET ──────────────────────────────────────────────────────────────────
  if (request.method === "GET") {
    // Cleanup-on-read: auto-archive abandoned jobs (real ship date >14 days old, not shipped or
    // actively loading). Pages Advanced Mode has no cron, so this mirrors the saved-loads
    // TTL-on-read pattern to keep active-job counts bounded. Best-effort — a sweep failure must
    // never break the board. Idempotent: a no-op write when nothing is newly stale.
    try {
      await db.prepare(
        `UPDATE jobs SET status = 'archived', updated_at = ?
         WHERE status NOT IN ('archived','shipped','loading')
           AND ship_date IS NOT NULL AND ship_date <> ''
           AND ship_date < date('now','-14 days')`
      ).bind(new Date().toISOString()).run();
    } catch (e) {
      console.error("stale-job auto-archive sweep failed:", e);
    }

    const searchParam    = (url.searchParams.get("search") || "").trim();
    const weekParam      = (url.searchParams.get("week")   || "").trim();
    const statusParam    = (url.searchParams.get("status") || "").trim();
    const includeArchived = url.searchParams.get("include_archived") === "1";
    const limitParam     = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 500);

    let query, binds;

    if (searchParam) {
      const like = `%${searchParam}%`;
      const archiveClause = includeArchived ? "" : " AND j.status != 'archived'";
      query = `SELECT ${JOB_LIST_COLS} FROM jobs j WHERE (j.customer LIKE ? OR j.po_number LIKE ? OR j.invoice_number LIKE ?)${archiveClause} ORDER BY j.ship_date DESC LIMIT ${limitParam}`;
      binds = [like, like, like];
    } else if (weekParam) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
        return json({ ok: false, error: "Invalid week. Use YYYY-MM-DD (Monday of week)." }, 400);
      }
      const archiveClause = includeArchived ? "" : " AND j.status != 'archived'";
      // Monday through Friday of the requested week
      query = `SELECT ${JOB_LIST_COLS} FROM jobs j WHERE j.ship_date >= ? AND j.ship_date <= date(?, '+4 days')${archiveClause} ORDER BY j.ship_date ASC, j.created_at ASC LIMIT ${limitParam}`;
      binds = [weekParam, weekParam];
    } else if (statusParam) {
      const statuses = statusParam.split(",").map(s => s.trim()).filter(Boolean);
      const valid    = ["not_started", "in_production", "done", "loading", "shipped"];
      for (const s of statuses) {
        if (!valid.includes(s)) return json({ ok: false, error: `Invalid status: ${s}` }, 400);
      }
      const placeholders = statuses.map(() => "?").join(",");
      query = `SELECT ${JOB_LIST_COLS} FROM jobs j WHERE j.status IN (${placeholders}) ORDER BY j.ship_date ASC, j.created_at ASC LIMIT ${limitParam}`;
      binds = statuses;
    } else if (includeArchived && !searchParam && !weekParam && !statusParam) {
      // All jobs including archived — for reports
      query = `SELECT ${JOB_LIST_COLS} FROM jobs j ORDER BY j.ship_date DESC LIMIT ${limitParam}`;
      binds = [];
    } else {
      // Default: all active + shipped in last 7 days, excluding archived unless requested
      const archiveClause = includeArchived ? "" : " AND j.status != 'archived'";
      query = `SELECT ${JOB_LIST_COLS} FROM jobs j WHERE (j.status != 'shipped' OR (j.status = 'shipped' AND j.ship_date >= date('now', '-7 days')))${archiveClause} ORDER BY j.ship_date ASC, j.created_at ASC LIMIT ${limitParam}`;
      binds = [];
    }

    try {
      const jobsResult = binds.length
        ? await db.prepare(query).bind(...binds).all()
        : await db.prepare(query).all();

      const jobs = jobsResult.results || [];

      // Batch-fetch line items for all returned jobs.
      // D1 caps bound parameters per statement, so chunk the id list. A single
      // IN (?, ?, …) with one ? per job 500'd ("too many SQL variables") once
      // the job count grew past the cap.
      const lineItemsMap = {};
      if (jobs.length > 0) {
        const ids = jobs.map(j => j.id);
        const CHUNK = 90;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          const ph    = slice.map(() => "?").join(",");
          const liResult = await db
            .prepare(`SELECT * FROM job_line_items WHERE job_id IN (${ph}) ORDER BY job_id, sort_order ASC`)
            .bind(...slice)
            .all();
          for (const item of (liResult.results || [])) {
            if (!lineItemsMap[item.job_id]) lineItemsMap[item.job_id] = [];
            lineItemsMap[item.job_id].push(item);
          }
        }
      }

      const enriched = jobs.map(job => ({
        ...job,
        processes:  safeJsonParse(job.processes, []),
        line_items: lineItemsMap[job.id] || [],
      }));

      return json({ ok: true, jobs: enriched });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (request.method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const customer = String(payload.customer || "").trim();
    if (!customer) return json({ ok: false, error: "Customer is required." }, 400);

    const ship_date = String(payload.ship_date || "").trim();
    if (ship_date && !/^\d{4}-\d{2}-\d{2}$/.test(ship_date)) {
      return json({ ok: false, error: "Invalid ship_date. Use YYYY-MM-DD." }, 400);
    }

    const validStatuses = ["not_started", "in_production", "done", "loading", "shipped"];
    const status = String(payload.status || "not_started").trim();
    if (!validStatuses.includes(status)) return json({ ok: false, error: "Invalid status." }, 400);

    const validPriorities = ["normal", "rush"];
    const priority = String(payload.priority || "normal").trim();
    if (!validPriorities.includes(priority)) return json({ ok: false, error: "Invalid priority." }, 400);

    const id  = crypto.randomUUID();
    const now = new Date().toISOString();

    const po_number            = String(payload.po_number            || "").trim();
    const invoice_number       = String(payload.invoice_number       || "").trim();
    const ship_day             = String(payload.ship_day             || "").trim();
    const location             = String(payload.location             || "").trim();
    const delivery_time        = String(payload.delivery_time        || "").trim();
    const method               = String(payload.method               || "").trim();
    const carrier              = String(payload.carrier              || "").trim();
    const scrap_pickup         = String(payload.scrap_pickup         || "").trim();
    const sales_lead           = String(payload.sales_lead           || "").trim();
    const bol_info             = String(payload.bol_info             || "").trim();
    const payment_info         = String(payload.payment_info         || "").trim();
    const notes                = String(payload.notes                || "").trim();
    const packing_instructions = String(payload.packing_instructions || "").trim();
    const contact_name         = String(payload.contact_name         || "").trim();
    const contact_phone        = String(payload.contact_phone        || "").trim();
    const ship_to_company      = String(payload.ship_to_company      || "").trim();
    const ship_to_attention    = String(payload.ship_to_attention    || "").trim();
    const ship_to_street       = String(payload.ship_to_street       || "").trim();
    const ship_to_street2      = String(payload.ship_to_street2      || "").trim();
    const ship_to_city         = String(payload.ship_to_city         || "").trim();
    const ship_to_state        = String(payload.ship_to_state        || "").trim();
    const ship_to_zip          = String(payload.ship_to_zip          || "").trim();
    const ship_to_verified     = String(payload.ship_to_verified     || "unverified").trim();
    const ship_to_standardized = payload.ship_to_standardized
      ? JSON.stringify(payload.ship_to_standardized) : null;
    const ship_to_verified_at  = payload.ship_to_verified_at ? String(payload.ship_to_verified_at) : null;
    const combo_id             = payload.combo_id ? String(payload.combo_id).trim() : null;
    const load_count           = Number.isFinite(Number(payload.load_count)) ? Number(payload.load_count) : 1;
    const total_bdft           = Number.isFinite(Number(payload.total_bdft)) ? Number(payload.total_bdft) : 0;
    const confirmed_to_ship    = payload.confirmed_to_ship ? 1 : 0;
    const processes            = Array.isArray(payload.processes) ? JSON.stringify(payload.processes) : '[]';

    // Packing slip fields (optional — present when job is created from an uploaded PDF)
    const packing_slip_filename = String(payload.packing_slip_filename || "").trim();
    const packing_slip_invoice  = String(payload.packing_slip_invoice  || "").trim();
    const source = ["manual", "packing_slip"].includes(String(payload.source || "").trim())
      ? String(payload.source).trim() : "manual";

    // Upload packing slip to R2 if present; on failure keep base64 in D1 so the slip isn't lost
    let packing_slip_pdf  = payload.packing_slip_pdf ? String(payload.packing_slip_pdf) : null;
    let packing_slip_key  = null;
    if (packing_slip_pdf) {
      try {
        const slipBytes = Uint8Array.from(atob(packing_slip_pdf), c => c.charCodeAt(0));
        const slipKey = `packing-slips/${id}.pdf`;
        await env.BOL_PHOTOS.put(slipKey, slipBytes, { httpMetadata: { contentType: 'application/pdf' } });
        packing_slip_key = slipKey;
        packing_slip_pdf = null; // cleared from D1 now that it's on R2
      } catch (e) {
        console.error('Packing slip R2 upload failed — keeping in D1:', String(e?.message || e));
        // packing_slip_pdf remains set; packing_slip_key stays null
      }
    }

    // Reject duplicate invoice numbers (also guards future QB auto-intake webhook re-fires).
    if (invoice_number) {
      const dupe = await db.prepare(
        "SELECT id FROM jobs WHERE invoice_number = ? AND status != 'archived' LIMIT 1"
      ).bind(invoice_number).first();
      if (dupe) {
        return json({ ok: false, error: `A job with invoice # ${invoice_number} already exists.`, code: 'duplicate_invoice' }, 409);
      }
    }

    try {
      await db.prepare(`
        INSERT INTO jobs (
          id, status, customer, po_number, invoice_number, ship_date, ship_day,
          location, delivery_time, method, carrier, load_count, total_bdft,
          scrap_pickup, sales_lead, bol_info, payment_info, notes,
          packing_instructions, contact_name, contact_phone, combo_id,
          priority, confirmed_to_ship, processes, created_at, updated_at,
          packing_slip_key, packing_slip_pdf, packing_slip_filename, packing_slip_invoice, source,
          ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
          ship_to_city, ship_to_state, ship_to_zip,
          ship_to_verified, ship_to_standardized, ship_to_verified_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id, status, customer, po_number, invoice_number, ship_date, ship_day,
        location, delivery_time, method, carrier, load_count, total_bdft,
        scrap_pickup, sales_lead, bol_info, payment_info, notes,
        packing_instructions, contact_name, contact_phone, combo_id,
        priority, confirmed_to_ship, processes, now, now,
        packing_slip_key, packing_slip_pdf, packing_slip_filename, packing_slip_invoice, source,
        ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
        ship_to_city, ship_to_state, ship_to_zip,
        ship_to_verified, ship_to_standardized, ship_to_verified_at,
      ).run();

      // Insert line items
      const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
      for (let i = 0; i < lineItems.length; i++) {
        const li = lineItems[i];
        await db.prepare(`
          INSERT INTO job_line_items (id, job_id, part_id, part_number, description, quantity, dimensions, sort_order)
          VALUES (?,?,?,?,?,?,?,?)
        `).bind(
          crypto.randomUUID(), id,
          li.part_id ? String(li.part_id).trim() : null,
          String(li.part_number || "").trim(),
          String(li.description || "").trim(),
          Number.isFinite(Number(li.quantity)) ? Number(li.quantity) : 0,
          String(li.dimensions  || "").trim(),
          i,
        ).run();
      }

      // Auto-create outbound shipment
      try {
        const shipmentId = crypto.randomUUID();
        await db.prepare(`
          INSERT INTO shipments
            (id, direction, job_id, customer, carrier, method, bol_number, origin,
             destination, ship_date, status, total_bdft, load_count,
             weight_lbs, bead_type, notes, trailer_number)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          shipmentId, 'outbound', id,
          customer,
          carrier || '',
          method  || '',
          '',
          'XPanda Foam',
          location || '',
          ship_date || '',
          'not_started',
          total_bdft,
          load_count,
          0,
          '',
          '',
          '',
        ).run();
      } catch (e) {
        console.error('Auto-shipment creation failed:', String(e?.message || e));
      }

      // Auto-create loading assignment (customer pickup jobs skip the bay queue)
      if ((method || '').toLowerCase() !== 'customer pickup') {
        try {
          const loadCount = Math.max(load_count || 1, 1);
          const now2 = new Date().toISOString();
          for (let n = 1; n <= loadCount; n++) {
            const laId = crypto.randomUUID();
            await db.prepare(`
              INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
              VALUES (?, ?, NULL, '', 'awaiting', NULL, '', ?, ?, ?)
            `).bind(laId, id, n, now2, now2).run();
          }
        } catch (e) {
          console.error('Auto-create loading assignment on job create failed:', String(e?.message || e));
        }
      }

      // Auto-create cutting steps from processes (non-blocking)
      try {
        await reconcileCuttingSteps(db, id, payload.processes || []);
      } catch (e) {
        console.error('Auto-create cutting steps on job create failed:', String(e?.message || e));
      }

      const job    = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
      const liRows = await db.prepare("SELECT * FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC").bind(id).all();

      await logActivity(db, 'create', 'job', id,
        `Created job "${customer}" — ${lineItems.length} line items`,
        { customer, status, po_number, line_items_count: lineItems.length }
      );
      return json({ ok: true, message: "Job created.", job: { ...job, has_shipment: true, processes: safeJsonParse(job.processes, []), line_items: liRows.results || [] } }, 201);
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── PUT ──────────────────────────────────────────────────────────────────
  if (request.method === "PUT") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db.prepare("SELECT id FROM jobs WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Job not found." }, 404);

    const sets  = [];
    const binds = [];

    if ("status" in payload) {
      const v = String(payload.status).trim();
      if (!["not_started", "in_production", "done", "loading", "shipped", "archived"].includes(v))
        return json({ ok: false, error: "Invalid status." }, 400);
      sets.push("status = ?"); binds.push(v);
    }

    if ("priority" in payload) {
      const v = String(payload.priority).trim();
      if (!["normal", "rush"].includes(v))
        return json({ ok: false, error: "Invalid priority." }, 400);
      sets.push("priority = ?"); binds.push(v);
    }

    if ("priority_level" in payload) {
      const n = Number(payload.priority_level);
      if (!Number.isInteger(n) || n < 0 || n > 3)
        return json({ ok: false, error: "Invalid priority level." }, 400);
      sets.push("priority_level = ?"); binds.push(n);
    }

    const textFields = [
      "customer", "po_number", "invoice_number", "ship_date", "ship_day",
      "location", "delivery_time", "method", "carrier", "scrap_pickup",
      "sales_lead", "bol_info", "payment_info", "notes",
      "packing_instructions", "contact_name", "contact_phone",
      "packing_slip_filename", "packing_slip_invoice",
      "ship_to_company", "ship_to_attention", "ship_to_street", "ship_to_street2",
      "ship_to_city", "ship_to_state", "ship_to_zip",
      "ship_to_verified", "ship_to_verified_at",
    ];
    for (const f of textFields) {
      if (f in payload) { sets.push(`${f} = ?`); binds.push(String(payload[f] || "").trim()); }
    }

    if ("ship_to_standardized" in payload) {
      const v = payload.ship_to_standardized ? JSON.stringify(payload.ship_to_standardized) : null;
      sets.push("ship_to_standardized = ?"); binds.push(v);
    }

    if ("load_count"        in payload) { sets.push("load_count = ?");        binds.push(Number.isFinite(Number(payload.load_count)) ? Number(payload.load_count) : 1); }
    if ("total_bdft"        in payload) { sets.push("total_bdft = ?");        binds.push(Number.isFinite(Number(payload.total_bdft)) ? Number(payload.total_bdft) : 0); }
    if ("confirmed_to_ship" in payload) { sets.push("confirmed_to_ship = ?"); binds.push(payload.confirmed_to_ship ? 1 : 0); }
    if ("combo_id"  in payload) { sets.push("combo_id = ?");  binds.push(payload.combo_id ? String(payload.combo_id).trim() : null); }
    if ("processes" in payload) {
      const v = Array.isArray(payload.processes) ? JSON.stringify(payload.processes) : '[]';
      sets.push("processes = ?"); binds.push(v);
    }
    if ("source" in payload) {
      const v = String(payload.source).trim();
      if (!["manual", "packing_slip"].includes(v))
        return json({ ok: false, error: "Invalid source." }, 400);
      sets.push("source = ?"); binds.push(v);
    }
    // packing_slip_pdf: try R2 upload; fall back to D1 base64 if R2 fails; null to clear
    if ("packing_slip_pdf" in payload) {
      if (payload.packing_slip_pdf) {
        let uploadedKey = null;
        try {
          const slipBytes = Uint8Array.from(atob(String(payload.packing_slip_pdf)), c => c.charCodeAt(0));
          const slipKey = `packing-slips/${id}.pdf`;
          await env.BOL_PHOTOS.put(slipKey, slipBytes, { httpMetadata: { contentType: 'application/pdf' } });
          uploadedKey = slipKey;
        } catch (e) {
          console.error('Packing slip R2 upload failed on PUT — keeping in D1:', String(e?.message || e));
        }
        if (uploadedKey) {
          sets.push("packing_slip_key = ?"); binds.push(uploadedKey);
          sets.push("packing_slip_pdf = ?"); binds.push(null);
        } else {
          sets.push("packing_slip_pdf = ?"); binds.push(String(payload.packing_slip_pdf));
        }
      } else {
        // Explicit clear
        sets.push("packing_slip_pdf = ?"); binds.push(null);
        sets.push("packing_slip_key = ?"); binds.push(null);
      }
    }

    sets.push("updated_at = ?");
    binds.push(new Date().toISOString());
    binds.push(id); // WHERE clause value

    try {
      await db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

      // Replace line items if provided
      if (Array.isArray(payload.line_items)) {
        await db.prepare("DELETE FROM job_line_items WHERE job_id = ?").bind(id).run();
        for (let i = 0; i < payload.line_items.length; i++) {
          const li = payload.line_items[i];
          await db.prepare(`
            INSERT INTO job_line_items (id, job_id, part_id, part_number, description, quantity, dimensions, sort_order)
            VALUES (?,?,?,?,?,?,?,?)
          `).bind(
            crypto.randomUUID(), id,
            li.part_id ? String(li.part_id).trim() : null,
            String(li.part_number || "").trim(),
            String(li.description || "").trim(),
            Number.isFinite(Number(li.quantity)) ? Number(li.quantity) : 0,
            String(li.dimensions  || "").trim(),
            i,
          ).run();
        }
      }

      // Reconcile loading_assignments to the new load_count (only when load_count changed).
      if ("load_count" in payload) {
        try {
          const reconRow = await db.prepare("SELECT load_count, method FROM jobs WHERE id = ?").bind(id).first();
          const isPickup = (reconRow?.method || '').toLowerCase() === 'customer pickup';
          if (reconRow && !isPickup) {
            const target  = Math.max(Number(reconRow.load_count) || 1, 1);
            const curRow  = await db.prepare(
              "SELECT COUNT(*) AS cnt FROM loading_assignments WHERE job_id = ? AND loading_status != 'archived'"
            ).bind(id).first();
            const current = Number(curRow?.cnt || 0);

            if (target > current) {
              const nowR = new Date().toISOString();
              for (let n = current + 1; n <= target; n++) {
                await db.prepare(`
                  INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
                  VALUES (?, ?, NULL, '', 'awaiting', NULL, '', ?, ?, ?)
                `).bind(crypto.randomUUID(), id, n, nowR, nowR).run();
              }
            } else if (target < current) {
              // Drop only surplus, safe cards: unbayed, untrailered, awaiting, no photos.
              const surplus = current - target;
              const safe = await db.prepare(`
                SELECT la.id FROM loading_assignments la
                 WHERE la.job_id = ?
                   AND la.loading_status = 'awaiting'
                   AND la.bay_id IS NULL
                   AND COALESCE(la.trailer_number, '') = ''
                   AND NOT EXISTS (SELECT 1 FROM loading_photos lp WHERE lp.assignment_id = la.id)
                 ORDER BY la.load_number DESC, la.created_at DESC
                 LIMIT ?
              `).bind(id, surplus).all();
              for (const r of (safe?.results || [])) {
                await db.prepare("DELETE FROM loading_assignments WHERE id = ?").bind(r.id).run();
              }
            }
          }
        } catch (e) {
          console.error('Load count reconcile failed:', String(e?.message || e));
        }
      }

      // Reconcile cutting steps + bidirectional pill↔step sync (non-blocking)
      if ("processes" in payload) {
        try {
          await reconcileCuttingSteps(db, id, payload.processes);
          await mirrorProcessesToSteps(db, id, payload.processes);
          await syncJobFromSteps(db, id);
        } catch (e) {
          console.error('Cutting steps reconcile/sync failed on PUT:', String(e?.message || e));
        }
      }

      const job    = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
      const liRows = await db.prepare("SELECT * FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC").bind(id).all();

      // Sync job status to linked shipment
      if (payload.status) {
        const JOB_TO_SHIPMENT_STATUS = {
          not_started:  'not_started',
          in_production: 'in_production',
          done:         'ready_to_ship',
        };
        const mappedStatus = JOB_TO_SHIPMENT_STATUS[payload.status];
        if (mappedStatus) {
          try {
            const shipment = await db.prepare(
              "SELECT id FROM shipments WHERE job_id = ? AND direction = 'outbound' LIMIT 1"
            ).bind(id).first();
            if (shipment) {
              await db.prepare(
                "UPDATE shipments SET status = ?, updated_at = datetime('now') WHERE id = ?"
              ).bind(mappedStatus, shipment.id).run();
            }
          } catch (e) {
            console.error('Job→Shipment status sync failed:', e);
          }
        }
      }

      // Sync editable fields to linked shipment
      const SYNC_FIELDS_JOB_TO_SHIPMENT = {
        customer:   'customer',
        carrier:    'carrier',
        method:     'method',
        ship_date:  'ship_date',
        location:   'destination',
        total_bdft: 'total_bdft',
        load_count: 'load_count',
      };

      const syncSets = [];
      const syncBinds = [];
      for (const [jobField, shipField] of Object.entries(SYNC_FIELDS_JOB_TO_SHIPMENT)) {
        if (jobField in payload) {
          syncSets.push(`${shipField} = ?`);
          if (['total_bdft', 'load_count'].includes(jobField)) {
            syncBinds.push(Number(payload[jobField]) || 0);
          } else {
            syncBinds.push(String(payload[jobField] || '').trim());
          }
        }
      }

      if (syncSets.length > 0) {
        try {
          const shipment = await db.prepare(
            "SELECT id FROM shipments WHERE job_id = ? AND direction = 'outbound' LIMIT 1"
          ).bind(id).first();
          if (shipment) {
            syncSets.push("updated_at = datetime('now')");
            syncBinds.push(shipment.id);
            await db.prepare(`UPDATE shipments SET ${syncSets.join(', ')} WHERE id = ?`).bind(...syncBinds).run();
          }
        } catch (e) {
          console.error('Job→Shipment field sync failed:', e);
        }
      }

      await logActivity(db, 'update', 'job', id,
        `Updated job "${payload.customer || ''}" — status: ${payload.status || ''}`,
        { fields_updated: Object.keys(payload).filter(k => k !== 'id') }
      );
      return json({ ok: true, message: "Job updated.", job: { ...job, processes: safeJsonParse(job.processes, []), line_items: liRows.results || [] } });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (request.method === "DELETE") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db.prepare("SELECT id FROM jobs WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Job not found." }, 404);

    try {
      // Delete workflow children in child→parent order before deleting the job.
      // Deliberately NOT deleting block_consumption_log — those rows are inventory
      // accounting records; removing them would corrupt production yield history.
      await db.prepare("DELETE FROM loading_photos WHERE job_id = ?").bind(id).run();
      await db.prepare("DELETE FROM loading_assignments WHERE job_id = ?").bind(id).run();
      await db.prepare("DELETE FROM cutting_steps WHERE job_id = ?").bind(id).run();
      await db.prepare("DELETE FROM bols WHERE job_id = ?").bind(id).run();
      await db.prepare("DELETE FROM saved_loads WHERE job_id = ?").bind(id).run();
      await db.prepare("DELETE FROM shipments WHERE job_id = ?").bind(id).run();
      await db.prepare("DELETE FROM job_line_items WHERE job_id = ?").bind(id).run();
      await db.prepare("DELETE FROM jobs WHERE id = ?").bind(id).run();
      await logActivity(db, 'delete', 'job', id, `Deleted job ${id}`, { id });
      return json({ ok: true, message: "Job deleted." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}


// =============================================================================
// HANDLER: /api/address/validate  (POST) — Lob US Verifications (CASS standardize)
// =============================================================================

export async function handleApiAddressValidate(request, env) {
  if (!env.LOB_API_KEY) return json({ ok: false, error: 'LOB_API_KEY not configured' }, 500);

  let payload;
  try { payload = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const street  = String(payload.street  || "").trim();
  const street2 = String(payload.street2 || "").trim();
  const city    = String(payload.city    || "").trim();
  const state   = String(payload.state   || "").trim();
  const zip     = String(payload.zip     || "").trim();
  const db      = env.DB;

  let status, standardized = null, deliverability = null, reason = null, errorDetail = null;

  const keyMode = env.LOB_API_KEY.startsWith('test_') ? 'test'
    : env.LOB_API_KEY.startsWith('live_') ? 'live'
    : 'unknown';

  try {
    const form = new URLSearchParams();
    form.set('primary_line', street);
    if (street2) form.set('secondary_line', street2);
    form.set('city', city);
    form.set('state', state);
    form.set('zip_code', zip);

    const resp = await fetch('https://api.lob.com/v1/us_verifications', {
      method: 'POST',
      headers: {
        Authorization:  `Basic ${btoa(env.LOB_API_KEY + ':')}`,
        Accept:         'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    if (!resp.ok) throw new Error(`Lob ${resp.status}: ${await resp.text()}`);

    const lob = await resp.json();
    deliverability = lob.deliverability;

    if (deliverability === 'undeliverable' || deliverability === 'no_match') {
      status = 'unverifiable';
    } else {
      const components = lob.components || {};
      standardized = {
        street:  lob.primary_line   || '',
        street2: lob.secondary_line || '',
        city:    components.city            || '',
        state:   components.state           || '',
        zip:     components.zip_code        || '',
        zip4:    components.zip_code_plus_4 || '',
      };
      const norm = (s) => String(s || '').trim().toLowerCase();
      const isExact =
        norm(standardized.street)  === norm(street)  &&
        norm(standardized.street2) === norm(street2) &&
        norm(standardized.city)    === norm(city)    &&
        norm(standardized.state)   === norm(state)   &&
        norm(standardized.zip)     === norm(zip);
      status = isExact ? 'verified' : 'corrected';
    }
  } catch (e) {
    console.error('Address validation (Lob) error — never blocks entry:', String(e?.message || e));
    status = 'unverifiable';
    reason = 'lob_error';
    errorDetail = String(e?.message || e).slice(0, 500);
  }

  if (db) {
    await logActivity(db, 'validate', 'address', null, `Address ${status}`,
      { city, state, zip, deliverability, reason, key_mode: keyMode, error_detail: errorDetail });
  }

  return json({ ok: true, data: { status, standardized, deliverability, reason, error_detail: errorDetail, key_mode: keyMode } });
}


// =============================================================================
// HANDLER: /api/bead-types  (GET / POST / PUT / DELETE)
// =============================================================================

export async function handleApiShipments(request, env) {
  const db     = env.DB;
  const method = request.method.toUpperCase();
  const url    = new URL(request.url);

  if (method === "GET") {
    const direction = url.searchParams.get("direction");
    const status    = url.searchParams.get("status");
    const jobId     = url.searchParams.get("job_id");
    const days      = parseInt(url.searchParams.get("days") || "30", 10);
    const week      = url.searchParams.get("week"); // YYYY-MM-DD of week start (Mon)

    const where = [];
    const vals  = [];

    if (week) {
      // week window: Mon through Sun (+6 days)
      where.push("ship_date >= ? AND ship_date <= date(?, '+6 days')");
      vals.push(week, week);
    } else {
      where.push("created_at >= datetime('now', ? || ' days')");
      vals.push(`-${days}`);
    }

    if (direction) { where.push("direction = ?"); vals.push(direction); }

    if (status) {
      const statuses = status.split(",").map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        where.push("status = ?");
        vals.push(statuses[0]);
      } else if (statuses.length > 1) {
        where.push(`status IN (${statuses.map(() => "?").join(",")})`);
        vals.push(...statuses);
      }
    }

    if (jobId) { where.push("job_id = ?"); vals.push(jobId); }

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    try {
      const { results } = await db.prepare(
        `SELECT *, (SELECT COUNT(*) FROM bols b WHERE b.job_id = shipments.job_id) AS bol_count FROM shipments ${clause} ORDER BY ship_date DESC, created_at DESC`
      ).bind(...vals).all();
      return json({ ok: true, data: results });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const direction = String(payload.direction || "").trim();
    if (!["inbound", "outbound"].includes(direction)) {
      return json({ ok: false, error: "direction must be 'inbound' or 'outbound'." }, 400);
    }

    const ship_date = String(payload.ship_date || "").trim();
    if (ship_date && !/^\d{4}-\d{2}-\d{2}$/.test(ship_date)) {
      return json({ ok: false, error: "ship_date must be YYYY-MM-DD." }, 400);
    }

    const validStatuses = ["awaiting", "not_started", "in_production", "ready_to_ship", "loading", "loaded", "in_transit", "delivered", "cancelled", "scheduled"];
    const status = String(payload.status || "awaiting").trim();
    if (!validStatuses.includes(status)) {
      return json({ ok: false, error: `status must be one of: ${validStatuses.join(", ")}` }, 400);
    }

    const id            = crypto.randomUUID();
    const job_id        = payload.job_id        ? String(payload.job_id).trim()        : null;
    const customer      = String(payload.customer      || "").trim();
    const carrier       = String(payload.carrier       || "").trim();
    const method_val    = String(payload.method        || "").trim();
    const bol_number    = String(payload.bol_number    || "").trim();
    const origin        = String(payload.origin        || "").trim();
    const destination   = String(payload.destination   || "").trim();
    const total_bdft    = Number(payload.total_bdft    ?? 0);
    const load_count    = Math.max(1, parseInt(payload.load_count ?? 1, 10));
    const weight_lbs    = Number(payload.weight_lbs    ?? 0);
    const bead_type     = String(payload.bead_type     || "").trim();
    const notes         = String(payload.notes         || "").trim();
    const trailer_number = String(payload.trailer_number || "").trim();
    const delivery_incident       = payload.delivery_incident ? 1 : 0;
    const delivery_incident_notes = String(payload.delivery_incident_notes || "").trim();

    try {
      await db.prepare(`
        INSERT INTO shipments
          (id, direction, job_id, customer, carrier, method, bol_number, origin, destination,
           ship_date, status, total_bdft, load_count, weight_lbs, bead_type, notes, trailer_number,
           delivery_incident, delivery_incident_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, direction, job_id, customer, carrier, method_val, bol_number, origin, destination,
        ship_date, status, total_bdft, load_count, weight_lbs, bead_type, notes, trailer_number,
        delivery_incident, delivery_incident_notes
      ).run();

      // Auto-create bead receive transaction if inbound with silo
      if (direction === "inbound" && weight_lbs > 0 && payload.silo_id) {
        const siloId = String(payload.silo_id).trim();
        const silo   = await db.prepare("SELECT * FROM silos WHERE id = ?").bind(siloId).first();
        if (silo) {
          const beadTypeId = payload.bead_type_id ? String(payload.bead_type_id).trim() : silo.bead_type_id;
          const newLevel   = silo.current_lbs + weight_lbs;
          const txId       = crypto.randomUUID();
          await db.batch([
            db.prepare("UPDATE silos SET current_lbs = ?, updated_at = datetime('now') WHERE id = ?")
              .bind(newLevel, siloId),
            db.prepare(`
              INSERT INTO bead_transactions (id, silo_id, bead_type_id, type, quantity_lbs, reference, notes)
              VALUES (?, ?, ?, 'receive', ?, ?, ?)
            `).bind(txId, siloId, beadTypeId, weight_lbs, bol_number || id, `Auto-logged from inbound shipment ${id}`),
          ]);
        }
      }

      const row = await db.prepare("SELECT * FROM shipments WHERE id = ?").bind(id).first();
      await logActivity(db, 'create', 'shipment', id,
        `Created shipment for ${customer} — ${direction} ${status}`,
        { customer, direction, status, ship_date }
      );
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

    const existing = await db.prepare("SELECT id FROM shipments WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Shipment not found." }, 404);

    const allowed = [
      "customer", "carrier", "method", "bol_number", "origin", "destination",
      "ship_date", "status", "total_bdft", "load_count",
      "weight_lbs", "bead_type", "notes", "job_id", "trailer_number",
      "delivery_incident", "delivery_incident_notes",
    ];
    const sets = [];
    const vals = [];

    for (const key of allowed) {
      if (!(key in payload)) continue;
      sets.push(`${key} = ?`);
      const raw = payload[key];
      if (key === "job_id") {
        vals.push(raw ? String(raw).trim() : null);
      } else if (key === "delivery_incident") {
        vals.push(raw ? 1 : 0);
      } else if (["total_bdft", "weight_lbs"].includes(key)) {
        vals.push(Number(raw ?? 0));
      } else if (key === "load_count") {
        vals.push(Math.max(1, parseInt(raw ?? 1, 10)));
      } else {
        vals.push(String(raw ?? "").trim());
      }
    }

    if (sets.length === 0) return json({ ok: false, error: "No fields to update." }, 400);

    sets.push("updated_at = datetime('now')");
    vals.push(id);

    try {
      await db.prepare(`UPDATE shipments SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
      const row = await db.prepare("SELECT * FROM shipments WHERE id = ?").bind(id).first();

      // Reverse write-through: logistics dashboard status change → job + loading_assignments
      if (payload.status && row.job_id) {
        const SHIPMENT_TO_JOB_STATUS = {
          not_started:   'not_started',
          in_production: 'in_production',
          ready_to_ship: 'done',
          awaiting:      'loading',
          loading:       'loading',
          loaded:        'loading',
          in_transit:    'shipped',
          delivered:     'shipped',
        };
        const mappedJobStatus = SHIPMENT_TO_JOB_STATUS[payload.status];

        let jobRow = null;
        try {
          jobRow = await db.prepare("SELECT status, method FROM jobs WHERE id = ?").bind(row.job_id).first();
        } catch (e) {
          console.error('Shipment→Job lookup failed:', e);
        }

        if (mappedJobStatus && jobRow && jobRow.status !== mappedJobStatus) {
          try {
            await db.prepare(
              "UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?"
            ).bind(mappedJobStatus, row.job_id).run();
          } catch (e) {
            console.error('Shipment→Job status sync failed:', e);
          }
        }

        // Mirror active loading-stage + transit statuses directly to loading_assignments
        // (same pattern as the driver QR flow). loading/loaded keep the cards in sync when a
        // manager advances status from the logistics dashboard instead of the loading board.
        if (['loading', 'loaded', 'in_transit', 'delivered'].includes(payload.status)) {
          try {
            const nowSync = new Date().toISOString();
            await db.prepare(
              "UPDATE loading_assignments SET loading_status = ?, updated_at = ? WHERE job_id = ? AND loading_status != 'archived'"
            ).bind(payload.status, nowSync, row.job_id).run();
          } catch (e) {
            console.error('Shipment→LoadingAssignment status sync failed:', e);
          }
        }

        // Re-queue: pulling back to ready_to_ship returns non-pickup card to awaiting queue
        if (payload.status === 'ready_to_ship' && jobRow && (jobRow.method || '').toLowerCase() !== 'customer pickup') {
          try {
            const nowReq = new Date().toISOString();
            await db.prepare(
              "UPDATE loading_assignments SET loading_status = 'awaiting', bay_id = NULL, updated_at = ? WHERE job_id = ? AND loading_status != 'archived'"
            ).bind(nowReq, row.job_id).run();
          } catch (e) {
            console.error('Shipment→LoadingAssignment re-queue failed:', e);
          }
        }
      }

      await logActivity(db, 'update', 'shipment', id,
        `Updated shipment ${id} — status: ${payload.status || ''}`,
        { fields_updated: Object.keys(payload).filter(k => k !== 'id') }
      );
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

    const existing = await db.prepare("SELECT id FROM shipments WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Shipment not found." }, 404);

    try {
      await db.prepare("DELETE FROM shipments WHERE id = ?").bind(id).run();
      await logActivity(db, 'delete', 'shipment', id, `Deleted shipment ${id}`, { id });
      return json({ ok: true, message: "Shipment deleted." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}


