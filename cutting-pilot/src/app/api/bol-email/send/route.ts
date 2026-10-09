// src/app/api/bol-email/send/route.ts  ->  POST /v2/api/bol-email/send (bem-01)
// Port of legacy handleSend — same validation, is_selected persistence, subject/html, Resend call
// and response shapes. Client renders the PDFs (driver copy per BOL) and posts base64 attachments.
// RESEND_API_KEY is a secret on the v2 Worker (secrets are per-Worker, not shared with Pages).
// bem-01 Decision 4: the send activity row now records the actor.
import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { EMAIL_RE, requireBolEdit } from "@/lib/logistics/bolEmail";

export async function POST(request: NextRequest) {
  const denied = requireBolEdit(request);
  if (denied) return denied;

  const { env } = await getCloudflareContext();
  const resendKey = (env as any).RESEND_API_KEY as string | undefined;
  if (!resendKey) {
    return NextResponse.json({ ok: false, error: "Email not configured. Set the RESEND_API_KEY Worker secret." }, { status: 500 });
  }
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });
  const actorId = request.headers.get("X-User-Id") || null;

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const shipDate = String(payload.ship_date || "").trim();
  const deliveryCount = Number(payload.delivery_count) || 0;
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const recipientIds: number[] = Array.isArray(payload.recipient_ids)
    ? payload.recipient_ids.map(Number).filter((n: number) => Number.isInteger(n))
    : [];

  if (attachments.length === 0) return NextResponse.json({ ok: false, error: "At least one attachment is required." }, { status: 400 });
  if (recipientIds.length === 0) return NextResponse.json({ ok: false, error: "Select at least one recipient." }, { status: 400 });

  const placeholders = recipientIds.map(() => "?").join(",");
  const rres = await DB.prepare(
    `SELECT id, email FROM bol_email_recipients WHERE id IN (${placeholders})`
  ).bind(...recipientIds).all();
  const emails = ((rres.results || []) as any[]).map((r) => String(r.email)).filter((e) => EMAIL_RE.test(e));
  if (emails.length === 0) return NextResponse.json({ ok: false, error: "No valid recipients found." }, { status: 400 });

  // Persist "checked last time": selected ids → 1, everyone else → 0.
  try {
    await DB.prepare(
      `UPDATE bol_email_recipients SET is_selected = CASE WHEN id IN (${placeholders}) THEN 1 ELSE 0 END, updated_at = datetime('now')`
    ).bind(...recipientIds).run();
  } catch {
    /* selection persistence is non-fatal */
  }

  const prettyDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric",
  }).format(new Date(shipDate + "T12:00:00"));

  const subject = `BOLs for ${prettyDate} - XPanda Foam`;
  const html = `<p>See attached for the loads shipping ${prettyDate}, there will be ${deliveryCount} deliveries.</p>`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "XPanda Foam <logistics@xpandaops.com>",
        to: emails,
        subject,
        html,
        attachments,
      }),
    });
    if (resp.ok) {
      await logActivity(DB, "send", "bol_email", shipDate,
        `Sent ${attachments.length} BOL(s) for ${shipDate} to ${emails.length} recipient(s)`,
        { ship_date: shipDate, sent: attachments.length, recipients: emails.length },
        actorId
      );
      return NextResponse.json({ ok: true, sent: attachments.length, recipients: emails.length });
    }
    const detail = await resp.text();
    return NextResponse.json({ ok: false, error: "Resend send failed", detail }, { status: 502 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
