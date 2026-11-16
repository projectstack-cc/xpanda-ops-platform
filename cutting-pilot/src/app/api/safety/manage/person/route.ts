// src/app/api/safety/manage/person/route.ts  →  GET /v2/api/safety/manage/person?user_id=…   (saf-03)
// One trainee's full completion history for the records page's person dialog: ALL rows, voided included (the client
// filters), newest completed_on then newest created_at first. The user must be in the trainee population (404
// otherwise), so this can't look up arbitrary accounts. Gated on safety.manage by middleware; re-checked here.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { actorOf, canManageSafety, listPersonCompletions, listTrainees } from "@/lib/safety/records";

export async function GET(request: NextRequest) {
  if (!actorOf(request.headers)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageSafety(request.headers)) return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });

  const userId = (request.nextUrl.searchParams.get("user_id") ?? "").trim();
  if (!userId) return NextResponse.json({ ok: false, error: "user_id_required" }, { status: 400 });

  try {
    const { DB } = await getEnv();
    const person = (await listTrainees(DB)).find((p) => p.user_id === userId);
    if (!person) return NextResponse.json({ ok: false, error: "not_found", detail: "Not an active trainee." }, { status: 404 });
    const completions = await listPersonCompletions(DB, userId);
    return NextResponse.json({ ok: true, person, completions });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
