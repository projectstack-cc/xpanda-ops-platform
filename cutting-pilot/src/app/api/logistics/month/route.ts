// src/app/api/logistics/month/route.ts  →  /v2/api/logistics/month?month=YYYY-MM
// History-tab month selector (-i). Returns the list of ingested months plus the resolved
// month's full InvoiceResult, shaped EXACTLY like POST /v2/api/logistics/invoice's response so
// InvoiceAnalytics.tsx can render it through the same MatchRateBanner/SummaryCards/LineTable/
// FlagsPanels components the Upload tab uses — history and upload must never visually diverge.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { computeZipVariance, computeInversions, type FlagRow } from "@/lib/logistics/flags";
import { SERVICE_MONTH_CTE } from "@/lib/logistics/serviceMonth";

type MatchStatus = "matched" | "unmatched" | "multi_destination";

interface MonthLineRow {
  invoice_number: string;
  invoice_date: string | null;
  vendor: string;
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
  excluded_from_stats: number;
}

function bolNumbersFor(row: MonthLineRow): string[] {
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
    const requestedMonth = new URL(request.url).searchParams.get("month");
    const { DB } = await getEnv();

    const monthsRows = await DB.prepare(
      `${SERVICE_MONTH_CTE}SELECT DISTINCT service_month AS month FROM invoice_lines
       WHERE service_month IS NOT NULL ORDER BY month DESC`
    ).all<{ month: string }>();
    const months = (monthsRows.results ?? []).map((r) => r.month);

    if (months.length === 0) {
      return NextResponse.json({ ok: true, months: [], month: null, result: null });
    }

    const month = requestedMonth && months.includes(requestedMonth) ? requestedMonth : months[0];

    const lineRows = await DB.prepare(
      `${SERVICE_MONTH_CTE}SELECT invoice_number, invoice_date, vendor, line_no, ship_date, load_number, po_text,
              bol_number, bol_numbers, amount, ship_to_city, ship_to_state, ship_to_zip, miles,
              price_per_mile, match_status, excluded_from_stats
       FROM invoice_lines
       WHERE service_month = ?
       ORDER BY invoice_number ASC, line_no ASC`
    )
      .bind(month)
      .all<MonthLineRow>();
    const rows = lineRows.results ?? [];

    const lines = rows.map((r) => ({
      invoiceNumber: r.invoice_number,
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
      excludedFromStats: r.excluded_from_stats === 1,
      note: noteFor(r.match_status),
    }));

    const matchedCount = rows.filter((r) => r.match_status === "matched").length;
    const unmatchedCount = rows.filter((r) => r.match_status === "unmatched").length;
    const multiDestCount = rows.filter((r) => r.match_status === "multi_destination").length;
    const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
    const matchedRows = rows.filter((r) => r.match_status === "matched" && r.miles != null);
    const avgMiles = matchedRows.length ? matchedRows.reduce((s, r) => s + (r.miles ?? 0), 0) / matchedRows.length : 0;
    const avgPrice = matchedRows.length ? matchedRows.reduce((s, r) => s + r.amount, 0) / matchedRows.length : 0;
    const avgPricePerMile = matchedRows.length
      ? matchedRows.reduce((s, r) => s + (r.price_per_mile ?? 0), 0) / matchedRows.length
      : 0;

    const flagRows: FlagRow[] = rows
      .filter((r) => r.match_status === "matched" && r.ship_to_zip && r.miles != null)
      .map((r) => ({
        zip: r.ship_to_zip as string,
        city: r.ship_to_city ?? "",
        amount: r.amount,
        miles: r.miles as number,
      }));

    const distinctInvoices = Array.from(new Set(rows.map((r) => r.invoice_number)));
    let invoice: { vendor: string; invoiceNumber: string; invoiceDate: string | null };
    if (distinctInvoices.length === 1) {
      const first = rows[0];
      invoice = { vendor: first.vendor, invoiceNumber: first.invoice_number, invoiceDate: first.invoice_date };
    } else {
      const vendors = new Set(rows.map((r) => r.vendor));
      invoice = {
        vendor: vendors.size === 1 ? rows[0].vendor : "Multiple",
        invoiceNumber: `${distinctInvoices.length} invoices`,
        invoiceDate: month,
      };
    }

    return NextResponse.json({
      ok: true,
      months,
      month,
      result: {
        invoice,
        summary: {
          lineCount: rows.length,
          matchedCount,
          unmatchedCount,
          multiDestCount,
          totalAmount,
          avgMiles,
          avgPrice,
          avgPricePerMile,
        },
        lines,
        flags: {
          zipVariance: computeZipVariance(flagRows),
          inversions: computeInversions(flagRows),
        },
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
