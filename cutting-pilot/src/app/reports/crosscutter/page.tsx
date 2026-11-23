// src/app/reports/crosscutter/page.tsx  ->  /v2/reports/crosscutter
// cc-blocks-02: server shell for the v2 Cross Cutter report (copies reports/scrap/page.tsx). Middleware gates this
// path on `reports`. No nav change: reached through the Reports header cross-links.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import CrossCutterReport from "./CrossCutterReport";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Reports — v2",
};

export default async function CrossCutterReportPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <CrossCutterReport userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
