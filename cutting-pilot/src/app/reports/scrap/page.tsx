// src/app/reports/scrap/page.tsx  ->  /v2/reports/scrap
// rpt-04: server shell for the v2 Scrap report (copies reports/cutting/page.tsx). Middleware gates this
// path on `reports` (legacy's own key). Home card + navs point here since rpt-05.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import ScrapReport from "./ScrapReport";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Reports — v2",
};

export default async function ScrapReportPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <ScrapReport userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
