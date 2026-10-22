// src/app/api/qc/incidents/customers/route.ts  ->  GET /v2/api/qc/incidents/customers
// qc-08: the Incident report popup's Customer suggestions — the active names on the Inspection Tool's
// incident customer sheet (Apps Script ?action=getIncidentCustomers), deduped. 10 s timeout; a
// non-empty list is cached per isolate for 5 min (an empty / failed one isn't, so a blip doesn't blank
// the suggestions). Never a 500: on failure it's { ok: true, names: [], warning } and the form still
// takes free text. Under next dev it returns [] without calling Google (qc-03's rule).
// No add-customer from v2 — Steve adds names to the sheet himself.
// Gated on `qc` by middleware (GET → view). Read-only, so no logActivity.
import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { fetchSheetCustomers } from "@/lib/qc/driveForward";

const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;
let cache: { at: number; names: string[] } | null = null;

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json({ ok: true, names: [], warning: "Customer suggestions are off under next dev." });
  }
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ ok: true, names: cache.names });
  }
  try {
    const { env } = await getCloudflareContext();
    const gasUrl = (env as any).QC_GAS_URL as string | undefined;
    if (!gasUrl) return NextResponse.json({ ok: true, names: [], warning: "QC_GAS_URL not configured." });
    const names = await fetchSheetCustomers(gasUrl, TIMEOUT_MS, "getIncidentCustomers", (env as any).QC_GAS_SECRET);
    if (!names.length) {
      return NextResponse.json({ ok: true, names: [], warning: "Couldn't load the incident customer list — type the customer." });
    }
    cache = { at: Date.now(), names };
    return NextResponse.json({ ok: true, names });
  } catch (e: any) {
    return NextResponse.json({
      ok: true,
      names: [],
      warning: `Couldn't load the incident customer list — type the customer. (${String(e?.message || e)})`,
    });
  }
}
