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

      if (url.pathname === "/api/reports/scrap-reasons") {
        return handleApiReportsScrapReasons(request, env);
      }

      if (url.pathname === "/api/reports/incidents-trend") {
        return handleIncidentTrend(request, env);
      }

      if (url.pathname === "/api/reports/incidents-summary") {
        return handleIncidentSummary(request, env);
      }

      if (url.pathname === "/api/reports/incidents-list") {
        return handleIncidentList(request, env);
      }

      if (url.pathname === "/api/reports/incidents-detail") {
        return handleIncidentDetail(request, env);
      }

      if (url.pathname === "/api/parts") {
        return handleApiParts(request, env);
      }

      if (url.pathname === "/api/combos") {
        return handleApiCombos(request, env);
      }

      if (url.pathname === "/api/jobs" || url.pathname.startsWith("/api/jobs/")) {
        return handleApiJobs(request, env);
      }

      if (url.pathname === "/api/bead-types") {
        return handleApiBeadTypes(request, env);
      }

      if (url.pathname === "/api/bead-stock") {
        return handleApiBeadStock(request, env);
      }

      if (url.pathname === "/api/block-inventory") {
        return handleApiBlockInventory(request, env);
      }

      if (url.pathname === "/api/molding-log") {
        return handleApiMoldingLog(request, env);
      }

      if (url.pathname === "/api/block-consumption") {
        return handleApiBlockConsumption(request, env);
      }

      if (url.pathname === "/api/shipments") {
        return handleApiShipments(request, env);
      }

      if (url.pathname === "/api/bol-customers/seed") {
        return handleApiBolCustomersSeed(request, env);
      }

      if (url.pathname === "/api/bol-customers") {
        return handleApiBolCustomers(request, env);
      }

      if (url.pathname === "/api/bol-carriers") {
        return handleApiBolCarriers(request, env);
      }

      if (url.pathname === "/api/bols/next-number") {
        return handleApiBolsNextNumber(request, env);
      }

      if (url.pathname === "/api/bols" || url.pathname.startsWith("/api/bols/")) {
        return handleApiBols(request, env);
      }

      if (url.pathname === "/api/load-builder-skus/seed") {
        return handleApiPartsSeed(request, env);
      }

      if (url.pathname === "/api/load-builder-skus/all") {
        return handleApiLoadBuilderSkusDeleteAll(request, env);
      }

      if (url.pathname === "/api/load-builder-skus" || url.pathname.startsWith("/api/load-builder-skus/")) {
        return handleApiLoadBuilderSkus(request, env);
      }

      if (url.pathname === "/api/activity-log" || url.pathname.startsWith("/api/activity-log/")) {
        return handleApiActivityLog(request, env);
      }

      // 3) Static site passthrough (Pages assets binding)
      if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
        return new Response(
          "Worker error: env.ASSETS is missing.\n\n" +
            "This usually means the deployment is not providing the Pages assets binding.\n" +
            "Confirm _worker.js is at the deployment root next to index.html.\n",
          {
            status: 500,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        );
      }

      return await env.ASSETS.fetch(request);
    } catch (err) {
      const msg =
        err && (err.stack || err.message)
          ? err.stack || err.message
          : String(err);

      return new Response("Worker crashed:\n\n" + msg, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
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

async function logActivity(db, action, entityType, entityId, summary, detail) {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail || {});
    await db.prepare(
      `INSERT INTO activity_log (id, timestamp, action, entity_type, entity_id, summary, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, now, action, entityType, String(entityId || ''),
      String(summary || '').slice(0, 500),
      detailStr.slice(0, 2000),
      now
    ).run();
  } catch (e) {
    console.error('Activity log write failed:', e);
  }
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
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

async function hashIp(ip) {
  if (!ip) return null;
  try {
    const data = new TextEncoder().encode(ip);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
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

    if (!employee_name)
      return json({ ok: false, error: "Name required." }, 400);
    if (!block_id) return json({ ok: false, error: "block_id required." }, 400);
    if (!block_title)
      return json({ ok: false, error: "block_title required." }, 400);
    if (!attested)
      return json({ ok: false, error: "Attestation required." }, 400);

    const ip = request.headers.get("CF-Connecting-IP");
    const ip_hash = await hashIp(ip);
    const user_agent = request.headers.get("User-Agent") || null;

    try {
      await db
        .prepare(
          `
        INSERT INTO completions
        (employee_name, block_id, block_title, attested, ip_hash, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        )
        .bind(employee_name, block_id, block_title, 1, ip_hash, user_agent)
        .run();

      return json({ ok: true, message: "Completion recorded." }, 201);
    } catch (e) {
      const msg = String(e?.message || e);

      if (/constraint/i.test(msg) || /unique/i.test(msg)) {
        return json(
          {
            ok: false,
            error: "Already submitted today.",
            code: "DUPLICATE_TODAY",
          },
          409,
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
    const limit = Math.min(
      Math.max(parseInt(params.get("limit") || "200", 10), 1),
      2000,
    );
    const offset = Math.max(parseInt(params.get("offset") || "0", 10), 0);

    const results = await db
      .prepare(
        `
      SELECT id, employee_name, block_id, block_title,
             attested, submitted_at, submitted_date
      FROM completions
      ORDER BY submitted_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .bind(limit, offset)
      .all();

    return json({ ok: true, rows: results.results || [], limit, offset });
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

// Week Helper
function getWeekNumberMondayStart(date) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
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
        "Content-Type": "application/json",
      },
      body: JSON.stringify(record),
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
  const allowedMachines = [
    "Blue Line",
    "Main Line",
    "Cross Cutter",
    "Hole Cutter",
  ];
  const allowedReasons = [
    "Incorrect Cut",
    "Hole Pass Issue",
    "Dirty / Wet Foam",
    "Equipment Issue",
    "Setup Error",
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
  if (!allowedShifts.includes(shift))
    return json({ ok: false, error: "Invalid shift." }, 400);
  if (!operator_name)
    return json({ ok: false, error: "Operator required." }, 400);
  if (!allowedMachines.includes(line_machine))
    return json({ ok: false, error: "Invalid line / machine." }, 400);
  if (!inv_number) return json({ ok: false, error: "INV # required." }, 400);
  if (!part_product)
    return json({ ok: false, error: "Part / Product required." }, 400);
  if (!material_density)
    return json({ ok: false, error: "Material / Density required." }, 400);
  if (!allowedReasons.includes(scrap_reason))
    return json({ ok: false, error: "Invalid scrap reason." }, 400);
  if (!Number.isFinite(scrap_cubic_in) || scrap_cubic_in <= 0) {
    return json(
      { ok: false, error: "Scrap Cubic In must be greater than 0." },
      400,
    );
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
    created_at,
  };

  try {
    await db
      .prepare(
        `
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
    `,
      )
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
        record.created_at,
      )
      .run();

    const mirrorResult = await mirrorScrapLogToSheet(record, env);

    return json(
      {
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
          created_at: record.created_at,
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
async function handleApiReportsScrapSummary(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  if (request.method !== "GET") {
    return json({ ok: false, error: "Method Not Allowed" }, 405);
  }

  const url = new URL(request.url);
  const month = String(url.searchParams.get("month") || "").trim();

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return json(
      { ok: false, error: "Invalid or missing month. Use YYYY-MM" },
      400,
    );
  }

  try {
    const total = await db
      .prepare(
        `
      SELECT
        COALESCE(SUM(scrap_board_ft),0) AS total_scrap_board_ft,
        COUNT(*) AS entry_count
      FROM scrap_log
      WHERE strftime('%Y-%m', event_date) = ?
    `,
      )
      .bind(month)
      .first();

    const byWeek = await db
      .prepare(
        `
      SELECT
        week_number,
        COALESCE(SUM(scrap_board_ft),0) AS scrap_board_ft
      FROM scrap_log
      WHERE strftime('%Y-%m', event_date) = ?
      GROUP BY week_number
      ORDER BY week_number
    `,
      )
      .bind(month)
      .all();

    const byReason = await db
      .prepare(
        `
      SELECT
        scrap_reason,
        COALESCE(SUM(scrap_board_ft),0) AS scrap_board_ft
      FROM scrap_log
      WHERE strftime('%Y-%m', event_date) = ?
      GROUP BY scrap_reason
      ORDER BY scrap_board_ft DESC
    `,
      )
      .bind(month)
      .all();

    return json({
      ok: true,
      month,
      total_scrap_board_ft: total?.total_scrap_board_ft || 0,
      entry_count: total?.entry_count || 0,
      by_week: byWeek.results || [],
      by_reason: byReason.results || [],
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "Server error",
        detail: String(e?.message || e),
      },
      500,
    );
  }
}

async function handleApiReportsScrapTrend(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing DB binding" }, 500);

  if (request.method !== "GET") {
    return json({ ok: false, error: "Method Not Allowed" }, 405);
  }

  const url = new URL(request.url);
  const monthsRequested = Number(url.searchParams.get("months")) || 6;

  try {
    const rows = await db
      .prepare(
        `
      SELECT
        strftime('%Y-%m', event_date) AS month,
        ROUND(SUM(scrap_board_ft),2) AS total_scrap_board_ft
      FROM scrap_log
      GROUP BY month
      ORDER BY month ASC
    `,
      )
      .all();

    let data = rows.results || [];

    // Keep last N months
    data = data.slice(-monthsRequested);

    const latest = data[data.length - 1] || null;
    const previous = data[data.length - 2] || null;

    let delta = null;

    if (latest && previous) {
      const abs = latest.total_scrap_board_ft - previous.total_scrap_board_ft;

      const pct =
        previous.total_scrap_board_ft === 0
          ? null
          : (abs / previous.total_scrap_board_ft) * 100;

      delta = {
        absolute: Number(abs.toFixed(2)),
        percent: pct !== null ? Number(pct.toFixed(2)) : null,
      };
    }

    return json({
      ok: true,
      range_months: monthsRequested,
      months: data,
      latest,
      previous,
      delta,
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "Server error",
        detail: String(e?.message || e),
      },
      500,
    );
  }
}

async function handleApiReportsScrapReasons(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  if (request.method !== "GET") {
    return json({ ok: false, error: "Method Not Allowed" }, 405);
  }

  const url = new URL(request.url);
  const month = String(url.searchParams.get("month") || "").trim();

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return json(
      { ok: false, error: "Invalid or missing month. Use YYYY-MM" },
      400,
    );
  }

  try {
    const byReason = await db
      .prepare(
        `
      SELECT
        scrap_reason,
        ROUND(COALESCE(SUM(scrap_board_ft), 0), 2) AS scrap_board_ft,
        COUNT(*) AS entry_count
      FROM scrap_log
      WHERE strftime('%Y-%m', event_date) = ?
      GROUP BY scrap_reason
      ORDER BY scrap_board_ft DESC, scrap_reason ASC
    `,
      )
      .bind(month)
      .all();

    const total = await db
      .prepare(
        `
      SELECT
        ROUND(COALESCE(SUM(scrap_board_ft), 0), 2) AS total_scrap_board_ft,
        COUNT(*) AS entry_count
      FROM scrap_log
      WHERE strftime('%Y-%m', event_date) = ?
    `,
      )
      .bind(month)
      .first();

    return json({
      ok: true,
      month,
      total_scrap_board_ft: Number(total?.total_scrap_board_ft || 0),
      entry_count: Number(total?.entry_count || 0),
      by_reason: byReason.results || [],
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "Server error",
        detail: String(e?.message || e),
      },
      500,
    );
  }
}

function parseIncidentRows(gvizData) {
  const rows = gvizData?.table?.rows || [];
  const cols = gvizData?.table?.cols || [];

  function getCellText(cell) {
    if (!cell) return "";
    if (cell.f != null && String(cell.f).trim()) return String(cell.f).trim();
    if (cell.v == null) return "";
    return String(cell.v).trim();
  }

  function normalizeLabel(label) {
    return String(label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function normalizeIncidentMonth(value) {
    const text = String(value || "").trim();
    const dashMatch = text.match(/^(\d{4})-(\d{2})/);
    if (dashMatch) return `${dashMatch[1]}-${dashMatch[2]}`;

    const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      return `${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}`;
    }

    return "";
  }

  const labelToIndex = {};
  cols.forEach((col, index) => {
    const normalized = normalizeLabel(col?.label || col?.id || "");
    if (normalized && labelToIndex[normalized] === undefined) {
      labelToIndex[normalized] = index;
    }
  });

  function getFieldValue(cells, labels, fallbackIndex) {
    for (const label of labels) {
      const index = labelToIndex[normalizeLabel(label)];
      if (index !== undefined) {
        const value = getCellText(cells[index]);
        if (value) return value;
      }
    }

    if (fallbackIndex !== undefined) {
      return getCellText(cells[fallbackIndex]);
    }

    return "";
  }

  return rows.map((r, index) => {
    const cells = r.c || [];
    const rawIncidentMonth = getFieldValue(
      cells,
      ["incidentmonth", "month", "reportmonth"],
      11,
    );
    const month = normalizeIncidentMonth(rawIncidentMonth);
    const year =
      getFieldValue(cells, ["year"], 7) || (month ? month.slice(0, 4) : "");

    return {
      incident_id: `row-${index + 1}`,
      sheet_row: index + 1,

      // Core fields
      customer: getFieldValue(cells, ["customer", "customername"], 1),
      incident_type: getFieldValue(
        cells,
        ["incidentcategory", "incidenttype", "category", "type"],
        2,
      ),
      year,
      risk_level: getFieldValue(cells, ["risklevel", "risk"], 13),

      // Derived
      month,

      // Detail fields
      date:
        getFieldValue(cells, ["date", "incidentdate", "reportdate"]) ||
        rawIncidentMonth ||
        "",
      title: getFieldValue(cells, ["title", "incidenttitle", "subject"]),
      summary: getFieldValue(cells, ["notes", "summary", "incidentsummary"], 3),
      location: getFieldValue(cells, ["location"]),
      reported_by: getFieldValue(
        cells,
        [
          "reportingindividual",
          "reportedby",
          "personcompletingreport",
          "personcompleting",
        ],
      ),
      immediate_actions: getFieldValue(
        cells,
        ["immediateactions", "containmentactions", "actions"],
      ),
      root_cause: getFieldValue(
        cells,
        ["rootcausedescription", "rootcause"],
      ),
      corrective_action: getFieldValue(
        cells,
        ["correctiveactions", "correctiveaction"],
      ),
      injury: getFieldValue(cells, ["injury"]),
      property_damage: getFieldValue(cells, ["propertydamage"]),
      witnesses: getFieldValue(cells, ["witnesses", "witness"]),
    };
  });
}

async function fetchIncidentData(env) {
  const sheetUrl = env.INCIDENT_TRACKER_JSON_URL;

  if (!sheetUrl) {
    throw new Error("Incident sheet URL not configured");
  }

  const res = await fetch(sheetUrl);
  const text = await res.text();

  const jsonText = text
    .replace("/*O_o*/", "")
    .replace("google.visualization.Query.setResponse(", "")
    .slice(0, -2);

  return JSON.parse(jsonText);
}

async function handleIncidentTrend(request, env) {
  const url = new URL(request.url);
  const year = url.searchParams.get("year");

  if (!year) {
    return json({ ok: false, error: "Missing year parameter" }, 400);
  }

  try {
    const data = await fetchIncidentData(env);
    const incidents = parseIncidentRows(data);
    const incidentsForYear = incidents.filter((incident) => {
      return incident.month && String(incident.year) === String(year);
    });

    const monthOrder = [
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
    ];
    const counts = {};

    monthOrder.forEach((m) => {
      counts[m] = 0;
    });

    incidentsForYear.forEach((incident) => {
      const monthPart = incident.month.split("-")[1];
      if (counts[monthPart] !== undefined) {
        counts[monthPart]++;
      }
    });

    const result = monthOrder.map((m) => ({
      month: `${year}-${m}`,
      count: counts[m],
    }));

    return json({
      ok: true,
      year,
      months: result,
      total: result.reduce((sum, row) => sum + row.count, 0),
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "Incident trend fetch failed",
        detail: String(e?.message || e),
      },
      500,
    );
  }
}

async function handleIncidentSummary(request, env) {
  const url = new URL(request.url);
  const year = url.searchParams.get("year");

  if (!year) {
    return json({ ok: false, error: "Missing year parameter" }, 400);
  }

  try {
    const data = await fetchIncidentData(env);
    const incidents = parseIncidentRows(data);
    const incidentsForYear = incidents.filter(
      (incident) => String(incident.year) === String(year),
    );

    let total = 0;
    let highRisk = 0;

    const customerCounts = {};
    const typeCounts = {
      Fusion: 0,
      Density: 0,
      Tolerances: 0,
      Packaging: 0,
      Delivery: 0,
      Other: 0,
    };

    const riskCounts = {
      "1 - Low Risk": 0,
      "2 - Medium Risk": 0,
      "3 - High Risk": 0,
      Unspecified: 0,
    };

    incidentsForYear.forEach((incident) => {
      total++;

      const customer = incident.customer || "Unspecified";
      const type = incident.incident_type || "Other";
      const risk = incident.risk_level || "Unspecified";

      customerCounts[customer] = (customerCounts[customer] || 0) + 1;

      if (Object.prototype.hasOwnProperty.call(typeCounts, type)) {
        typeCounts[type]++;
      } else {
        typeCounts.Other++;
      }

      const normalizedRisk = Object.prototype.hasOwnProperty.call(
        riskCounts,
        risk,
      )
        ? risk
        : "Unspecified";

      riskCounts[normalizedRisk]++;

      if (normalizedRisk === "3 - High Risk") {
        highRisk++;
      }
    });

    const uniqueCustomers = Object.keys(customerCounts).length;

    const typeBreakdown = Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

    const riskBreakdown = Object.entries(riskCounts).map(([risk, count]) => ({
      risk,
      count,
    }));

    const customerBreakdown = Object.entries(customerCounts)
      .map(([customer, count]) => ({ customer, count }))
      .sort(
        (a, b) => b.count - a.count || a.customer.localeCompare(b.customer),
      );

    const topType = typeBreakdown.length ? typeBreakdown[0].type : null;

    return json({
      ok: true,
      year,
      total,
      highRisk,
      uniqueCustomers,
      topType,
      typeBreakdown,
      riskBreakdown,
      customerBreakdown,
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "Incident summary fetch failed",
        detail: String(e?.message || e),
      },
      500,
    );
  }
}

async function handleIncidentList(request, env) {
  if (request.method !== "GET") {
    return json({ ok: false, error: "Method Not Allowed" }, 405);
  }

  const url = new URL(request.url);
  const year = url.searchParams.get("year");
  const type = (url.searchParams.get("type") || "").trim();
  const month = (url.searchParams.get("month") || "").trim();
  const risk = (url.searchParams.get("risk") || "").trim();

  if (!year) {
    return json({ ok: false, error: "Missing year parameter" }, 400);
  }

  try {
    const data = await fetchIncidentData(env);
    const incidents = parseIncidentRows(data);

    const items = incidents
      .filter((incident) => {
        if (String(incident.year) !== String(year)) return false;
        if (type && incident.incident_type !== type) return false;
        if (month && incident.month !== month) return false;
        if (risk && incident.risk_level !== risk) return false;
        return true;
      })
      .map((incident) => ({
        incident_id: incident.incident_id,
        sheet_row: incident.sheet_row,
        month: incident.month,
        customer: incident.customer,
        incident_type: incident.incident_type,
        risk_level: incident.risk_level,
        summary: incident.summary,
      }));

    return json({
      ok: true,
      year,
      filters: {
        type,
        month,
        risk,
      },
      count: items.length,
      items,
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "Incident list fetch failed",
        detail: String(e?.message || e),
      },
      500,
    );
  }
}

async function handleIncidentDetail(request, env) {
  if (request.method !== "GET") {
    return json({ ok: false, error: "Method Not Allowed" }, 405);
  }

  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").trim();

  if (!id) {
    return json({ ok: false, error: "Missing id parameter" }, 400);
  }

  try {
    const data = await fetchIncidentData(env);
    const incidents = parseIncidentRows(data);
    const incident = incidents.find((item) => item.incident_id === id);

    if (!incident) {
      return json({ ok: false, error: "Incident not found" }, 404);
    }

    return json({
      ok: true,
      item: {
        incident_id: incident.incident_id,
        date: incident.date,
        month: incident.month,
        year: incident.year,
        customer: incident.customer,
        incident_type: incident.incident_type,
        risk_level: incident.risk_level,
        summary: incident.summary,
      },
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "Incident detail fetch failed",
        detail: String(e?.message || e),
      },
      500,
    );
  }
}

// ─── Production: Parts Library & Saved Combinations ──────────────────────────
//
// Schema — run via Wrangler CLI before deploying:
//
// CREATE TABLE IF NOT EXISTS parts (
//   id TEXT PRIMARY KEY,
//   part_number TEXT NOT NULL,
//   name TEXT NOT NULL DEFAULT '',
//   customer TEXT NOT NULL DEFAULT '',
//   density_material TEXT NOT NULL DEFAULT '',
//   length_in REAL NOT NULL,
//   width_in REAL NOT NULL,
//   height_in REAL NOT NULL,
//   weight REAL NOT NULL DEFAULT 1,
//   notes TEXT NOT NULL DEFAULT '',
//   color TEXT NOT NULL DEFAULT '#D97706',
//   allow_rotation INTEGER NOT NULL DEFAULT 0,
//   sort_order INTEGER NOT NULL DEFAULT 0,
//   category TEXT NOT NULL DEFAULT '',
//   parent_group TEXT NOT NULL DEFAULT '',
//   created_at TEXT NOT NULL DEFAULT (datetime('now')),
//   updated_at TEXT NOT NULL DEFAULT (datetime('now'))
// );
// CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_part_number ON parts(part_number);
// CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category);
//
// CREATE TABLE IF NOT EXISTS saved_combos (
//   id TEXT PRIMARY KEY,
//   name TEXT NOT NULL,
//   description TEXT NOT NULL DEFAULT '',
//   block_l REAL NOT NULL,
//   block_w REAL NOT NULL,
//   block_h REAL NOT NULL,
//   kerf REAL NOT NULL DEFAULT 0.079,
//   orientation_mode TEXT NOT NULL DEFAULT 'auto',
//   machines_active TEXT NOT NULL DEFAULT '["cross_cutter","main_line","blue_line"]',
//   primary_part_id TEXT,
//   primary_part_snapshot TEXT NOT NULL,
//   secondary_parts_snapshot TEXT NOT NULL DEFAULT '[]',
//   result_snapshot TEXT NOT NULL DEFAULT '{}',
//   created_at TEXT NOT NULL DEFAULT (datetime('now')),
//   updated_at TEXT NOT NULL DEFAULT (datetime('now'))
// );

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

async function handleApiParts(request, env) {
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

    if (!part_number) return json({ ok: false, error: "Part number is required." }, 400);
    if (!Number.isFinite(length_in) || length_in <= 0) return json({ ok: false, error: "Length must be greater than 0." }, 400);
    if (!Number.isFinite(width_in)  || width_in  <= 0) return json({ ok: false, error: "Width must be greater than 0." }, 400);
    if (!Number.isFinite(height_in) || height_in <= 0) return json({ ok: false, error: "Height must be greater than 0." }, 400);

    const id  = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await db.prepare(
        `INSERT INTO parts (id, part_number, name, customer, density_material, length_in, width_in, height_in, weight, notes, color, allow_rotation, sort_order, category, parent_group, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, part_number, name, customer, density_material, length_in, width_in, height_in, weight, notes, color, allow_rotation, sort_order, category, parent_group, now, now).run();

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
      await db.prepare(
        `UPDATE parts SET part_number=?, customer=?, density_material=?, length_in=?, width_in=?, height_in=?, notes=?, updated_at=? WHERE id=?`
      ).bind(part_number, customer, density_material, length_in, width_in, height_in, notes, now, id).run();

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

async function handleApiCombos(request, env) {
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

// ─── Jobs: Job Board ─────────────────────────────────────────────────────────
//
// Schema — run via Wrangler CLI before deploying:
//
// CREATE TABLE IF NOT EXISTS jobs (
//   id TEXT PRIMARY KEY,
//   status TEXT NOT NULL DEFAULT 'not_started',
//   customer TEXT NOT NULL,
//   po_number TEXT NOT NULL DEFAULT '',
//   invoice_number TEXT NOT NULL DEFAULT '',
//   ship_date TEXT NOT NULL DEFAULT '',
//   ship_day TEXT NOT NULL DEFAULT '',
//   location TEXT NOT NULL DEFAULT '',
//   delivery_time TEXT NOT NULL DEFAULT '',
//   method TEXT NOT NULL DEFAULT '',
//   carrier TEXT NOT NULL DEFAULT '',
//   load_count INTEGER NOT NULL DEFAULT 1,
//   total_bdft REAL NOT NULL DEFAULT 0,
//   scrap_pickup TEXT NOT NULL DEFAULT '',
//   sales_lead TEXT NOT NULL DEFAULT '',
//   bol_info TEXT NOT NULL DEFAULT '',
//   payment_info TEXT NOT NULL DEFAULT '',
//   notes TEXT NOT NULL DEFAULT '',
//   packing_instructions TEXT NOT NULL DEFAULT '',
//   contact_name TEXT NOT NULL DEFAULT '',
//   contact_phone TEXT NOT NULL DEFAULT '',
//   combo_id TEXT DEFAULT NULL,
//   priority TEXT NOT NULL DEFAULT 'normal',
//   confirmed_to_ship INTEGER NOT NULL DEFAULT 0,
//   processes TEXT NOT NULL DEFAULT '[]',
//   created_at TEXT NOT NULL DEFAULT (datetime('now')),
//   updated_at TEXT NOT NULL DEFAULT (datetime('now'))
// );
//
// Migration (run once if jobs table already exists):
// ALTER TABLE jobs ADD COLUMN processes TEXT NOT NULL DEFAULT '[]';
// CREATE INDEX IF NOT EXISTS idx_jobs_status    ON jobs(status);
// CREATE INDEX IF NOT EXISTS idx_jobs_ship_date ON jobs(ship_date);
// CREATE INDEX IF NOT EXISTS idx_jobs_customer  ON jobs(customer);
//
// CREATE TABLE IF NOT EXISTS job_line_items (
//   id TEXT PRIMARY KEY,
//   job_id TEXT NOT NULL,
//   part_id TEXT DEFAULT NULL,
//   part_number TEXT NOT NULL DEFAULT '',
//   description TEXT NOT NULL DEFAULT '',
//   quantity INTEGER NOT NULL DEFAULT 0,
//   dimensions TEXT NOT NULL DEFAULT '',
//   sort_order INTEGER NOT NULL DEFAULT 0,
//   FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
// );
// CREATE INDEX IF NOT EXISTS idx_job_items_job ON job_line_items(job_id);
//
// Migration: Add packing slip storage to jobs (run once against D1)
// ALTER TABLE jobs ADD COLUMN packing_slip_pdf TEXT DEFAULT NULL;
// ALTER TABLE jobs ADD COLUMN packing_slip_filename TEXT NOT NULL DEFAULT '';
// ALTER TABLE jobs ADD COLUMN packing_slip_invoice TEXT NOT NULL DEFAULT '';
// ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

async function handleApiJobs(request, env) {
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
    j.priority, j.confirmed_to_ship, j.processes, j.created_at, j.updated_at,
    j.packing_slip_filename, j.packing_slip_invoice, j.source,
    CASE WHEN EXISTS (SELECT 1 FROM shipments s WHERE s.job_id = j.id AND s.direction = 'outbound') THEN 1 ELSE 0 END AS has_shipment
  `;

  // ── GET /api/jobs/:id/packing-slip ───────────────────────────────────────
  if (request.method === "GET" && jobId && subRoute === "packing-slip") {
    try {
      const row = await db
        .prepare("SELECT packing_slip_pdf, packing_slip_filename FROM jobs WHERE id = ?")
        .bind(jobId).first();
      if (!row) return json({ ok: false, error: "Job not found." }, 404);
      if (!row.packing_slip_pdf) return json({ ok: false, error: "No packing slip attached to this job." }, 404);

      const binary = Uint8Array.from(atob(row.packing_slip_pdf), c => c.charCodeAt(0));
      const filename = row.packing_slip_filename || "packing-slip.pdf";
      return new Response(binary, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename.replace(/"/g, '')}"`,
          "Cache-Control": "private, max-age=3600",
        },
      });
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
        job: { ...row, processes: safeJsonParse(row.processes, []), line_items: liResult.results || [] },
      });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── GET ──────────────────────────────────────────────────────────────────
  if (request.method === "GET") {
    const searchParam = (url.searchParams.get("search") || "").trim();
    const weekParam   = (url.searchParams.get("week")   || "").trim();
    const statusParam = (url.searchParams.get("status") || "").trim();

    let query, binds;

    if (searchParam) {
      const like = `%${searchParam}%`;
      query = `SELECT ${JOB_LIST_COLS} FROM jobs j WHERE (j.customer LIKE ? OR j.po_number LIKE ? OR j.invoice_number LIKE ?) ORDER BY j.ship_date DESC LIMIT 10`;
      binds = [like, like, like];
    } else if (weekParam) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
        return json({ ok: false, error: "Invalid week. Use YYYY-MM-DD (Monday of week)." }, 400);
      }
      // Monday through Friday of the requested week
      query = `SELECT ${JOB_LIST_COLS} FROM jobs j WHERE j.ship_date >= ? AND j.ship_date <= date(?, '+4 days') ORDER BY j.ship_date ASC, j.created_at ASC`;
      binds = [weekParam, weekParam];
    } else if (statusParam) {
      const statuses = statusParam.split(",").map(s => s.trim()).filter(Boolean);
      const valid    = ["not_started", "in_production", "done", "loading", "shipped"];
      for (const s of statuses) {
        if (!valid.includes(s)) return json({ ok: false, error: `Invalid status: ${s}` }, 400);
      }
      const placeholders = statuses.map(() => "?").join(",");
      query = `SELECT ${JOB_LIST_COLS} FROM jobs j WHERE j.status IN (${placeholders}) ORDER BY j.ship_date ASC, j.created_at ASC`;
      binds = statuses;
    } else {
      // Default: all active + shipped in the last 7 days
      query = `SELECT ${JOB_LIST_COLS} FROM jobs j WHERE j.status != 'shipped' OR (j.status = 'shipped' AND j.ship_date >= date('now', '-7 days')) ORDER BY j.ship_date ASC, j.created_at ASC`;
      binds = [];
    }

    try {
      const jobsResult = binds.length
        ? await db.prepare(query).bind(...binds).all()
        : await db.prepare(query).all();

      const jobs = jobsResult.results || [];

      // Batch-fetch line items for all returned jobs
      const lineItemsMap = {};
      if (jobs.length > 0) {
        const ids = jobs.map(j => j.id);
        const ph  = ids.map(() => "?").join(",");
        const liResult = await db
          .prepare(`SELECT * FROM job_line_items WHERE job_id IN (${ph}) ORDER BY job_id, sort_order ASC`)
          .bind(...ids)
          .all();
        for (const item of (liResult.results || [])) {
          if (!lineItemsMap[item.job_id]) lineItemsMap[item.job_id] = [];
          lineItemsMap[item.job_id].push(item);
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
    const combo_id             = payload.combo_id ? String(payload.combo_id).trim() : null;
    const load_count           = Number.isFinite(Number(payload.load_count)) ? Number(payload.load_count) : 1;
    const total_bdft           = Number.isFinite(Number(payload.total_bdft)) ? Number(payload.total_bdft) : 0;
    const confirmed_to_ship    = payload.confirmed_to_ship ? 1 : 0;
    const processes            = Array.isArray(payload.processes) ? JSON.stringify(payload.processes) : '[]';

    // Packing slip fields (optional — present when job is created from an uploaded PDF)
    const packing_slip_pdf      = payload.packing_slip_pdf ? String(payload.packing_slip_pdf) : null;
    const packing_slip_filename = String(payload.packing_slip_filename || "").trim();
    const packing_slip_invoice  = String(payload.packing_slip_invoice  || "").trim();
    const source = ["manual", "packing_slip"].includes(String(payload.source || "").trim())
      ? String(payload.source).trim() : "manual";

    try {
      await db.prepare(`
        INSERT INTO jobs (
          id, status, customer, po_number, invoice_number, ship_date, ship_day,
          location, delivery_time, method, carrier, load_count, total_bdft,
          scrap_pickup, sales_lead, bol_info, payment_info, notes,
          packing_instructions, contact_name, contact_phone, combo_id,
          priority, confirmed_to_ship, processes, created_at, updated_at,
          packing_slip_pdf, packing_slip_filename, packing_slip_invoice, source,
          ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
          ship_to_city, ship_to_state, ship_to_zip
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id, status, customer, po_number, invoice_number, ship_date, ship_day,
        location, delivery_time, method, carrier, load_count, total_bdft,
        scrap_pickup, sales_lead, bol_info, payment_info, notes,
        packing_instructions, contact_name, contact_phone, combo_id,
        priority, confirmed_to_ship, processes, now, now,
        packing_slip_pdf, packing_slip_filename, packing_slip_invoice, source,
        ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
        ship_to_city, ship_to_state, ship_to_zip,
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
             destination, ship_date, delivery_date, status, total_bdft, load_count,
             weight_lbs, bead_type, notes, trailer_number)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          shipmentId, 'outbound', id,
          customer,
          carrier || '',
          method  || '',
          '',
          'XPanda Foam',
          location || '',
          ship_date || '',
          '',
          'scheduled',
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
      if (!["not_started", "in_production", "done", "loading", "shipped"].includes(v))
        return json({ ok: false, error: "Invalid status." }, 400);
      sets.push("status = ?"); binds.push(v);
    }

    if ("priority" in payload) {
      const v = String(payload.priority).trim();
      if (!["normal", "rush"].includes(v))
        return json({ ok: false, error: "Invalid priority." }, 400);
      sets.push("priority = ?"); binds.push(v);
    }

    const textFields = [
      "customer", "po_number", "invoice_number", "ship_date", "ship_day",
      "location", "delivery_time", "method", "carrier", "scrap_pickup",
      "sales_lead", "bol_info", "payment_info", "notes",
      "packing_instructions", "contact_name", "contact_phone",
      "packing_slip_filename", "packing_slip_invoice",
      "ship_to_company", "ship_to_attention", "ship_to_street", "ship_to_street2",
      "ship_to_city", "ship_to_state", "ship_to_zip",
    ];
    for (const f of textFields) {
      if (f in payload) { sets.push(`${f} = ?`); binds.push(String(payload[f] || "").trim()); }
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
    // packing_slip_pdf is nullable — pass null to clear, base64 string to set
    if ("packing_slip_pdf" in payload) {
      sets.push("packing_slip_pdf = ?");
      binds.push(payload.packing_slip_pdf ? String(payload.packing_slip_pdf) : null);
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

      const job    = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
      const liRows = await db.prepare("SELECT * FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC").bind(id).all();

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
      // Explicit delete of line items (D1 FK cascade not guaranteed)
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
// INVENTORY SCHEMA (run once against D1)
// =============================================================================
/*
CREATE TABLE IF NOT EXISTS bead_stock (
  id TEXT PRIMARY KEY,
  manufacturer TEXT NOT NULL,
  bead_type TEXT NOT NULL,
  bag_weight_lbs REAL NOT NULL DEFAULT 0,
  bags_on_hand INTEGER NOT NULL DEFAULT 0,
  reorder_point_bags INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bead_mfr_type ON bead_stock(manufacturer, bead_type);

CREATE TABLE IF NOT EXISTS block_inventory (
  id TEXT PRIMARY KEY,
  density_material TEXT NOT NULL,
  length_in REAL NOT NULL,
  width_in REAL NOT NULL,
  height_in REAL NOT NULL,
  blocks_on_hand INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_block_size ON block_inventory(density_material, length_in, width_in, height_in);

CREATE TABLE IF NOT EXISTS molding_log (
  id TEXT PRIMARY KEY,
  bead_stock_id TEXT NOT NULL,
  block_inventory_id TEXT NOT NULL,
  bags_consumed INTEGER NOT NULL,
  blocks_produced INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bead_stock_id) REFERENCES bead_stock(id) ON DELETE CASCADE,
  FOREIGN KEY (block_inventory_id) REFERENCES block_inventory(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mold_date ON molding_log(created_at);

CREATE TABLE IF NOT EXISTS block_consumption_log (
  id TEXT PRIMARY KEY,
  block_inventory_id TEXT NOT NULL,
  job_id TEXT DEFAULT NULL,
  blocks_consumed INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (block_inventory_id) REFERENCES block_inventory(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_consumption_block ON block_consumption_log(block_inventory_id);
CREATE INDEX IF NOT EXISTS idx_consumption_job ON block_consumption_log(job_id);
CREATE INDEX IF NOT EXISTS idx_consumption_date ON block_consumption_log(created_at);
*/

// =============================================================================
// HANDLER: /api/bead-types  (GET / POST / PUT / DELETE)
// =============================================================================
async function handleApiBeadTypes(request, env) {
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
async function handleApiBeadStock(request, env) {
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
async function handleApiBlockInventory(request, env) {
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
async function handleApiMoldingLog(request, env) {
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
async function handleApiBlockConsumption(request, env) {
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
// SHIPMENTS SCHEMA (run once against D1)
// =============================================================================
/*
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL,
  job_id TEXT DEFAULT NULL,
  customer TEXT NOT NULL DEFAULT '',
  carrier TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  bol_number TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  ship_date TEXT NOT NULL DEFAULT '',
  delivery_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',
  total_bdft REAL NOT NULL DEFAULT 0,
  load_count INTEGER NOT NULL DEFAULT 1,
  weight_lbs REAL NOT NULL DEFAULT 0,
  bead_type TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_shipments_direction ON shipments(direction);
CREATE INDEX IF NOT EXISTS idx_shipments_date ON shipments(ship_date);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_job ON shipments(job_id);
*/

// =============================================================================
// HANDLER: /api/shipments  (GET / POST / PUT / DELETE)
// =============================================================================
async function handleApiShipments(request, env) {
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
        `SELECT * FROM shipments ${clause} ORDER BY ship_date DESC, created_at DESC`
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

    const validStatuses = ["scheduled", "in_transit", "delivered", "cancelled"];
    const status = String(payload.status || "scheduled").trim();
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
    const delivery_date = String(payload.delivery_date || "").trim();
    const total_bdft    = Number(payload.total_bdft    ?? 0);
    const load_count    = Math.max(1, parseInt(payload.load_count ?? 1, 10));
    const weight_lbs    = Number(payload.weight_lbs    ?? 0);
    const bead_type     = String(payload.bead_type     || "").trim();
    const notes         = String(payload.notes         || "").trim();
    const trailer_number = String(payload.trailer_number || "").trim();

    try {
      await db.prepare(`
        INSERT INTO shipments
          (id, direction, job_id, customer, carrier, method, bol_number, origin, destination,
           ship_date, delivery_date, status, total_bdft, load_count, weight_lbs, bead_type, notes, trailer_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, direction, job_id, customer, carrier, method_val, bol_number, origin, destination,
        ship_date, delivery_date, status, total_bdft, load_count, weight_lbs, bead_type, notes, trailer_number
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
      "ship_date", "delivery_date", "status", "total_bdft", "load_count",
      "weight_lbs", "bead_type", "notes", "job_id", "trailer_number",
    ];
    const sets = [];
    const vals = [];

    for (const key of allowed) {
      if (!(key in payload)) continue;
      sets.push(`${key} = ?`);
      const raw = payload[key];
      if (key === "job_id") {
        vals.push(raw ? String(raw).trim() : null);
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


// =============================================================================
// BOL GENERATOR — SCHEMA (run once against D1)
// =============================================================================
/*
CREATE TABLE IF NOT EXISTS bol_customers (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  attention TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  street2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bol_customers_company ON bol_customers(company);
CREATE INDEX IF NOT EXISTS idx_bol_customers_active ON bol_customers(is_active);

CREATE TABLE IF NOT EXISTS bol_carriers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scac TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bols (
  id TEXT PRIMARY KEY,
  bol_number INTEGER NOT NULL UNIQUE,
  date TEXT NOT NULL,
  customer_id TEXT DEFAULT NULL,
  ship_to_company TEXT NOT NULL DEFAULT '',
  ship_to_attention TEXT NOT NULL DEFAULT '',
  ship_to_street TEXT NOT NULL DEFAULT '',
  ship_to_street2 TEXT NOT NULL DEFAULT '',
  ship_to_city TEXT NOT NULL DEFAULT '',
  ship_to_state TEXT NOT NULL DEFAULT '',
  ship_to_zip TEXT NOT NULL DEFAULT '',
  location_no TEXT NOT NULL DEFAULT '',
  carrier_id TEXT DEFAULT NULL,
  carrier_name TEXT NOT NULL DEFAULT '',
  trailer_no TEXT NOT NULL DEFAULT '',
  seal_number TEXT NOT NULL DEFAULT '',
  scac TEXT NOT NULL DEFAULT '',
  pro_no TEXT NOT NULL DEFAULT '',
  freight_terms TEXT NOT NULL DEFAULT 'prepaid',
  is_scrap_pickup INTEGER NOT NULL DEFAULT 0,
  third_party_bill_to TEXT NOT NULL DEFAULT '',
  special_instructions TEXT NOT NULL DEFAULT '',
  contact_info TEXT NOT NULL DEFAULT '',
  is_master_bol INTEGER NOT NULL DEFAULT 0,
  commodity_description TEXT NOT NULL DEFAULT '',
  handling_unit_qty TEXT NOT NULL DEFAULT '',
  handling_unit_type TEXT NOT NULL DEFAULT '',
  package_qty TEXT NOT NULL DEFAULT '',
  package_type TEXT NOT NULL DEFAULT '',
  weight TEXT NOT NULL DEFAULT '',
  delivery_time TEXT NOT NULL DEFAULT '',
  job_id TEXT DEFAULT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES bol_customers(id) ON DELETE SET NULL,
  FOREIGN KEY (carrier_id) REFERENCES bol_carriers(id) ON DELETE SET NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_bols_number ON bols(bol_number);
CREATE INDEX IF NOT EXISTS idx_bols_date ON bols(date);
CREATE INDEX IF NOT EXISTS idx_bols_customer ON bols(customer_id);
*/

async function handleApiBolCustomers(request, env) {
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

async function handleApiBolCustomersSeed(request, env) {
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

async function handleApiBolCarriers(request, env) {
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

async function handleApiBolsNextNumber(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, 405);
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  try {
    const row  = await db.prepare("SELECT MAX(bol_number) as max_num FROM bols").first();
    const next = (row && row.max_num != null) ? row.max_num + 1 : 3600;
    return json({ ok: true, next_number: next });
  } catch (e) {
    return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
  }
}

async function handleApiBols(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  const url    = new URL(request.url);
  const method = request.method;
  const parts  = url.pathname.split("/").filter(Boolean); // ["api","bols"] or ["api","bols","<id>"]
  const bolId  = parts.length >= 3 ? parts[2] : null;

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

    let query   = "SELECT * FROM bols";
    const conds = [];
    const binds = [];

    if (jobIds.length) {
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

    // Auto-assign bol_number if not provided
    let bol_number = Number.isFinite(Number(payload.bol_number)) && Number(payload.bol_number) > 0
      ? Number(payload.bol_number) : null;
    if (!bol_number) {
      const row  = await db.prepare("SELECT MAX(bol_number) as max_num FROM bols").first();
      bol_number = (row && row.max_num != null) ? row.max_num + 1 : 3600;
    }

    const id  = crypto.randomUUID();
    const now = new Date().toISOString();
    const s   = (f) => String(payload[f] || "").trim();

    const validTerms     = ["prepaid", "collect", "3rd_party"];
    const freight_terms  = validTerms.includes(s("freight_terms")) ? s("freight_terms") : "prepaid";
    const is_scrap_pickup = payload.is_scrap_pickup ? 1 : 0;

    try {
      await db.prepare(`
        INSERT INTO bols (
          id, bol_number, date, customer_id,
          ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
          ship_to_city, ship_to_state, ship_to_zip, location_no,
          carrier_id, carrier_name, trailer_no, seal_number, scac, pro_no,
          freight_terms, is_scrap_pickup, third_party_bill_to, special_instructions, contact_info, is_master_bol,
          commodity_description, handling_unit_qty, handling_unit_type,
          package_qty, package_type, weight, delivery_time, job_id, notes, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
        s("notes"), now
      ).run();

      const row = await db.prepare("SELECT * FROM bols WHERE id = ?").bind(id).first();
      await logActivity(db, 'create', 'bol', id,
        `Created BOL #${bol_number} for ${s('ship_to_company')}`,
        { bol_number, ship_to_company: s('ship_to_company'), carrier_name: s('carrier_name'), date }
      );
      return json({ ok: true, message: "BOL created.", bol: row }, 201);
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── PUT /api/bols/:id ─────────────────────────────────────────────────────
  if (method === "PUT" && bolId) {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const existing = await db.prepare("SELECT id FROM bols WHERE id = ?").bind(bolId).first();
    if (!existing) return json({ ok: false, error: "BOL not found." }, 404);

    const s = (f) => String(payload[f] || "").trim();
    const validTerms    = ["prepaid", "collect", "3rd_party"];
    const freight_terms = validTerms.includes(s("freight_terms")) ? s("freight_terms") : "prepaid";
    const is_scrap_pickup = payload.is_scrap_pickup ? 1 : 0;

    try {
      await db.prepare(`
        UPDATE bols SET
          date = ?, customer_id = ?,
          ship_to_company = ?, ship_to_attention = ?, ship_to_street = ?, ship_to_street2 = ?,
          ship_to_city = ?, ship_to_state = ?, ship_to_zip = ?, location_no = ?,
          carrier_id = ?, carrier_name = ?, trailer_no = ?, seal_number = ?, scac = ?, pro_no = ?,
          freight_terms = ?, is_scrap_pickup = ?, third_party_bill_to = ?, special_instructions = ?, contact_info = ?,
          is_master_bol = ?, commodity_description = ?, handling_unit_qty = ?, handling_unit_type = ?,
          package_qty = ?, package_type = ?, weight = ?, delivery_time = ?, job_id = ?, notes = ?
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
        s("notes"),
        bolId
      ).run();

      const row = await db.prepare("SELECT * FROM bols WHERE id = ?").bind(bolId).first();
      await logActivity(db, 'update', 'bol', bolId,
        `Updated BOL #${payload.bol_number || bolId}`,
        { fields_updated: Object.keys(payload).filter(k => k !== 'id') }
      );
      return json({ ok: true, message: "BOL updated.", bol: row });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
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
/*
 * DDL — run once in the Cloudflare D1 console before deploying:
 *
 * load_builder_skus has been merged into the unified parts table.
 * See the parts table DDL near handleApiParts above.
 */

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

async function handleApiLoadBuilderSkus(request, env) {
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
    if (!name) return json({ ok: false, error: "Name required." }, 400);
    if (!sku) return json({ ok: false, error: "SKU code required." }, 400);
    if (!length || !width || !height) return json({ ok: false, error: "Dimensions required." }, 400);
    const newId = crypto.randomUUID();
    const countRow = await db.prepare("SELECT COUNT(*) as cnt FROM parts").first();
    const sortOrder = countRow?.cnt || 0;
    await db.prepare(
      "INSERT INTO parts (id, part_number, name, length_in, width_in, height_in, weight, notes, color, allow_rotation, sort_order, category, parent_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(newId, sku, name, +length, +width, +height, +weight || 1, notes || "", color || "#D97706", allowRotation ? 1 : 0, sortOrder, category || "", parent_group || "").run();
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

async function handleApiLoadBuilderSkusDeleteAll(request, env) {
  if (request.method !== "DELETE") return json({ ok: false, error: "Method Not Allowed" }, 405);
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);
  await db.prepare("DELETE FROM parts").run();
  return json({ success: true });
}

async function handleApiPartsSeed(request, env) {
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

async function handleApiActivityLog(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const entityType = url.searchParams.get('entity_type') || '';
  const action = url.searchParams.get('action') || '';

  try {
    let query = "SELECT * FROM activity_log";
    const conditions = [];
    const binds = [];

    if (entityType) {
      conditions.push("entity_type = ?");
      binds.push(entityType);
    }
    if (action) {
      conditions.push("action = ?");
      binds.push(action);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
    binds.push(limit, offset);

    const rows = await db.prepare(query).bind(...binds).all();

    let countQuery = "SELECT COUNT(*) as total FROM activity_log";
    if (conditions.length > 0) {
      countQuery += " WHERE " + conditions.join(" AND ");
    }
    const countBinds = binds.slice(0, -2);
    const countRow = countBinds.length
      ? await db.prepare(countQuery).bind(...countBinds).first()
      : await db.prepare(countQuery).first();

    return json({
      ok: true,
      entries: rows.results || [],
      total: countRow?.total || 0,
      limit,
      offset,
    });
  } catch (e) {
    return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
  }
}
