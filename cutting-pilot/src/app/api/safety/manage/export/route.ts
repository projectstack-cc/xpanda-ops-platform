// src/app/api/safety/manage/export/route.ts  →  GET /v2/api/safety/manage/export[?include_voided=1]   (saf-01)
// Full completion history as CSV (newest first; non-voided unless include_voided=1). RFC-4180 + CSV-injection guard
// (lib/safety/records.ts toCsv). Gated on safety.manage by middleware; re-checked here.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { actorOf, canManageSafety, etToday, listCsvRows, toCsv } from "@/lib/safety/records";

export async function GET(request: NextRequest) {
  if (!actorOf(request.headers)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageSafety(request.headers)) return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });

  const iv = request.nextUrl.searchParams.get("include_voided");
  if (iv !== null && iv !== "0" && iv !== "1") {
    return NextResponse.json({ ok: false, error: "include_voided must be 0 or 1" }, { status: 400 });
  }
  try {
    const { DB } = await getEnv();
    const csv = toCsv(await listCsvRows(DB, iv === "1"));
    return new NextResponse("﻿" + csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="safety-training-${etToday()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
