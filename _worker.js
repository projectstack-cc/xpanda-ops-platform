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

      if (url.pathname === "/api/jobs") {
        return handleApiJobs(request, env);
      }

      if (url.pathname === "/api/bead-types") {
        return handleApiBeadTypes(request, env);
      }

      if (url.pathname === "/api/silos") {
        return handleApiSilos(request, env);
      }

      if (url.pathname === "/api/bead-transactions") {
        return handleApiBeadTransactions(request, env);
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
//   created_at TEXT NOT NULL DEFAULT (datetime('now')),
//   updated_at TEXT NOT NULL DEFAULT (datetime('now'))
// );
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

async function handleApiJobs(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  // ── GET ──────────────────────────────────────────────────────────────────
  if (request.method === "GET") {
    const url         = new URL(request.url);
    const weekParam   = (url.searchParams.get("week")   || "").trim();
    const statusParam = (url.searchParams.get("status") || "").trim();

    let query, binds;

    if (weekParam) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
        return json({ ok: false, error: "Invalid week. Use YYYY-MM-DD (Monday of week)." }, 400);
      }
      // Monday through Friday of the requested week
      query = `SELECT * FROM jobs WHERE ship_date >= ? AND ship_date <= date(?, '+4 days') ORDER BY ship_date ASC, created_at ASC`;
      binds = [weekParam, weekParam];
    } else if (statusParam) {
      const statuses = statusParam.split(",").map(s => s.trim()).filter(Boolean);
      const valid    = ["not_started", "in_production", "done", "shipped"];
      for (const s of statuses) {
        if (!valid.includes(s)) return json({ ok: false, error: `Invalid status: ${s}` }, 400);
      }
      const placeholders = statuses.map(() => "?").join(",");
      query = `SELECT * FROM jobs WHERE status IN (${placeholders}) ORDER BY ship_date ASC, created_at ASC`;
      binds = statuses;
    } else {
      // Default: all active + shipped in the last 7 days
      query = `SELECT * FROM jobs WHERE status != 'shipped' OR (status = 'shipped' AND ship_date >= date('now', '-7 days')) ORDER BY ship_date ASC, created_at ASC`;
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

    const validStatuses = ["not_started", "in_production", "done", "shipped"];
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
    const combo_id             = payload.combo_id ? String(payload.combo_id).trim() : null;
    const load_count           = Number.isFinite(Number(payload.load_count)) ? Number(payload.load_count) : 1;
    const total_bdft           = Number.isFinite(Number(payload.total_bdft)) ? Number(payload.total_bdft) : 0;
    const confirmed_to_ship    = payload.confirmed_to_ship ? 1 : 0;

    try {
      await db.prepare(`
        INSERT INTO jobs (
          id, status, customer, po_number, invoice_number, ship_date, ship_day,
          location, delivery_time, method, carrier, load_count, total_bdft,
          scrap_pickup, sales_lead, bol_info, payment_info, notes,
          packing_instructions, contact_name, contact_phone, combo_id,
          priority, confirmed_to_ship, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id, status, customer, po_number, invoice_number, ship_date, ship_day,
        location, delivery_time, method, carrier, load_count, total_bdft,
        scrap_pickup, sales_lead, bol_info, payment_info, notes,
        packing_instructions, contact_name, contact_phone, combo_id,
        priority, confirmed_to_ship, now, now,
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

      const job    = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
      const liRows = await db.prepare("SELECT * FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC").bind(id).all();

      return json({ ok: true, message: "Job created.", job: { ...job, line_items: liRows.results || [] } }, 201);
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
      if (!["not_started", "in_production", "done", "shipped"].includes(v))
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
    ];
    for (const f of textFields) {
      if (f in payload) { sets.push(`${f} = ?`); binds.push(String(payload[f] || "").trim()); }
    }

    if ("load_count"        in payload) { sets.push("load_count = ?");        binds.push(Number.isFinite(Number(payload.load_count)) ? Number(payload.load_count) : 1); }
    if ("total_bdft"        in payload) { sets.push("total_bdft = ?");        binds.push(Number.isFinite(Number(payload.total_bdft)) ? Number(payload.total_bdft) : 0); }
    if ("confirmed_to_ship" in payload) { sets.push("confirmed_to_ship = ?"); binds.push(payload.confirmed_to_ship ? 1 : 0); }
    if ("combo_id"          in payload) { sets.push("combo_id = ?");          binds.push(payload.combo_id ? String(payload.combo_id).trim() : null); }

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

      return json({ ok: true, message: "Job updated.", job: { ...job, line_items: liRows.results || [] } });
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
      return json({ ok: true, message: "Job deleted." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}


// =============================================================================
// BEAD INVENTORY SCHEMA (run once against D1)
// =============================================================================
/*
CREATE TABLE IF NOT EXISTS bead_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bead_types_name ON bead_types(name);

CREATE TABLE IF NOT EXISTS silos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bead_type_id TEXT DEFAULT NULL,
  capacity_lbs REAL NOT NULL DEFAULT 0,
  current_lbs REAL NOT NULL DEFAULT 0,
  reorder_point_lbs REAL NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bead_type_id) REFERENCES bead_types(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bead_transactions (
  id TEXT PRIMARY KEY,
  silo_id TEXT NOT NULL,
  bead_type_id TEXT DEFAULT NULL,
  type TEXT NOT NULL,
  quantity_lbs REAL NOT NULL,
  job_id TEXT DEFAULT NULL,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (silo_id) REFERENCES silos(id) ON DELETE CASCADE,
  FOREIGN KEY (bead_type_id) REFERENCES bead_types(id) ON DELETE SET NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_bead_tx_silo ON bead_transactions(silo_id);
CREATE INDEX IF NOT EXISTS idx_bead_tx_type ON bead_transactions(type);
CREATE INDEX IF NOT EXISTS idx_bead_tx_created ON bead_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_bead_tx_job ON bead_transactions(job_id);
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
// HANDLER: /api/silos  (GET / POST / PUT / DELETE)
// =============================================================================
async function handleApiSilos(request, env) {
  const db = env.DB;
  const method = request.method.toUpperCase();

  if (method === "GET") {
    try {
      const { results } = await db.prepare(`
        SELECT
          s.*,
          bt.name  AS bead_type_name,
          bt.grade AS bead_type_grade,
          bt.color AS bead_type_color,
          CASE WHEN s.reorder_point_lbs > 0 AND s.current_lbs <= s.reorder_point_lbs
               THEN 1 ELSE 0 END AS below_reorder
        FROM silos s
        LEFT JOIN bead_types bt ON bt.id = s.bead_type_id
        ORDER BY s.name ASC
      `).all();
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

    const id                = crypto.randomUUID();
    const bead_type_id      = payload.bead_type_id      ? String(payload.bead_type_id).trim()      : null;
    const capacity_lbs      = Number(payload.capacity_lbs      ?? 0);
    const current_lbs       = Number(payload.current_lbs       ?? 0);
    const reorder_point_lbs = Number(payload.reorder_point_lbs ?? 0);
    const location          = String(payload.location || "").trim();
    const notes             = String(payload.notes    || "").trim();

    try {
      await db.prepare(`
        INSERT INTO silos (id, name, bead_type_id, capacity_lbs, current_lbs, reorder_point_lbs, location, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, name, bead_type_id, capacity_lbs, current_lbs, reorder_point_lbs, location, notes).run();

      const row = await db.prepare(`
        SELECT s.*, bt.name AS bead_type_name, bt.grade AS bead_type_grade, bt.color AS bead_type_color,
               CASE WHEN s.reorder_point_lbs > 0 AND s.current_lbs <= s.reorder_point_lbs THEN 1 ELSE 0 END AS below_reorder
        FROM silos s LEFT JOIN bead_types bt ON bt.id = s.bead_type_id WHERE s.id = ?
      `).bind(id).first();
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

    const existing = await db.prepare("SELECT id FROM silos WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Silo not found." }, 404);

    const allowed = ["name", "bead_type_id", "capacity_lbs", "current_lbs", "reorder_point_lbs", "location", "notes"];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (key in payload) {
        sets.push(`${key} = ?`);
        const raw = payload[key];
        if (key === "bead_type_id") {
          vals.push(raw ? String(raw).trim() : null);
        } else if (["capacity_lbs", "current_lbs", "reorder_point_lbs"].includes(key)) {
          vals.push(Number(raw ?? 0));
        } else {
          vals.push(String(raw ?? "").trim());
        }
      }
    }
    if (sets.length === 0) return json({ ok: false, error: "No fields to update." }, 400);

    sets.push("updated_at = datetime('now')");
    vals.push(id);
    try {
      await db.prepare(`UPDATE silos SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
      const row = await db.prepare(`
        SELECT s.*, bt.name AS bead_type_name, bt.grade AS bead_type_grade, bt.color AS bead_type_color,
               CASE WHEN s.reorder_point_lbs > 0 AND s.current_lbs <= s.reorder_point_lbs THEN 1 ELSE 0 END AS below_reorder
        FROM silos s LEFT JOIN bead_types bt ON bt.id = s.bead_type_id WHERE s.id = ?
      `).bind(id).first();
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

    const existing = await db.prepare("SELECT id FROM silos WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Silo not found." }, 404);

    try {
      await db.prepare("DELETE FROM bead_transactions WHERE silo_id = ?").bind(id).run();
      await db.prepare("DELETE FROM silos WHERE id = ?").bind(id).run();
      return json({ ok: true, message: "Silo deleted." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}

// =============================================================================
// HANDLER: /api/bead-transactions  (GET / POST)
// =============================================================================
async function handleApiBeadTransactions(request, env) {
  const db = env.DB;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  if (method === "GET") {
    const siloId = url.searchParams.get("silo_id");
    const txType = url.searchParams.get("type");
    const jobId  = url.searchParams.get("job_id");
    const days   = parseInt(url.searchParams.get("days") || "30", 10);

    const where = ["t.created_at >= datetime('now', ? || ' days')"];
    const vals  = [`-${days}`];

    if (siloId) { where.push("t.silo_id = ?"); vals.push(siloId); }
    if (txType) { where.push("t.type = ?");    vals.push(txType); }
    if (jobId)  { where.push("t.job_id = ?");  vals.push(jobId); }

    try {
      const { results } = await db.prepare(`
        SELECT
          t.*,
          s.name AS silo_name,
          bt.name AS bead_type_name
        FROM bead_transactions t
        LEFT JOIN silos s ON s.id = t.silo_id
        LEFT JOIN bead_types bt ON bt.id = t.bead_type_id
        WHERE ${where.join(" AND ")}
        ORDER BY t.created_at DESC
        LIMIT 500
      `).bind(...vals).all();
      return json({ ok: true, data: results });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  if (method === "POST") {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const txType      = String(payload.type     || "").trim();
    const siloId      = String(payload.silo_id  || "").trim();
    const quantityLbs = Number(payload.quantity_lbs ?? 0);

    const validTypes = ["receive", "consume", "adjust", "transfer"];
    if (!validTypes.includes(txType)) {
      return json({ ok: false, error: `type must be one of: ${validTypes.join(", ")}` }, 400);
    }
    if (!siloId) return json({ ok: false, error: "silo_id is required." }, 400);
    if (quantityLbs === 0) return json({ ok: false, error: "quantity_lbs must be non-zero." }, 400);

    const silo = await db.prepare("SELECT * FROM silos WHERE id = ?").bind(siloId).first();
    if (!silo) return json({ ok: false, error: "Silo not found." }, 404);

    const beadTypeId = payload.bead_type_id ? String(payload.bead_type_id).trim() : silo.bead_type_id;
    const jobId      = payload.job_id        ? String(payload.job_id).trim()       : null;
    const reference  = String(payload.reference || "").trim();
    const notes      = String(payload.notes     || "").trim();

    let delta = quantityLbs;
    if (txType === "consume" || txType === "transfer") {
      delta = -Math.abs(quantityLbs);
    }

    const newLevel = silo.current_lbs + delta;
    if (newLevel < 0) {
      return json({
        ok: false,
        error: `Insufficient inventory. Silo has ${silo.current_lbs} lbs, transaction requires ${Math.abs(delta)} lbs.`
      }, 422);
    }

    const txId = crypto.randomUUID();
    try {
      await db.batch([
        db.prepare("UPDATE silos SET current_lbs = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(newLevel, siloId),
        db.prepare(`
          INSERT INTO bead_transactions (id, silo_id, bead_type_id, type, quantity_lbs, job_id, reference, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(txId, siloId, beadTypeId, txType, delta, jobId, reference, notes),
      ]);

      if (txType === "transfer" && payload.dest_silo_id) {
        const destId = String(payload.dest_silo_id).trim();
        const dest = await db.prepare("SELECT * FROM silos WHERE id = ?").bind(destId).first();
        if (dest) {
          const destTxId   = crypto.randomUUID();
          const destNotes  = notes ? `Transfer from ${silo.name}: ${notes}` : `Transfer from ${silo.name}`;
          await db.batch([
            db.prepare("UPDATE silos SET current_lbs = ?, updated_at = datetime('now') WHERE id = ?")
              .bind(dest.current_lbs + Math.abs(delta), destId),
            db.prepare(`
              INSERT INTO bead_transactions (id, silo_id, bead_type_id, type, quantity_lbs, job_id, reference, notes)
              VALUES (?, ?, ?, 'receive', ?, ?, ?, ?)
            `).bind(destTxId, destId, beadTypeId, Math.abs(delta), jobId, reference, destNotes),
          ]);
        }
      }

      const tx = await db.prepare("SELECT * FROM bead_transactions WHERE id = ?").bind(txId).first();
      const updatedSilo = await db.prepare(`
        SELECT s.*, bt.name AS bead_type_name, bt.grade AS bead_type_grade, bt.color AS bead_type_color,
               CASE WHEN s.reorder_point_lbs > 0 AND s.current_lbs <= s.reorder_point_lbs THEN 1 ELSE 0 END AS below_reorder
        FROM silos s LEFT JOIN bead_types bt ON bt.id = s.bead_type_id WHERE s.id = ?
      `).bind(siloId).first();

      return json({ ok: true, data: { transaction: tx, silo: updatedSilo } }, 201);
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method Not Allowed" }, 405);
}
