// _worker.js — Pages Advanced Mode with SAFE error reporting

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // 🔥 Training redirect safety net
      if (url.pathname === "/training" || url.pathname === "/training/") {
        return Response.redirect(`${url.origin}/safety/training/`, 301);
      }

      // 1) Health check
      if (url.pathname === "/health") {
        return new Response("FUNCTIONS_OK", { status: 200 });
      }

           // 2) API routes
      if (url.pathname === "/api/completions") {
        return handleApiCompletions(request, env);
      }

      if (url.pathname === "/api/scrap-log") {
        return handleApiScrapLog(request, env);
      }

      if (url.pathname === "/api/reports/scrap-summary") {
        return handleApiReportsScrapSummary(request, env);
      }
      if (url.pathname === "/api/reports/scrap-trend") {
        return handleApiReportsScrapTrend(request, env);
      }

      // 3) Static site passthrough (Pages assets binding)
      if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
        return new Response(
          "Worker error: env.ASSETS is missing.\n\n" +
          "This usually means the deployment is not providing the Pages assets binding.\n" +
          "Confirm _worker.js is at the deployment root next to index.html.\n",
          { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }

      return await env.ASSETS.fetch(request);

    } catch (err) {
      const msg =
        (err && (err.stack || err.message))
          ? (err.stack || err.message)
          : String(err);

      return new Response(
        "Worker crashed:\n\n" + msg,
        { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }
  },
};


// ========================
// Backend Logic Below
// ========================

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function isAdminAuthorized(request, env) {
  const key = env.ADMIN_KEY;
  if (!key) return false;

  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  return match[1] === key;
}

function normalizeName(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

async function hashIp(ip) {
  if (!ip) return null;
  try {
    const data = new TextEncoder().encode(ip);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)]
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

async function handleApiCompletions(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  const url = new URL(request.url);

  // POST (employee submit)
  if (request.method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const employee_name = normalizeName(payload.employee_name);
    const block_id = String(payload.block_id || "").trim();
    const block_title = String(payload.block_title || "").trim();
    const attested = payload.attested === true;

    if (!employee_name) return json({ ok: false, error: "Name required." }, 400);
    if (!block_id) return json({ ok: false, error: "block_id required." }, 400);
    if (!block_title) return json({ ok: false, error: "block_title required." }, 400);
    if (!attested) return json({ ok: false, error: "Attestation required." }, 400);

    const ip = request.headers.get("CF-Connecting-IP");
    const ip_hash = await hashIp(ip);
    const user_agent = request.headers.get("User-Agent") || null;

    try {
      await db.prepare(`
        INSERT INTO completions
        (employee_name, block_id, block_title, attested, ip_hash, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(employee_name, block_id, block_title, 1, ip_hash, user_agent)
      .run();

      return json({ ok: true, message: "Completion recorded." }, 201);

    } catch (e) {
      const msg = String(e?.message || e);

      if (/constraint/i.test(msg) || /unique/i.test(msg)) {
        return json(
          { ok: false, error: "Already submitted today.", code: "DUPLICATE_TODAY" },
          409
        );
      }

      return json({ ok: false, error: "Server error.", detail: msg }, 500);
    }
  }

  // GET (admin)
  if (request.method === "GET") {
    if (!isAdminAuthorized(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const params = url.searchParams;
    const limit = Math.min(Math.max(parseInt(params.get("limit") || "200", 10), 1), 2000);
    const offset = Math.max(parseInt(params.get("offset") || "0", 10), 0);

    const results = await db.prepare(`
      SELECT id, employee_name, block_id, block_title,
             attested, submitted_at, submitted_date
      FROM completions
      ORDER BY submitted_at DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    return json({ ok: true, rows: results.results || [], limit, offset });
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

    // Week Helper
function getWeekNumberMondayStart(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const dayOffset = (yearStart.getUTCDay() + 6) % 7;
  const diff = Math.floor((d - yearStart) / 86400000);
  return Math.floor((diff + dayOffset) / 7) + 1;
}
    //Scrap Log Backend
  async function mirrorScrapLogToSheet(record, env) {
  const url = env.SCRAP_MIRROR_URL;

  if (!url) {
    console.log("SCRAP_MIRROR_URL not set — skipping mirror.");
    return { ok: false, skipped: true };
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(record)
    });

    const text = await resp.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!resp.ok) {
      console.log("Mirror HTTP error:", resp.status, text);
      return { ok: false, error: "http_error", detail: data };
    }

    if (data && data.ok === false) {
      console.log("Mirror app error:", data);
      return { ok: false, error: "app_error", detail: data };
    }

    console.log("Mirror success:", record.id);
    return { ok: true };

  } catch (err) {
    console.log("Mirror fetch failed:", err);
    return { ok: false, error: "fetch_error", detail: String(err) };
  }
}
async function handleApiScrapLog(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method Not Allowed" }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const allowedShifts = ["1", "2", "3"];
  const allowedMachines = ["Blue Line", "Main Line", "Cross Cutter", "Hole Cutter"];
  const allowedReasons = [
    "Incorrect Cut",
    "Hole Pass Issue",
    "Dirty / Wet Foam",
    "Equipment Issue",
    "Setup Error"
  ];

  const event_date = String(payload.date || "").trim();
  const shift = String(payload.shift || "").trim();
  const operator_name = normalizeName(payload.operator);
  const line_machine = String(payload.lineMachine || "").trim();
  const inv_number = String(payload.invNumber || "").trim();
  const part_product = String(payload.partProduct || "").trim();
  const material_density = String(payload.materialDensity || "").trim();
  const scrap_reason = String(payload.scrapReason || "").trim();
  const notes = String(payload.notes || "").trim();
  const scrap_cubic_in = Number(payload.scrapCubicIn);

  if (!event_date) return json({ ok: false, error: "Date required." }, 400);
  if (!allowedShifts.includes(shift)) return json({ ok: false, error: "Invalid shift." }, 400);
  if (!operator_name) return json({ ok: false, error: "Operator required." }, 400);
  if (!allowedMachines.includes(line_machine)) return json({ ok: false, error: "Invalid line / machine." }, 400);
  if (!inv_number) return json({ ok: false, error: "INV # required." }, 400);
  if (!part_product) return json({ ok: false, error: "Part / Product required." }, 400);
  if (!material_density) return json({ ok: false, error: "Material / Density required." }, 400);
  if (!allowedReasons.includes(scrap_reason)) return json({ ok: false, error: "Invalid scrap reason." }, 400);
  if (!Number.isFinite(scrap_cubic_in) || scrap_cubic_in <= 0) {
    return json({ ok: false, error: "Scrap Cubic In must be greater than 0." }, 400);
  }

  const parsedDate = new Date(`${event_date}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return json({ ok: false, error: "Invalid date." }, 400);
  }

  const week_number = getWeekNumberMondayStart(parsedDate);
  const month_name = parsedDate.toLocaleString("en-US", { month: "long" });
  const scrap_board_ft = scrap_cubic_in / 144;
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  const record = {
    id,
    event_date,
    week_number,
    month_name,
    shift,
    operator_name,
    line_machine,
    inv_number,
    part_product,
    material_density,
    scrap_reason,
    notes,
    scrap_cubic_in,
    scrap_board_ft,
    created_at
  };

  try {
    await db.prepare(`
      INSERT INTO scrap_log (
        id,
        event_date,
        week_number,
        month_name,
        shift,
        operator_name,
        line_machine,
        inv_number,
        part_product,
        material_density,
        scrap_reason,
        notes,
        scrap_cubic_in,
        scrap_board_ft,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      record.id,
      record.event_date,
      record.week_number,
      record.month_name,
      record.shift,
      record.operator_name,
      record.line_machine,
      record.inv_number,
      record.part_product,
      record.material_density,
      record.scrap_reason,
      record.notes,
      record.scrap_cubic_in,
      record.scrap_board_ft,
      record.created_at
    )
    .run();

    const mirrorResult = await mirrorScrapLogToSheet(record, env);

    return json({
      ok: true,
      message: mirrorResult.ok
        ? "Scrap entry saved and mirrored."
        : "Scrap entry saved.",
      mirror_ok: !!mirrorResult.ok,
      mirror_result: mirrorResult.ok ? undefined : mirrorResult,
      record: {
        id: record.id,
        event_date: record.event_date,
        week_number: record.week_number,
        month_name: record.month_name,
        scrap_board_ft: record.scrap_board_ft,
        created_at: record.created_at
      }
    }, 201);

  } catch (e) {
    return json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      500
    );
  }
}
async function handleApiReportsScrapSummary(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  if (request.method !== "GET") {
    return json({ ok: false, error: "Method Not Allowed" }, 405);
  }

  const url = new URL(request.url);
  const month = String(url.searchParams.get("month") || "").trim();

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return json({ ok: false, error: "Invalid or missing month. Use YYYY-MM" }, 400);
  }

  try {

    const total = await db.prepare(`
      SELECT
        COALESCE(SUM(scrap_board_ft),0) AS total_scrap_board_ft,
        COUNT(*) AS entry_count
      FROM scrap_log
      WHERE strftime('%Y-%m', event_date) = ?
    `).bind(month).first();

    const byWeek = await db.prepare(`
      SELECT
        week_number,
        COALESCE(SUM(scrap_board_ft),0) AS scrap_board_ft
      FROM scrap_log
      WHERE strftime('%Y-%m', event_date) = ?
      GROUP BY week_number
      ORDER BY week_number
    `).bind(month).all();

    const byReason = await db.prepare(`
      SELECT
        scrap_reason,
        COALESCE(SUM(scrap_board_ft),0) AS scrap_board_ft
      FROM scrap_log
      WHERE strftime('%Y-%m', event_date) = ?
      GROUP BY scrap_reason
      ORDER BY scrap_board_ft DESC
    `).bind(month).all();

    return json({
      ok: true,
      month,
      total_scrap_board_ft: total?.total_scrap_board_ft || 0,
      entry_count: total?.entry_count || 0,
      by_week: byWeek.results || [],
      by_reason: byReason.results || []
    });

  } catch (e) {
    return json({
      ok: false,
      error: "Server error",
      detail: String(e?.message || e)
    }, 500);
  }
}

async function handleApiReportsScrapTrend(request, env) {

  const db = env.DB;
  if (!db) return json({ ok:false, error:"Missing DB binding" },500);

  if (request.method !== "GET") {
    return json({ ok:false, error:"Method Not Allowed" },405);
  }

  const url = new URL(request.url);
  const monthsRequested = Number(url.searchParams.get("months")) || 6;

  try {

    const rows = await db.prepare(`
      SELECT
        strftime('%Y-%m', event_date) AS month,
        ROUND(SUM(scrap_board_ft),2) AS total_scrap_board_ft
      FROM scrap_log
      GROUP BY month
      ORDER BY month ASC
    `).all();

    let data = rows.results || [];

    // Keep last N months
    data = data.slice(-monthsRequested);

    const latest = data[data.length-1] || null;
    const previous = data[data.length-2] || null;

    let delta = null;

    if (latest && previous) {

      const abs = latest.total_scrap_board_ft - previous.total_scrap_board_ft;

      const pct =
        previous.total_scrap_board_ft === 0
          ? null
          : (abs / previous.total_scrap_board_ft) * 100;

      delta = {
        absolute: Number(abs.toFixed(2)),
        percent: pct !== null ? Number(pct.toFixed(2)) : null
      };
    }

    return json({
      ok:true,
      range_months: monthsRequested,
      months: data,
      latest,
      previous,
      delta
    });

  } catch(e) {

    return json({
      ok:false,
      error:"Server error",
      detail:String(e?.message || e)
    },500);

  }

}