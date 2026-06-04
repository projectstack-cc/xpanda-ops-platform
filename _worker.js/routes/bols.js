import { json, logActivity, generateAccessToken } from '../lib/core.js';

export async function handleApiBolCustomers(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);
  const method = request.method;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (method === "GET") {
    const url         = new URL(request.url);
    const search      = (url.searchParams.get("search") || "").trim();
    const activeParam = url.searchParams.get("active");

    let query   = "SELECT * FROM bol_customers";
    const conds = [];
    const binds = [];

    if (activeParam !== "0") { conds.push("is_active = 1"); }
    if (search) {
      conds.push("(company LIKE ? OR attention LIKE ? OR city LIKE ?)");
      binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (conds.length) query += " WHERE " + conds.join(" AND ");
    query += " ORDER BY company ASC";

    try {
      const result = binds.length
        ? await db.prepare(query).bind(...binds).all()
        : await db.prepare(query).all();
      return json({ ok: true, customers: result.results || [] });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const company = String(payload.company || "").trim();
    if (!company) return json({ ok: false, error: "company is required." }, 400);

    const id           = crypto.randomUUID();
    const now          = new Date().toISOString();
    const attention    = String(payload.attention    || "").trim();
    const street       = String(payload.street       || "").trim();
    const street2      = String(payload.street2      || "").trim();
    const city         = String(payload.city         || "").trim();
    const state        = String(payload.state        || "").trim();
    const zip          = String(payload.zip          || "").trim();
    const phone        = String(payload.phone        || "").trim();
    const email        = String(payload.email        || "").trim();
    const contact_name = String(payload.contact_name || "").trim();
    const notes        = String(payload.notes        || "").trim();

    try {
      await db.prepare(`
        INSERT INTO bol_customers
          (id, company, attention, street, street2, city, state, zip, phone, email, contact_name, notes, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(id, company, attention, street, street2, city, state, zip, phone, email, contact_name, notes, now, now).run();
      const row = await db.prepare("SELECT * FROM bol_customers WHERE id = ?").bind(id).first();
      await logActivity(db, 'create', 'bol_customer', id,
        `Created customer "${company}"`,
        { company, city, state }
      );
      return json({ ok: true, customer: row }, 201);
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── PUT ──────────────────────────────────────────────────────────────────
  if (method === "PUT") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db.prepare("SELECT id FROM bol_customers WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Customer not found." }, 404);

    const textFields = ["company","attention","street","street2","city","state","zip","phone","email","contact_name","notes"];
    const sets = [], binds = [];
    for (const f of textFields) {
      if (f in payload) { sets.push(`${f} = ?`); binds.push(String(payload[f] || "").trim()); }
    }
    if ("is_active" in payload) { sets.push("is_active = ?"); binds.push(payload.is_active ? 1 : 0); }

    if (sets.length === 0) return json({ ok: false, error: "No fields to update." }, 400);

    sets.push("updated_at = ?");
    binds.push(new Date().toISOString(), id);

    try {
      await db.prepare(`UPDATE bol_customers SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
      const row = await db.prepare("SELECT * FROM bol_customers WHERE id = ?").bind(id).first();
      await logActivity(db, 'update', 'bol_customer', id,
        `Updated customer "${payload.company || id}"`,
        { fields_updated: Object.keys(payload).filter(k => k !== 'id') }
      );
      return json({ ok: true, customer: row });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── DELETE (soft) ─────────────────────────────────────────────────────────
  if (method === "DELETE") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || "").trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    try {
      await db.prepare("UPDATE bol_customers SET is_active = 0, updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), id).run();
      await logActivity(db, 'delete', 'bol_customer', id, `Deleted customer ${id}`, { id });
      return json({ ok: true, message: "Customer deactivated." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

export async function handleApiBolCustomersSeed(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405);
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  const existing = await db.prepare("SELECT COUNT(*) as cnt FROM bol_customers").first();
  if (existing && existing.cnt > 0) {
    return json({ ok: false, error: "Seed already applied — table is not empty." });
  }

  const SEED = [
    { company: "ABC Supply - Dunnellon #497",         attention: "",                      street: "7975 W. Grover Cleveland Blvd.",          city: "Homosassa",       state: "FL", zip: "34446", contact_name: "Austin",           phone: "352-564-8319" },
    { company: "AF Barriers",                          attention: "Attn: Scott Fullerton", street: "4455 18th St. East",                      city: "Bradenton",       state: "FL", zip: "34203", contact_name: "Kody Deiter",      phone: "941-584-3906" },
    { company: "All Florida Weatherproofing",          attention: "Attn: Rick Fulford",    street: "4231 112th Terrace North",                city: "Clearwater",      state: "FL", zip: "33762", contact_name: "Rick",             phone: "352-702-5052" },
    { company: "Accusolar",                            attention: "Attn: Trish Nicholson", street: "1800 SW 13th Ct.",                        city: "Pompano Beach",   state: "FL", zip: "33069", contact_name: "Trish Nicholson",  phone: "954-785-7557" },
    { company: "Accudock",                             attention: "Attn: PM Nicholson",    street: "1790 SW 13th Ct.",                        city: "Pompano Beach",   state: "FL", zip: "33069", contact_name: "Trish Nicholson",  phone: "954-785-7557" },
    { company: "Alumflo Inc.",                         attention: "Attn: Mark Daniel",     street: "2445 51st. Ave. N",                       city: "St. Petersburg",  state: "FL", zip: "33714", contact_name: "Mark Daniel",      phone: "" },
    { company: "Architechtural Foam Fab, LLC",         attention: "",                      street: "8360 Currency Dr., Ste 2",                city: "West Palm Beach", state: "FL", zip: "33404", contact_name: "",                 phone: "" },
    { company: "Atlantic Packaging Corp.",             attention: "Attn: Ken Thorpe",      street: "5301 W 5th St., Ste 1",                   city: "Jacksonville",    state: "FL", zip: "32254", contact_name: "Ken Thorpe",       phone: "904-409-3560" },
    { company: "BMMI",                                 attention: "Attn: Scott Reed",      street: "8210 Manasota Key Rd.",                   city: "Englewood",       state: "FL", zip: "34223", contact_name: "Kyle",             phone: "863-990-8347" },
    { company: "Bellingham Marine",                    attention: "Attn: Josh Hebert",     street: "2014 Dennis St.",                         city: "Jacksonville",    state: "FL", zip: "32204", contact_name: "Josh Hebert",      phone: "" },
    { company: "CG3 - Victory Mgmt. Sol. Inc.",        attention: "Attn: Enrique Aranda",  street: "2423 Ryan Blvd",                          city: "Punta Gorda",     state: "FL", zip: "33950", contact_name: "Enrique Aranda",   phone: "305-803-2256" },
    { company: "Prestige Spa Covers (CORE)",           attention: "Attn: Charline Fisher", street: "2875 MCI Dr.",                            city: "Pinellas Park",   state: "FL", zip: "33782", contact_name: "Charline Fisher",  phone: "" },
    { company: "Collis Roofing, Inc.",                 attention: "",                      street: "485 Commerce Way",                        city: "Longwood",        state: "FL", zip: "32750", contact_name: "",                 phone: "" },
    { company: "Comfort Cover Systems Inc.",           attention: "",                      street: "711 Turner St.",                          city: "Clearwater",      state: "FL", zip: "33756", contact_name: "Bob",              phone: "727-298-0955" },
    { company: "Community Roofing",                    attention: "Attn: Joe Perrini",     street: "14042 66th Street",                       city: "Largo",           state: "FL", zip: "33771", contact_name: "Joe Perrini",      phone: "352-410-0548" },
    { company: "Coolstructures Inc.",                  attention: "",                      street: "7173 Gasparilla Rd.",                     city: "Port Charlotte",  state: "FL", zip: "33981", contact_name: "Al",               phone: "855-220-0240" },
    { company: "Crown Packaging",                      attention: "",                      street: "2716 Hazelhurst Ave.",                    city: "Orlando",         state: "FL", zip: "32804", contact_name: "",                 phone: "" },
    { company: "Diversitech",                          attention: "Attn: Daniel Dees",     street: "1632 3rd St.",                            city: "Leesburg",        state: "FL", zip: "34748", contact_name: "Daniel Dees",      phone: "352-530-4930" },
    { company: "Foam World, LLC",                      attention: "Attn: Devin Angels",    street: "3591 Work Dr. Bldg. B",                   city: "Fort Myers",      state: "FL", zip: "33916", contact_name: "Devin Angels",     phone: "" },
    { company: "Gulfeagle Supply - #002",              attention: "",                      street: "2649 Rosselle St.",                       city: "Jacksonville",    state: "FL", zip: "32204", contact_name: "",                 phone: "" },
    { company: "John Abell Corp.",                     attention: "attn: Jesus Quintana",  street: "10500 SW 186 ST.",                        city: "Miami",           state: "FL", zip: "33157", contact_name: "Jesus Quintana",   phone: "" },
    { company: "Lansing Building Products - Ocala",    attention: "",                      street: "5371 SE Maricamp Rd.",                    city: "Ocala",           state: "FL", zip: "34480", contact_name: "",                 phone: "" },
    { company: "Lion TB Construction",                 attention: "Attn: Sam Kazmarek",    street: "10020 US Hwy 301 N",                      city: "Tampa",           state: "FL", zip: "33637", contact_name: "Sam Kazmarek",     phone: "813-985-0850" },
    { company: "New Panel Kits LLC",                   attention: "Attn: Jeanne Bishop",   street: "510 Paul Morris Dr",                      city: "Englewood",       state: "FL", zip: "34223", contact_name: "Brian Bishop",     phone: "941-915-3090" },
    { company: "Ocala Architechtural Foam, LLC",       attention: "",                      street: "7175 S. Pine Ave. STE A",                 city: "Ocala",           state: "FL", zip: "34480", contact_name: "Nicholas",         phone: "" },
    { company: "Precast & Foam Works",                 attention: "",                      street: "6612 Osteen Rd.",                         city: "New Port Richey", state: "FL", zip: "34653", contact_name: "Gabor",            phone: "" },
    { company: "Net Zero Building / Spray Rock Mnfg.", attention: "",                      street: "7980 SW Jack James Dr.",                  city: "Stuart",          state: "FL", zip: "34997", contact_name: "John",             phone: "954-205-9577" },
    { company: "Supply One ORL",                       attention: "",                      street: "3505 NW 112th St.",                       city: "Miami",           state: "FL", zip: "33167", contact_name: "",                 phone: "" },
    { company: "Town & Country #816",                  attention: "Attn: Darcy Miller",    street: "4311 Shader Rd. Ste 100",                 city: "Orlando",         state: "FL", zip: "32808", contact_name: "Kosta",            phone: "407-292-1517" },
    { company: "Virginia Foam",                        attention: "attn: Alex Gonzalez",   street: "1120 Summit St.",                         city: "Fredericksburg",  state: "VA", zip: "22401", contact_name: "Alex Gonzalez",    phone: "540-681-7665" },
    { company: "Yanaex Inc.",                          attention: "Attn: Misha Gryb",      street: "8802 Corporate Square Ct., Ste. #106-206",city: "Jacksonville",    state: "FL", zip: "32216", contact_name: "Misha Gryb",       phone: "" },
    { company: "Spectrum Eng. & Mfg. Inc",             attention: "",                      street: "11609 Pyramid Dr.",                       city: "Odessa",          state: "FL", zip: "33556", contact_name: "",                 phone: "" },
  ];

  const now = new Date().toISOString();
  let inserted = 0;
  for (const c of SEED) {
    try {
      await db.prepare(`
        INSERT INTO bol_customers (id, company, attention, street, city, state, zip, phone, contact_name, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        crypto.randomUUID(),
        c.company, c.attention, c.street,
        c.city, c.state, c.zip, c.phone, c.contact_name,
        now, now
      ).run();
      inserted++;
    } catch { /* skip on conflict */ }
  }

  // Seed carriers if the table is empty
  const carrierRow = await db.prepare("SELECT COUNT(*) as cnt FROM bol_carriers").first();
  let carriersInserted = 0;
  if (!carrierRow || carrierRow.cnt === 0) {
    const CARRIERS = ["LISMA Logistics", "LISMA Flatbed", "Xpanda Truck", "XP Co. Truck", "Customer Pickup (CPU)", "Priority1"];
    for (const name of CARRIERS) {
      try {
        await db.prepare("INSERT INTO bol_carriers (id, name) VALUES (?,?)").bind(crypto.randomUUID(), name).run();
        carriersInserted++;
      } catch { /* skip */ }
    }
  }

  return json({ ok: true, message: `Seeded ${inserted} customers and ${carriersInserted} carriers.` });
}

export async function handleApiBolCarriers(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);
  const method = request.method;

  if (method === "GET") {
    try {
      const result = await db.prepare("SELECT * FROM bol_carriers WHERE is_active = 1 ORDER BY name ASC").all();
      return json({ ok: true, carriers: result.results || [] });
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

    const id    = crypto.randomUUID();
    const scac  = String(payload.scac  || "").trim();
    const phone = String(payload.phone || "").trim();

    try {
      await db.prepare("INSERT INTO bol_carriers (id, name, scac, phone) VALUES (?,?,?,?)")
        .bind(id, name, scac, phone).run();
      const row = await db.prepare("SELECT * FROM bol_carriers WHERE id = ?").bind(id).first();
      await logActivity(db, 'create', 'bol_carrier', id,
        `Created carrier "${name}"`,
        { name, scac, phone }
      );
      return json({ ok: true, carrier: row }, 201);
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

export async function handleApiBols(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  const url    = new URL(request.url);
  const method = request.method;
  const parts  = url.pathname.split("/").filter(Boolean); // ["api","bols"] or ["api","bols","<id>"]
  const bolId  = parts.length >= 3 ? parts[2] : null;

  // ── GET /api/bols/:id/signed-photo ────────────────────────────────────────
  const signedPhotoMatch = url.pathname.match(/^\/api\/bols\/([^/]+)\/signed-photo$/);
  if (signedPhotoMatch) {
    const spBolId = signedPhotoMatch[1];
    const row = await env.DB.prepare(
      "SELECT signed_bol_photo_key FROM bols WHERE id = ?"
    ).bind(spBolId).first();
    if (!row?.signed_bol_photo_key) return new Response('Not found', { status: 404 });
    const obj = await env.BOL_PHOTOS.get(row.signed_bol_photo_key);
    if (!obj) return new Response('Not found', { status: 404 });
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
  }

  // ── GET /api/bols/:id ─────────────────────────────────────────────────────
  if (method === "GET" && bolId) {
    try {
      const row = await db.prepare("SELECT * FROM bols WHERE id = ?").bind(bolId).first();
      if (!row) return json({ ok: false, error: "BOL not found." }, 404);
      return json({ ok: true, bol: row });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── GET /api/bols ─────────────────────────────────────────────────────────
  if (method === "GET") {
    const days        = parseInt(url.searchParams.get("days") || "30", 10);
    const customer_id  = (url.searchParams.get("customer_id") || "").trim();
    const search       = (url.searchParams.get("search")      || "").trim();
    const jobIdsParam  = (url.searchParams.get("job_ids")     || "").trim();
    const jobIds       = jobIdsParam ? jobIdsParam.split(",").map(s => s.trim()).filter(Boolean) : [];
    const jobId        = (url.searchParams.get("job_id")      || "").trim();

    let query   = "SELECT * FROM bols";
    const conds = [];
    const binds = [];

    if (jobId) {
      conds.push("job_id = ?");
      binds.push(jobId);
    } else if (jobIds.length) {
      const ph = jobIds.map(() => "?").join(",");
      conds.push(`job_id IN (${ph})`);
      binds.push(...jobIds);
    } else if (!customer_id && !search && days > 0) {
      conds.push("date >= date('now', ?)");
      binds.push(`-${days} days`);
    }
    if (customer_id) { conds.push("customer_id = ?"); binds.push(customer_id); }
    if (search) {
      conds.push("(ship_to_company LIKE ? OR CAST(bol_number AS TEXT) LIKE ?)");
      binds.push(`%${search}%`, `%${search}%`);
    }

    if (conds.length) query += " WHERE " + conds.join(" AND ");
    query += " ORDER BY bol_number DESC";

    try {
      const result = binds.length
        ? await db.prepare(query).bind(...binds).all()
        : await db.prepare(query).all();
      return json({ ok: true, bols: result.results || [] });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── POST /api/bols ────────────────────────────────────────────────────────
  if (method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const date = String(payload.date || "").trim();
    if (!date) return json({ ok: false, error: "date is required." }, 400);

    const bol_number = payload.bol_number ? String(payload.bol_number).trim() || null : null;

    const id  = crypto.randomUUID();
    const now = new Date().toISOString();
    const s   = (f) => String(payload[f] || "").trim();

    const validTerms     = ["prepaid", "collect", "3rd_party"];
    const freight_terms  = validTerms.includes(s("freight_terms")) ? s("freight_terms") : "prepaid";
    const is_scrap_pickup = payload.is_scrap_pickup ? 1 : 0;
    let render_overrides = null;
    if (payload.render_overrides != null) {
      if (typeof payload.render_overrides === 'object') {
        render_overrides = JSON.stringify(payload.render_overrides);
      } else if (typeof payload.render_overrides === 'string' && payload.render_overrides.trim()) {
        try { JSON.parse(payload.render_overrides); render_overrides = payload.render_overrides; }
        catch { render_overrides = null; }
      }
    }

    const access_token = generateAccessToken();

    try {
      await db.prepare(`
        INSERT INTO bols (
          id, bol_number, date, customer_id,
          ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
          ship_to_city, ship_to_state, ship_to_zip, location_no,
          carrier_id, carrier_name, trailer_no, seal_number, scac, pro_no,
          freight_terms, is_scrap_pickup, third_party_bill_to, special_instructions, contact_info, is_master_bol,
          commodity_description, handling_unit_qty, handling_unit_type,
          package_qty, package_type, weight, delivery_time, job_id, notes, render_overrides, access_token, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id, bol_number, date,
        payload.customer_id ? String(payload.customer_id).trim() : null,
        s("ship_to_company"), s("ship_to_attention"), s("ship_to_street"), s("ship_to_street2"),
        s("ship_to_city"), s("ship_to_state"), s("ship_to_zip"), s("location_no"),
        payload.carrier_id ? String(payload.carrier_id).trim() : null,
        s("carrier_name"), s("trailer_no"), s("seal_number"), s("scac"), s("pro_no"),
        freight_terms, is_scrap_pickup, s("third_party_bill_to"), s("special_instructions"), s("contact_info"),
        payload.is_master_bol ? 1 : 0,
        s("commodity_description"), s("handling_unit_qty"), s("handling_unit_type"),
        s("package_qty"), s("package_type"), s("weight"), s("delivery_time"),
        payload.job_id ? String(payload.job_id).trim() : null,
        s("notes"), render_overrides, access_token, now
      ).run();

      const row = await db.prepare("SELECT * FROM bols WHERE id = ?").bind(id).first();
      await logActivity(db, 'create', 'bol', id,
        `Created ${bol_number ? `BOL #${bol_number}` : 'BOL'} for ${s('ship_to_company')}`,
        { bol_number, ship_to_company: s('ship_to_company'), carrier_name: s('carrier_name'), date }
      );
      return json({ ok: true, message: "BOL created.", bol: row }, 201);
    } catch (e) {
      const msg = String(e?.message || e);
      return json({ ok: false, error: "Server error.", detail: msg }, 500);
    }
  }

  // ── PUT /api/bols/:id ─────────────────────────────────────────────────────
  if (method === "PUT" && bolId) {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const existing = await db.prepare("SELECT id, render_overrides, access_token FROM bols WHERE id = ?").bind(bolId).first();
    if (!existing) return json({ ok: false, error: "BOL not found." }, 404);

    const s = (f) => String(payload[f] || "").trim();
    const validTerms    = ["prepaid", "collect", "3rd_party"];
    const freight_terms = validTerms.includes(s("freight_terms")) ? s("freight_terms") : "prepaid";
    const is_scrap_pickup = payload.is_scrap_pickup ? 1 : 0;
    const hasOverridesField = Object.prototype.hasOwnProperty.call(payload, 'render_overrides');
    let render_overrides = null;
    if (hasOverridesField) {
      if (payload.render_overrides != null) {
        if (typeof payload.render_overrides === 'object') {
          render_overrides = JSON.stringify(payload.render_overrides);
        } else if (typeof payload.render_overrides === 'string' && payload.render_overrides.trim()) {
          try { JSON.parse(payload.render_overrides); render_overrides = payload.render_overrides; }
          catch { render_overrides = null; }
        }
      }
    } else {
      render_overrides = existing.render_overrides ?? null;
    }

    // Legacy BOLs without a token get one on next edit. Token is permanent —
    // never overwritten once set, so printed QR codes remain valid.
    let access_token = existing.access_token;
    if (!access_token) access_token = generateAccessToken();

    try {
      await db.prepare(`
        UPDATE bols SET
          date = ?, customer_id = ?,
          ship_to_company = ?, ship_to_attention = ?, ship_to_street = ?, ship_to_street2 = ?,
          ship_to_city = ?, ship_to_state = ?, ship_to_zip = ?, location_no = ?,
          carrier_id = ?, carrier_name = ?, trailer_no = ?, seal_number = ?, scac = ?, pro_no = ?,
          freight_terms = ?, is_scrap_pickup = ?, third_party_bill_to = ?, special_instructions = ?, contact_info = ?,
          is_master_bol = ?, commodity_description = ?, handling_unit_qty = ?, handling_unit_type = ?,
          package_qty = ?, package_type = ?, weight = ?, delivery_time = ?, job_id = ?, notes = ?, render_overrides = ?,
          access_token = ?
        WHERE id = ?
      `).bind(
        s("date"),
        payload.customer_id ? String(payload.customer_id).trim() : null,
        s("ship_to_company"), s("ship_to_attention"), s("ship_to_street"), s("ship_to_street2"),
        s("ship_to_city"), s("ship_to_state"), s("ship_to_zip"), s("location_no"),
        payload.carrier_id ? String(payload.carrier_id).trim() : null,
        s("carrier_name"), s("trailer_no"), s("seal_number"), s("scac"), s("pro_no"),
        freight_terms, is_scrap_pickup, s("third_party_bill_to"), s("special_instructions"), s("contact_info"),
        payload.is_master_bol ? 1 : 0,
        s("commodity_description"), s("handling_unit_qty"), s("handling_unit_type"),
        s("package_qty"), s("package_type"), s("weight"), s("delivery_time"),
        payload.job_id ? String(payload.job_id).trim() : null,
        s("notes"), render_overrides, access_token,
        bolId
      ).run();

      const row = await db.prepare("SELECT * FROM bols WHERE id = ?").bind(bolId).first();
      await logActivity(db, 'update', 'bol', bolId,
        `Updated BOL #${payload.bol_number || bolId}`,
        { fields_updated: Object.keys(payload).filter(k => k !== 'id') }
      );
      return json({ ok: true, message: "BOL updated.", bol: row });
    } catch (e) {
      const msg = String(e?.message || e);
      return json({ ok: false, error: "Server error.", detail: msg }, 500);
    }
  }

  // ── DELETE /api/bols/:id ──────────────────────────────────────────────────
  if (method === "DELETE" && bolId) {
    try {
      const exists = await db.prepare("SELECT id, bol_number FROM bols WHERE id = ?").bind(bolId).first();
      if (!exists) return json({ ok: false, error: "BOL not found." }, 404);
      await db.prepare("DELETE FROM bols WHERE id = ?").bind(bolId).run();
      await logActivity(db, 'delete', 'bol', bolId,
        `Deleted BOL #${exists.bol_number || bolId}`,
        { id: bolId }
      );
      return json({ ok: true, message: "BOL deleted." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

// ========================
// Load Builder SKU API
// ========================

function mapPartToSku(row) {
  return {
    id: row.id,
    name: row.name || row.part_number,
    sku: row.part_number,
    length: row.length_in,
    width: row.width_in,
    height: row.height_in,
    weight: row.weight,
    notes: row.notes,
    color: row.color,
    allowRotation: row.allow_rotation === 1,
    category: row.category || '',
    parent_group: row.parent_group || '',
    bundleQty: row.bundle_qty || 0,
  };
}

const DEFAULT_PARTS = [
  { part_number: "HB-01", name: "1in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 1, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "1in HB" },
  { part_number: "HB-01.25", name: "1.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 1.25, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "1in HB" },
  { part_number: "HB-1.5", name: "1.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 1.5, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "1in HB" },
  { part_number: "HB-1.75", name: "1.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 1.75, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "1in HB" },
  { part_number: "HB-02", name: "2in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 2, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "2in HB" },
  { part_number: "HB-02.25", name: "2.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 2.25, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "2in HB" },
  { part_number: "HB-2.5", name: "2.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 2.5, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "2in HB" },
  { part_number: "HB-2.75", name: "2.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 2.75, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "2in HB" },
  { part_number: "HB-03", name: "3in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 3, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "3in HB" },
  { part_number: "HB-03.25", name: "3.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 3.25, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "3in HB" },
  { part_number: "HB-3.5", name: "3.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 3.5, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "3in HB" },
  { part_number: "HB-3.75", name: "3.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 3.75, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "3in HB" },
  { part_number: "HB-04", name: "4in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 4, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "4in HB" },
  { part_number: "HB-04.25", name: "4.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 4.25, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "4in HB" },
  { part_number: "HB-4.5", name: "4.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 4.5, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "4in HB" },
  { part_number: "HB-4.75", name: "4.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 4.75, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "4in HB" },
  { part_number: "HB-05", name: "5in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 5, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "5in HB" },
  { part_number: "HB-05.25", name: "5.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 5.25, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "5in HB" },
  { part_number: "HB-5.5", name: "5.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 5.5, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "5in HB" },
  { part_number: "HB-5.75", name: "5.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 5.75, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "5in HB" },
  { part_number: "HB-06", name: "6in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 6, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "6in HB" },
  { part_number: "HB-06.25", name: "6.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 6.25, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "6in HB" },
  { part_number: "HB-6.5", name: "6.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 6.5, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "6in HB" },
  { part_number: "HB-6.75", name: "6.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 6.75, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "6in HB" },
  { part_number: "HB-07", name: "7in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 7, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "7in HB" },
  { part_number: "HB-07.25", name: "7.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 7.25, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "7in HB" },
  { part_number: "HB-7.5", name: "7.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 7.5, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "7in HB" },
  { part_number: "HB-7.75", name: "7.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 7.75, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "7in HB" },
  { part_number: "HB-08", name: "8in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 8, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "8in HB" },
  { part_number: "HB-08.25", name: "8.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 8.25, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "8in HB" },
  { part_number: "HB-8.5", name: "8.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 8.5, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "8in HB" },
  { part_number: "HB-8.75", name: "8.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 8.75, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "8in HB" },
  { part_number: "HB-09", name: "9in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 9, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "9in HB" },
  { part_number: "HB-09.25", name: "9.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 9.25, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "9in HB" },
  { part_number: "HB-9.5", name: "9.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 9.5, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "9in HB" },
  { part_number: "HB-9.75", name: "9.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 9.75, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "9in HB" },
  { part_number: "HB-10", name: "10in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 10, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "10in HB" },
  { part_number: "HB-10.25", name: "10.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 10.25, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "10in HB" },
  { part_number: "HB-10.5", name: "10.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 10.5, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "10in HB" },
  { part_number: "HB-10.75", name: "10.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 10.75, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "10in HB" },
  { part_number: "HB-11", name: "11in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 11, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "11in HB" },
  { part_number: "HB-11.25", name: "11.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 11.25, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "11in HB" },
  { part_number: "HB-11.5", name: "11.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 11.5, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "11in HB" },
  { part_number: "HB-11.75", name: "11.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 11.75, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "11in HB" },
  { part_number: "HB-12", name: "12in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 12, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "12in HB" },
  { part_number: "HB-12.25", name: "12.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 12.25, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "12in HB" },
  { part_number: "HB-12.5", name: "12.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 12.5, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "12in HB" },
  { part_number: "HB-12.75", name: "12.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 12.75, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "12in HB" },
  { part_number: "HB-13", name: "13in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 13, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "13in HB" },
  { part_number: "HB-13.25", name: "13.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 13.25, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "13in HB" },
  { part_number: "HB-13.5", name: "13.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 13.5, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "13in HB" },
  { part_number: "HB-13.75", name: "13.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 13.75, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "13in HB" },
  { part_number: "HB-14", name: "14in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 14, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "14in HB" },
  { part_number: "HB-14.25", name: "14.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 14.25, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "14in HB" },
  { part_number: "HB-14.5", name: "14.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 14.5, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "14in HB" },
  { part_number: "HB-14.75", name: "14.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 14.75, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "14in HB" },
  { part_number: "HB-15", name: "15in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 15, weight: 1, notes: "", color: "#A21CAF", category: "Holey Board", parent_group: "15in HB" },
  { part_number: "HB-15.25", name: "15.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 15.25, weight: 1, notes: "", color: "#A21CAF", category: "Holey Board", parent_group: "15in HB" },
  { part_number: "HB-15.5", name: "15.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 15.5, weight: 1, notes: "", color: "#A21CAF", category: "Holey Board", parent_group: "15in HB" },
  { part_number: "HB-15.75", name: "15.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 15.75, weight: 1, notes: "", color: "#A21CAF", category: "Holey Board", parent_group: "15in HB" },
  { part_number: "HB-16", name: "16in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 16, weight: 1, notes: "", color: "#4338CA", category: "Holey Board", parent_group: "16in HB" },
  { part_number: "HB-16.25", name: "16.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 16.25, weight: 1, notes: "", color: "#4338CA", category: "Holey Board", parent_group: "16in HB" },
  { part_number: "HB-16.5", name: "16.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 16.5, weight: 1, notes: "", color: "#4338CA", category: "Holey Board", parent_group: "16in HB" },
  { part_number: "HB-16.75", name: "16.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 16.75, weight: 1, notes: "", color: "#4338CA", category: "Holey Board", parent_group: "16in HB" },
  { part_number: "HB-17", name: "17in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 17, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "17in HB" },
  { part_number: "HB-17.25", name: "17.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 17.25, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "17in HB" },
  { part_number: "HB-17.5", name: "17.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 17.5, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "17in HB" },
  { part_number: "HB-17.75", name: "17.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 17.75, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "17in HB" },
  { part_number: "HB-18", name: "18in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 18, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "18in HB" },
  { part_number: "HB-18.25", name: "18.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 18.25, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "18in HB" },
  { part_number: "HB-18.5", name: "18.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 18.5, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "18in HB" },
  { part_number: "HB-18.75", name: "18.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 18.75, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "18in HB" },
  { part_number: "HB-19", name: "19in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 19, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "19in HB" },
  { part_number: "HB-19.25", name: "19.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 19.25, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "19in HB" },
  { part_number: "HB-19.5", name: "19.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 19.5, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "19in HB" },
  { part_number: "HB-19.75", name: "19.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 19.75, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "19in HB" },
  { part_number: "HB-20", name: "20in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 20, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "20in HB" },
  { part_number: "HB-20.25", name: "20.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 20.25, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "20in HB" },
  { part_number: "HB-20.5", name: "20.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 20.5, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "20in HB" },
  { part_number: "HB-20.75", name: "20.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 20.75, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "20in HB" },
  { part_number: "HB-21", name: "21in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 21, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "21in HB" },
  { part_number: "HB-21.25", name: "21.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 21.25, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "21in HB" },
  { part_number: "HB-21.5", name: "21.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 21.5, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "21in HB" },
  { part_number: "HB-21.75", name: "21.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 21.75, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "21in HB" },
  { part_number: "HB-22", name: "22in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 22, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "22in HB" },
  { part_number: "HB-22.25", name: "22.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 22.25, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "22in HB" },
  { part_number: "HB-22.5", name: "22.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 22.5, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "22in HB" },
  { part_number: "HB-22.75", name: "22.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 22.75, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "22in HB" },
  { part_number: "HB-23", name: "23in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 23, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "23in HB" },
  { part_number: "HB-23.25", name: "23.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 23.25, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "23in HB" },
  { part_number: "HB-23.5", name: "23.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 23.5, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "23in HB" },
  { part_number: "HB-23.75", name: "23.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 23.75, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "23in HB" },
  { part_number: "HB-24", name: "24in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 24, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "24in HB" },
  { part_number: "HB-24.25", name: "24.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 24.25, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "24in HB" },
  { part_number: "HB-24.5", name: "24.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 24.5, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "24in HB" },
  { part_number: "HB-24.75", name: "24.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 24.75, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "24in HB" },
  { part_number: "HB-25", name: "25in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 25, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "25in HB" },
  { part_number: "HB-25.25", name: "25.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 25.25, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "25in HB" },
  { part_number: "HB-25.5", name: "25.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 25.5, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "25in HB" },
  { part_number: "HB-25.75", name: "25.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 25.75, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "25in HB" },
  { part_number: "HB-26", name: "26in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 26, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "26in HB" },
  { part_number: "HB-26.25", name: "26.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 26.25, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "26in HB" },
  { part_number: "HB-26.5", name: "26.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 26.5, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "26in HB" },
  { part_number: "HB-26.75", name: "26.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 26.75, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "26in HB" },
  { part_number: "HB-27", name: "27in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 27, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "27in HB" },
  { part_number: "HB-27.25", name: "27.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 27.25, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "27in HB" },
  { part_number: "HB-27.5", name: "27.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 27.5, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "27in HB" },
  { part_number: "HB-27.75", name: "27.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 27.75, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "27in HB" },
  { part_number: "HB-28", name: "28in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 28, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "28in HB" },
  { part_number: "HB-28.25", name: "28.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 28.25, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "28in HB" },
  { part_number: "HB-28.5", name: "28.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 28.5, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "28in HB" },
  { part_number: "HB-28.75", name: "28.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 28.75, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "28in HB" },
  { part_number: "HB-29", name: "29in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 29, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "29in HB" },
  { part_number: "HB-29.25", name: "29.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 29.25, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "29in HB" },
  { part_number: "HB-29.5", name: "29.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 29.5, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "29in HB" },
  { part_number: "HB-29.75", name: "29.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 29.75, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "29in HB" },
  { part_number: "HB-30", name: "30in block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 30, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "30in HB" },
  { part_number: "HB-30.25", name: "30.25in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 30.25, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "30in HB" },
  { part_number: "HB-30.5", name: "30.5in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 30.5, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "30in HB" },
  { part_number: "HB-30.75", name: "30.75in Block", customer: "", density_material: "1.0 RC", length: 48, width: 24, height: 30.75, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "30in HB" },
  { part_number: "H4040-4", name: "H4040-4", customer: "DiversiTech", density_material: "1.0 RC", length: 37.5, width: 37.5, height: 3.62, weight: 1, notes: "", color: "#D97706", category: "", parent_group: "" },
  { part_number: "H1840-4", name: "H1840-4", customer: "DiversiTech", density_material: "1.0 RC", length: 37.5, width: 15.5, height: 3.62, weight: 1, notes: "", color: "#D97706", category: "", parent_group: "" },
  { part_number: "H3232-4", name: "H3232-4", customer: "DiversiTech", density_material: "1.0 RC", length: 29.5, width: 29.5, height: 3.62, weight: 1, notes: "", color: "#D97706", category: "", parent_group: "" },
  { part_number: "H2436-4", name: "H2436-4", customer: "DiversiTech", density_material: "1.0 RC", length: 33.5, width: 21.5, height: 3.62, weight: 1, notes: "", color: "#D97706", category: "", parent_group: "" },
];

export async function handleApiSavedLoads(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  const url    = new URL(request.url);
  const method = request.method;
  const loadId = url.pathname.slice("/api/saved-loads".length).replace(/^\//, "") || null;

  // ── GET /api/saved-loads ──────────────────────────────────────────────────
  if (method === "GET" && !loadId) {
    const now = new Date().toISOString();
    await db.prepare("DELETE FROM saved_loads WHERE expires_at < ?").bind(now).run();
    const result = await db.prepare(
      "SELECT id, name, job_id, customer, trailer_type, created_at, updated_at FROM saved_loads ORDER BY updated_at DESC"
    ).all();
    return json({ ok: true, loads: result.results || [] });
  }

  // ── GET /api/saved-loads/:id ──────────────────────────────────────────────
  if (method === "GET" && loadId) {
    const row = await db.prepare("SELECT * FROM saved_loads WHERE id = ?").bind(loadId).first();
    if (!row) return json({ ok: false, error: "Saved load not found." }, 404);
    return json({ ok: true, load: row });
  }

  // ── POST /api/saved-loads ─────────────────────────────────────────────────
  if (method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id         = crypto.randomUUID();
    const now        = new Date().toISOString();
    const expires_at = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    await db.prepare(`
      INSERT INTO saved_loads (id, name, job_id, customer, trailer_type, state_json, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      String(payload.name || "").trim(),
      payload.job_id ? String(payload.job_id).trim() : null,
      String(payload.customer || "").trim(),
      String(payload.trailer_type || "").trim(),
      typeof payload.state_json === "string" ? payload.state_json : JSON.stringify(payload.state_json || {}),
      now, now, expires_at
    ).run();

    await logActivity(db, 'create', 'saved_load', id,
      `Saved load "${payload.name || id}" for ${payload.customer || ''}`,
      { name: payload.name, customer: payload.customer, trailer_type: payload.trailer_type }
    );
    const row = await db.prepare("SELECT * FROM saved_loads WHERE id = ?").bind(id).first();
    return json({ ok: true, load: row }, 201);
  }

  // ── PUT /api/saved-loads/:id ──────────────────────────────────────────────
  if (method === "PUT" && loadId) {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const existing = await db.prepare("SELECT id FROM saved_loads WHERE id = ?").bind(loadId).first();
    if (!existing) return json({ ok: false, error: "Saved load not found." }, 404);

    const now        = new Date().toISOString();
    const expires_at = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    await db.prepare(`
      UPDATE saved_loads SET
        name = ?, job_id = ?, customer = ?, trailer_type = ?,
        state_json = ?, updated_at = ?, expires_at = ?
      WHERE id = ?
    `).bind(
      String(payload.name || "").trim(),
      payload.job_id ? String(payload.job_id).trim() : null,
      String(payload.customer || "").trim(),
      String(payload.trailer_type || "").trim(),
      typeof payload.state_json === "string" ? payload.state_json : JSON.stringify(payload.state_json || {}),
      now, expires_at, loadId
    ).run();

    const row = await db.prepare("SELECT * FROM saved_loads WHERE id = ?").bind(loadId).first();
    return json({ ok: true, load: row });
  }

  // ── DELETE /api/saved-loads/:id ───────────────────────────────────────────
  if (method === "DELETE" && loadId) {
    const existing = await db.prepare("SELECT id, name, customer FROM saved_loads WHERE id = ?").bind(loadId).first();
    if (!existing) return json({ ok: false, error: "Saved load not found." }, 404);

    await db.prepare("DELETE FROM saved_loads WHERE id = ?").bind(loadId).run();
    await logActivity(db, 'delete', 'saved_load', loadId,
      `Deleted saved load "${existing.name || loadId}" for ${existing.customer || ''}`,
      { name: existing.name, customer: existing.customer }
    );
    return json({ ok: true, message: "Saved load deleted." });
  }

  return json({ ok: false, error: "Method not allowed." }, 405);
}

export async function handleApiLoadBuilderSkus(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  const url = new URL(request.url);
  const pathId = url.pathname.slice("/api/load-builder-skus".length).replace(/^\//, "");
  const skuId = pathId.length > 0 ? pathId : null;

  if (request.method === "GET" && !skuId) {
    const result = await db.prepare(
      "SELECT * FROM parts ORDER BY sort_order ASC, height_in ASC, name ASC"
    ).all();
    return json((result.results || []).map(mapPartToSku));
  }

  if (request.method === "POST" && !skuId) {
    let body;
    try { body = await request.json(); } catch (_) { return json({ ok: false, error: "Invalid JSON" }, 400); }
    const { name, sku, length, width, height, weight = 1, notes = "", color = "#D97706", allowRotation = false, category = "", parent_group = "" } = body;
    const bundle_qty_lb = parseInt(body.bundleQty || body.bundle_qty, 10) || 0;
    if (!name) return json({ ok: false, error: "Name required." }, 400);
    if (!sku) return json({ ok: false, error: "SKU code required." }, 400);
    if (!length || !width || !height) return json({ ok: false, error: "Dimensions required." }, 400);
    const newId = crypto.randomUUID();
    const countRow = await db.prepare("SELECT COUNT(*) as cnt FROM parts").first();
    const sortOrder = countRow?.cnt || 0;
    await db.prepare(
      "INSERT INTO parts (id, part_number, name, length_in, width_in, height_in, weight, notes, color, allow_rotation, sort_order, category, parent_group, bundle_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(newId, sku, name, +length, +width, +height, +weight || 1, notes || "", color || "#D97706", allowRotation ? 1 : 0, sortOrder, category || "", parent_group || "", bundle_qty_lb).run();
    const created = await db.prepare("SELECT * FROM parts WHERE id = ?").bind(newId).first();
    return json(mapPartToSku(created), 201);
  }

  if (request.method === "PUT" && skuId) {
    let body;
    try { body = await request.json(); } catch (_) { return json({ ok: false, error: "Invalid JSON" }, 400); }
    const { name, sku, length, width, height, weight, notes, color, allowRotation, category, parent_group } = body;
    const updates = [];
    const binds = [];
    if (name !== undefined) { updates.push("name = ?"); binds.push(name); }
    if (sku !== undefined) { updates.push("part_number = ?"); binds.push(sku); }
    if (length !== undefined) { updates.push("length_in = ?"); binds.push(+length); }
    if (width !== undefined) { updates.push("width_in = ?"); binds.push(+width); }
    if (height !== undefined) { updates.push("height_in = ?"); binds.push(+height); }
    if (weight !== undefined) { updates.push("weight = ?"); binds.push(+weight); }
    if (notes !== undefined) { updates.push("notes = ?"); binds.push(notes); }
    if (color !== undefined) { updates.push("color = ?"); binds.push(color); }
    if (allowRotation !== undefined) { updates.push("allow_rotation = ?"); binds.push(allowRotation ? 1 : 0); }
    if (category !== undefined) { updates.push("category = ?"); binds.push(category || ""); }
    if (parent_group !== undefined) { updates.push("parent_group = ?"); binds.push(parent_group || ""); }
    if (body.bundleQty !== undefined) { updates.push("bundle_qty = ?"); binds.push(parseInt(body.bundleQty, 10) || 0); }
    updates.push("updated_at = datetime('now')");
    if (updates.length === 1) return json({ ok: false, error: "Nothing to update." }, 400);
    await db.prepare(`UPDATE parts SET ${updates.join(", ")} WHERE id = ?`).bind(...binds, skuId).run();
    const updated = await db.prepare("SELECT * FROM parts WHERE id = ?").bind(skuId).first();
    if (!updated) return json({ ok: false, error: "SKU not found." }, 404);
    return json(mapPartToSku(updated));
  }

  if (request.method === "DELETE" && skuId) {
    await db.prepare("DELETE FROM parts WHERE id = ?").bind(skuId).run();
    return json({ success: true });
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

export async function handleApiLoadBuilderSkusDeleteAll(request, env) {
  if (request.method !== "DELETE") return json({ ok: false, error: "Method Not Allowed" }, 405);
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);
  await db.prepare("DELETE FROM parts").run();
  return json({ success: true });
}

export async function handleApiPartsSeed(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405);
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);
  const countRow = await db.prepare("SELECT COUNT(*) as cnt FROM parts").first();
  if ((countRow?.cnt || 0) > 0) return json({ seeded: false, message: "Parts already exist" });
  for (let i = 0; i < DEFAULT_PARTS.length; i++) {
    const s = DEFAULT_PARTS[i];
    await db.prepare(
      "INSERT INTO parts (id, part_number, name, customer, density_material, length_in, width_in, height_in, weight, notes, color, allow_rotation, sort_order, category, parent_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), s.part_number, s.name, s.customer || "", s.density_material || "", s.length, s.width, s.height, s.weight, s.notes, s.color, 0, i, s.category || "", s.parent_group || "").run();
  }
  return json({ seeded: true, message: `Inserted ${DEFAULT_PARTS.length} default parts.` });
}

