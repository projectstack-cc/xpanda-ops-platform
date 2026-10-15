// src/app/api/logistics/invoice/bol-lookup/route.ts  →  /v2/api/logistics/invoice/bol-lookup?bol=<text>
// Read-only address lookup for the Resolve unmatched lines modal (inv-resolve-02): given a typed
// BOL #, returns the destination the invoice ingest would link it to. Uses the SAME token
// extractor and the SAME shared lookupBolDestinations() as ../route.ts, so the modal and the
// parser can never disagree. Gated by middleware's /v2/api/logistics → logistics.dashboard row.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { extractBolTokens } from "@/lib/logistics/freightInvoice";
import { lookupBolDestinations } from "@/lib/logistics/bolLookup";

export async function GET(request: Request) {
  try {
    const trimmed = (new URL(request.url).searchParams.get("bol") ?? "").trim();
    if (!trimmed) {
      return NextResponse.json({ ok: false, error: "BOL # is required." }, { status: 400 });
    }

    // Bare input like "4221-02" may not look like a PO-text token — fall back to the raw text.
    const tokens = extractBolTokens(trimmed);
    const bolNumber = tokens.length > 0 ? tokens[0] : trimmed;

    const { DB } = await getEnv();
    const { resolved } = await lookupBolDestinations(DB, [bolNumber]);
    const hit = resolved[0];
    if (!hit) {
      return NextResponse.json({ ok: true, found: false, bolNumber });
    }

    return NextResponse.json({
      ok: true,
      found: true,
      bolNumber,
      source: hit.row.source,
      fallbackBase: hit.fallbackBase,
      address: {
        street: hit.row.ship_to_street,
        city: hit.row.ship_to_city,
        state: hit.row.ship_to_state,
        zip: hit.row.ship_to_zip,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
