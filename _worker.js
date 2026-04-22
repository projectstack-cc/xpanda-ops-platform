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
// CREATE TABLE IF NOT EXISTS parts_library (
//   id TEXT PRIMARY KEY,
//   part_number TEXT NOT NULL,
//   customer TEXT NOT NULL DEFAULT '',
//   density_material TEXT NOT NULL DEFAULT '',
//   length_in REAL NOT NULL,
//   width_in REAL NOT NULL,
//   height_in REAL NOT NULL,
//   notes TEXT NOT NULL DEFAULT '',
//   created_at TEXT NOT NULL DEFAULT (datetime('now')),
//   updated_at TEXT NOT NULL DEFAULT (datetime('now'))
// );
// CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_part_number ON parts_library(part_number);
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
        .prepare("SELECT * FROM parts_library ORDER BY part_number ASC")
        .all();
      return json({ ok: true, parts: rows.results || [] });
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

    const part_number = String(payload.part_number || "").trim();
    const customer = String(payload.customer || "").trim();
    const density_material = String(payload.density_material || "").trim();
    const length_in = Number(payload.length_in);
    const width_in = Number(payload.width_in);
    const height_in = Number(payload.height_in);
    const notes = String(payload.notes || "").trim();

    if (!part_number)
      return json({ ok: false, error: "Part number is required." }, 400);
    if (!Number.isFinite(length_in) || length_in <= 0)
      return json({ ok: false, error: "Length must be greater than 0." }, 400);
    if (!Number.isFinite(width_in) || width_in <= 0)
      return json({ ok: false, error: "Width must be greater than 0." }, 400);
    if (!Number.isFinite(height_in) || height_in <= 0)
      return json({ ok: false, error: "Height must be greater than 0." }, 400);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await db
        .prepare(
          `INSERT INTO parts_library
           (id, part_number, customer, density_material, length_in, width_in, height_in, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, part_number, customer, density_material, length_in, width_in, height_in, notes, now, now)
        .run();

      const part = await db
        .prepare("SELECT * FROM parts_library WHERE id = ?")
        .bind(id)
        .first();
      return json({ ok: true, message: "Part created.", part }, 201);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/unique/i.test(msg) || /constraint/i.test(msg)) {
        return json(
          { ok: false, error: "A part with that number already exists.", code: "DUPLICATE_PART_NUMBER" },
          409,
        );
      }
      return json({ ok: false, error: "Server error.", detail: msg }, 500);
    }
  }

  if (request.method === "PUT") {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const id = String(payload.id || "").trim();
    const part_number = String(payload.part_number || "").trim();
    const customer = String(payload.customer || "").trim();
    const density_material = String(payload.density_material || "").trim();
    const length_in = Number(payload.length_in);
    const width_in = Number(payload.width_in);
    const height_in = Number(payload.height_in);
    const notes = String(payload.notes || "").trim();

    if (!id) return json({ ok: false, error: "id is required." }, 400);
    if (!part_number)
      return json({ ok: false, error: "Part number is required." }, 400);
    if (!Number.isFinite(length_in) || length_in <= 0)
      return json({ ok: false, error: "Length must be greater than 0." }, 400);
    if (!Number.isFinite(width_in) || width_in <= 0)
      return json({ ok: false, error: "Width must be greater than 0." }, 400);
    if (!Number.isFinite(height_in) || height_in <= 0)
      return json({ ok: false, error: "Height must be greater than 0." }, 400);

    const existing = await db
      .prepare("SELECT id FROM parts_library WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return json({ ok: false, error: "Part not found." }, 404);

    const now = new Date().toISOString();
    try {
      await db
        .prepare(
          `UPDATE parts_library
           SET part_number=?, customer=?, density_material=?, length_in=?, width_in=?, height_in=?, notes=?, updated_at=?
           WHERE id=?`,
        )
        .bind(part_number, customer, density_material, length_in, width_in, height_in, notes, now, id)
        .run();

      const part = await db
        .prepare("SELECT * FROM parts_library WHERE id = ?")
        .bind(id)
        .first();
      return json({ ok: true, message: "Part updated.", part });
    } catch (e) {
      const msg = String(e?.message || e);
      if (/unique/i.test(msg) || /constraint/i.test(msg)) {
        return json(
          { ok: false, error: "A part with that number already exists.", code: "DUPLICATE_PART_NUMBER" },
          409,
        );
      }
      return json({ ok: false, error: "Server error.", detail: msg }, 500);
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
      .prepare("SELECT id FROM parts_library WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return json({ ok: false, error: "Part not found." }, 404);

    try {
      await db.prepare("DELETE FROM parts_library WHERE id = ?").bind(id).run();
      return json({ ok: true, message: "Part deleted." });
    } catch (e) {
      return json(
        { ok: false, error: "Server error.", detail: String(e?.message || e) },
        500,
      );
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
