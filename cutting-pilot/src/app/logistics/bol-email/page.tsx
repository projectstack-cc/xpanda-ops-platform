// src/app/logistics/bol-email/page.tsx  ->  /v2/logistics/bol-email (bem-01)
// Server shell for the v2 BOL Email Queue (port of legacy logistics/bol-email.html). Middleware
// gates the path on `logistics.bol` (view); this page is EDIT-only (bem-01 Decision 1 — Loading
// Team holds BOL view for dock View BOL and must not see the queue or recipient data), so a
// view-only user is bounced home with ?access_denied=1, same target as middleware's own denial.
// Built-and-deployed-but-unlinked until bem-02 cuts the links over.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import BolEmailQueue from "./BolEmailQueue";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda BOL Email Queue",
};

export default async function BolEmailPage() {
  const h = await headers();
  if (h.get("X-User-Can-Edit-Bol") !== "1") {
    // Absolute URL: the legacy home lives outside the /v2 basePath (mirrors middleware's
    // `new URL("/?access_denied=1", url.origin)`).
    const host = h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto") ?? "https";
    redirect(`${proto}://${host}/?access_denied=1`);
  }
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  return (
    <BolEmailQueue
      userName={userName}
      isAdmin={session?.isAdministrator ?? false}
      permissions={session?.permissions ?? {}}
    />
  );
}
