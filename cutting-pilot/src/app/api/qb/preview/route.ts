// src/app/api/qb/preview/route.ts  →  /v2/api/qb/preview?invoiceId= | ?docNumber=
// qb-01: admin-only dry run — fetch + map, write nothing. The raw invoice dump doubles as the
// field-availability recon (which custom fields actually come back).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { getQbEnv, getValidToken, fetchInvoice, fetchInvoiceByDocNumber } from "@/lib/qb/client";
import { loadPartsServer } from "@/lib/qb/parts";
import { mapInvoiceToJobInput, relevantHash } from "@/lib/qb/mapper";

export async function GET(request: NextRequest) {
  if (request.headers.get("X-User-Is-Admin") !== "1") {
    return NextResponse.json({ ok: false, error: "Admin only." }, { status: 403 });
  }
  const invoiceId = (request.nextUrl.searchParams.get("invoiceId") || "").trim();
  const docNumber = (request.nextUrl.searchParams.get("docNumber") || "").trim();
  if (!invoiceId && !docNumber) {
    return NextResponse.json({ ok: false, error: "invoiceId or docNumber is required." }, { status: 400 });
  }
  try {
    const { DB } = await getEnv();
    const qb = await getQbEnv();
    const token = await getValidToken(DB, qb);
    const invoice = invoiceId ? await fetchInvoice(token, qb, invoiceId) : await fetchInvoiceByDocNumber(token, qb, docNumber);
    const parts = await loadPartsServer(DB);
    const { input, warnings, unmatched } = mapInvoiceToJobInput(invoice, parts);
    const hash = await relevantHash(input);
    return NextResponse.json({ ok: true, invoice, mapped: input, warnings, unmatched, hash });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
  }
}
