// src/app/api/logistics/annual/route.ts  →  /v2/api/logistics/annual?year=YYYY
// Year-scoped rollup for the Financials-history annual export (PXXX-k). Combines analytics/
// route.ts's aggregate shape (totals/monthly/topLanes/perZip/zipVariance) with month/route.ts's
// per-line flattening (bolNumbers[] parsed, note derived) — all scoped to one year.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { computePerZip, computeZipVariance, type FlagRow } from "@/lib/logistics/flags";
import { SERVICE_MONTH_CTE } from "@/lib/logistics/serviceMonth";

type MatchStatus = "matched" | "unmatched" | "multi_destination";

interface TotalsRow {
  lineCount: number;
  totalSpend: number | null;
  matchedCount: number | null;
  unmatchedCount: number | null;
  multiCount: number | null;
  matchedSpend: number | null;
  totalMiles: number | null;
}

interface MonthlyRow {
  month: string;
  lineCount: number;
  totalSpend: number | null;
  matchedSpend: number | null;
  totalMiles: number | null;
}

interface TopLaneRow {
  zip: string;
  city: string | null;
  lineCount: number;
  totalSpend: number;
  avgMiles: number;
  blendedPricePerMile: number | null;
}

interface YearLineRow {
  invoice_date: string | null;
  line_no: number;
  ship_date: string | null;
  load_number: string | null;
  po_text: string;
  bol_number: string | null;
  bol_numbers: string | null;
  amount: number;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  miles: number | null;
  price_per_mile: number | null;
  match_status: MatchStatus;
}

function bolNumbersFor(row: { bol_numbers: string | null; bol_number: string | null }): string[] {
  if (row.bol_numbers) {
    try {
      const parsed = JSON.parse(row.bol_numbers);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to bol_number
    }
  }
  return row.bol_number ? [row.bol_number] : [];
}

function noteFor(status: MatchStatus): string | null {
  if (status === "unmatched") return "No matching BOL on file.";
  if (status === "multi_destination") return "Multiple destinations on this line.";
  return null;
}

export async function GET(request: Request) {
  try {
    const requestedYear = new URL(request.url).searchParams.get("year");
    const { DB } = await getEnv();

    let year = requestedYear;
    if (!year) {
      const maxYear = await DB.prepare(
        `${SERVICE_MONTH_CTE}SELECT MAX(substr(service_month, 1, 4)) AS year FROM invoice_lines WHERE service_month IS NOT NULL`
      ).first<{ year: string | null }>();
      year = maxYear?.year ?? String(new Date().getFullYear());
    }

    const totalsRow = await DB.prepare(
      `${SERVICE_MONTH_CTE}SELECT
         COUNT(*) AS lineCount,
         SUM(amount) AS totalSpend,
         SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matchedCount,
         SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatchedCount,
         SUM(CASE WHEN match_status = 'multi_destination' THEN 1 ELSE 0 END) AS multiCount,
         SUM(CASE WHEN match_status = 'matched' AND miles IS NOT NULL THEN amount ELSE NULL END) AS matchedSpend,
         SUM(CASE WHEN match_status = 'matched' THEN miles ELSE NULL END) AS totalMiles
       FROM invoice_lines WHERE substr(service_month, 1, 4) = ?`
    )
      .bind(year)
      .first<TotalsRow>();

    const lineCount = totalsRow?.lineCount ?? 0;
    const totalSpend = totalsRow?.totalSpend ?? 0;
    const matchedCount = totalsRow?.matchedCount ?? 0;
    const unmatchedCount = totalsRow?.unmatchedCount ?? 0;
    const multiCount = totalsRow?.multiCount ?? 0;
    const matchedSpend = totalsRow?.matchedSpend ?? 0;
    const totalMiles = totalsRow?.totalMiles ?? 0;

    const totals = {
      lineCount,
      totalSpend,
      matchedCount,
      unmatchedCount,
      multiCount,
      matchRate: lineCount > 0 ? matchedCount / lineCount : 0,
      totalMiles,
      blendedPricePerMile: totalMiles > 0 ? matchedSpend / totalMiles : 0,
    };

    const monthlyRows = await DB.prepare(
      `${SERVICE_MONTH_CTE}SELECT
         service_month AS month,
         COUNT(*) AS lineCount,
         SUM(amount) AS totalSpend,
         SUM(CASE WHEN match_status = 'matched' THEN amount ELSE NULL END) AS matchedSpend,
         SUM(CASE WHEN match_status = 'matched' THEN miles ELSE NULL END) AS totalMiles
       FROM invoice_lines
       WHERE substr(service_month, 1, 4) = ?
       GROUP BY month
       ORDER BY month ASC`
    )
      .bind(year)
      .all<MonthlyRow>();

    const monthly = (monthlyRows.results ?? []).map((r) => {
      const rMatchedSpend = r.matchedSpend ?? 0;
      const rTotalMiles = r.totalMiles ?? 0;
      return {
        month: r.month,
        lineCount: r.lineCount,
        totalSpend: r.totalSpend ?? 0,
        matchedSpend: rMatchedSpend,
        totalMiles: rTotalMiles,
        blendedPricePerMile: rTotalMiles > 0 ? rMatchedSpend / rTotalMiles : 0,
      };
    });

    const topLanesRows = await DB.prepare(
      `${SERVICE_MONTH_CTE}SELECT
         ship_to_zip AS zip,
         ship_to_city AS city,
         COUNT(*) AS lineCount,
         SUM(amount) AS totalSpend,
         AVG(miles) AS avgMiles,
         SUM(amount) / SUM(miles) AS blendedPricePerMile
       FROM invoice_lines
       WHERE match_status = 'matched' AND miles IS NOT NULL AND substr(service_month, 1, 4) = ?
       GROUP BY ship_to_zip
       ORDER BY totalSpend DESC
       LIMIT 10`
    )
      .bind(year)
      .all<TopLaneRow>();
    const topLanes = topLanesRows.results ?? [];

    const yearRows = await DB.prepare(
      `${SERVICE_MONTH_CTE}SELECT invoice_date, line_no, ship_date, load_number, po_text, bol_number, bol_numbers,
              amount, ship_to_city, ship_to_state, ship_to_zip, miles, price_per_mile, match_status
       FROM invoice_lines
       WHERE substr(service_month, 1, 4) = ?
       ORDER BY service_month ASC, invoice_number ASC, line_no ASC`
    )
      .bind(year)
      .all<YearLineRow>();
    const rows = yearRows.results ?? [];

    const lines = rows.map((r) => ({
      lineNo: r.line_no,
      shipDate: r.ship_date,
      loadNumber: r.load_number,
      poText: r.po_text,
      bolNumbers: bolNumbersFor(r),
      matchStatus: r.match_status,
      shipTo: r.ship_to_zip ? { city: r.ship_to_city ?? "", state: r.ship_to_state ?? "", zip: r.ship_to_zip } : null,
      miles: r.miles,
      amount: r.amount,
      pricePerMile: r.price_per_mile,
      note: noteFor(r.match_status),
    }));

    const flagRows: FlagRow[] = rows
      .filter((r) => r.match_status === "matched" && r.ship_to_zip && r.miles != null)
      .map((r) => ({
        zip: r.ship_to_zip as string,
        city: r.ship_to_city ?? "",
        amount: r.amount,
        miles: r.miles as number,
      }));

    return NextResponse.json({
      ok: true,
      year,
      totals,
      monthly,
      perZip: computePerZip(flagRows),
      zipVariance: computeZipVariance(flagRows),
      topLanes,
      lines,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
