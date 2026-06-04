import { json } from '../lib/core.js';

export async function handleApiReportsScrapSummary(request, env) {
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

export async function handleApiReportsScrapTrend(request, env) {
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

export async function handleApiReportsScrapReasons(request, env) {
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

export async function handleIncidentTrend(request, env) {
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

export async function handleIncidentSummary(request, env) {
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

export async function handleIncidentList(request, env) {
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

export async function handleIncidentDetail(request, env) {
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


