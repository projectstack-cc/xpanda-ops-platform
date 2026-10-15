// src/app/api/logistics/analytics/route.ts  →  /v2/api/logistics/analytics
// Accountant-grade aggregates over the full stored freight_invoice_lines dataset, for the
// Financials tab (PXXX-h). Reuses the same flag math as flags/route.ts (src/lib/logistics/flags.ts)
// so perZip/zipVariance never drift between the two callers.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { computePerZip, computeZipVariance, type FlagRow } from "@/lib/logistics/flags";
import { SERVICE_MONTH_CTE } from "@/lib/logistics/serviceMonth";

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
  blendedPricePerMile: number;
}

export async function GET() {
  try {
    const { DB } = await getEnv();

    const totalsRow = await DB.prepare(
      `SELECT
         COUNT(*) AS lineCount,
         SUM(amount) AS totalSpend,
         SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matchedCount,
         SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatchedCount,
         SUM(CASE WHEN match_status = 'multi_destination' THEN 1 ELSE 0 END) AS multiCount,
         SUM(CASE WHEN match_status = 'matched' AND miles IS NOT NULL THEN amount ELSE NULL END) AS matchedSpend,
         SUM(CASE WHEN match_status = 'matched' THEN miles ELSE NULL END) AS totalMiles
       FROM freight_invoice_lines`
    ).first<TotalsRow>();

    const lineCount = totalsRow?.lineCount ?? 0;
    const totalSpend = totalsRow?.totalSpend ?? 0;
    const matchedCount = totalsRow?.matchedCount ?? 0;
    const unmatchedCount = totalsRow?.unmatchedCount ?? 0;
    const multiCount = totalsRow?.multiCount ?? 0;
    const matchedSpend = totalsRow?.matchedSpend ?? 0;
    const totalMiles = totalsRow?.totalMiles ?? 0;

    const totals = {
      totalSpend,
      lineCount,
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
       WHERE service_month IS NOT NULL
       GROUP BY month
       ORDER BY month ASC`
    ).all<MonthlyRow>();

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
      `SELECT
         ship_to_zip AS zip,
         ship_to_city AS city,
         COUNT(*) AS lineCount,
         SUM(amount) AS totalSpend,
         AVG(miles) AS avgMiles,
         SUM(amount) / SUM(miles) AS blendedPricePerMile
       FROM freight_invoice_lines
       WHERE match_status = 'matched' AND miles IS NOT NULL
       GROUP BY ship_to_zip
       ORDER BY totalSpend DESC
       LIMIT 10`
    ).all<TopLaneRow>();

    const topLanes = topLanesRows.results ?? [];

    const matchedRows = await DB.prepare(
      `SELECT ship_to_zip, ship_to_city, amount, miles FROM freight_invoice_lines
       WHERE excluded_from_stats = 0 AND ship_to_zip IS NOT NULL AND miles IS NOT NULL`
    ).all<{ ship_to_zip: string; ship_to_city: string; amount: number; miles: number }>();

    const flagRows: FlagRow[] = (matchedRows.results ?? []).map((r) => ({
      zip: r.ship_to_zip,
      city: r.ship_to_city,
      amount: r.amount,
      miles: r.miles,
    }));

    return NextResponse.json({
      ok: true,
      totals,
      monthly,
      topLanes,
      perZip: computePerZip(flagRows),
      zipVariance: computeZipVariance(flagRows),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
