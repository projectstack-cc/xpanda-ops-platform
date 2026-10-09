// src/app/api/bol-email/recipients/[id]/route.ts  ->  PUT/DELETE /v2/api/bol-email/recipients/:id (bem-01)
// Port of legacy handleRecipients (PUT + DELETE branches) — same SQL, regex, 409 on duplicate.
// bem-01 Decision 4: both write logActivity (legacy didn't).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { EMAIL_RE, requireBolEdit } from "@/lib/logistics/bolEmail";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireBolEdit(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  let p: any;
  try {
    p = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(p.email || "").trim().toLowerCase();
  const name = String(p.name || "").trim();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ ok: false, error: "A valid email is required." }, { status: 400 });
  try {
    await DB.prepare("UPDATE bol_email_recipients SET email = ?, name = ?, updated_at = datetime('now') WHERE id = ?").bind(email, name, id).run();
  } catch {
    return NextResponse.json({ ok: false, error: "That email is already in the list." }, { status: 409 });
  }
  await logActivity(DB, "update", "bol_email_recipient", id,
    `Updated BOL email recipient ${email}`, { id, email, name }, request.headers.get("X-User-Id") || null);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireBolEdit(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  const existing = await DB.prepare("SELECT email FROM bol_email_recipients WHERE id = ?").bind(id).first<any>();
  await DB.prepare("DELETE FROM bol_email_recipients WHERE id = ?").bind(id).run();
  await logActivity(DB, "delete", "bol_email_recipient", id,
    `Removed BOL email recipient ${existing?.email || id}`, { id, email: existing?.email ?? null },
    request.headers.get("X-User-Id") || null);
  return NextResponse.json({ ok: true });
}
