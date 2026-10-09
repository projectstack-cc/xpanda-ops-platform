// src/app/api/bol-email/recipients/route.ts  ->  GET/POST /v2/api/bol-email/recipients (bem-01)
// Port of legacy handleRecipients (GET + POST branches) — same SQL, regex, 409 on duplicate.
// bem-01 Decision 4: POST also writes logActivity (legacy didn't).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { EMAIL_RE, requireBolEdit } from "@/lib/logistics/bolEmail";

export async function GET(request: NextRequest) {
  const denied = requireBolEdit(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  const r = await DB.prepare(
    "SELECT id, email, name, is_selected FROM bol_email_recipients ORDER BY name ASC, email ASC"
  ).all();
  return NextResponse.json({ ok: true, recipients: r.results || [] });
}

export async function POST(request: NextRequest) {
  const denied = requireBolEdit(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  let p: any;
  try {
    p = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(p.email || "").trim().toLowerCase();
  const name = String(p.name || "").trim();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ ok: false, error: "A valid email is required." }, { status: 400 });
  let id: unknown;
  try {
    const res = await DB.prepare("INSERT INTO bol_email_recipients (email, name) VALUES (?, ?)").bind(email, name).run();
    id = res.meta?.last_row_id;
  } catch {
    return NextResponse.json({ ok: false, error: "That email is already in the list." }, { status: 409 });
  }
  await logActivity(DB, "create", "bol_email_recipient", String(id ?? email),
    `Added BOL email recipient ${email}`, { id, email, name }, request.headers.get("X-User-Id") || null);
  return NextResponse.json({ ok: true, id });
}
