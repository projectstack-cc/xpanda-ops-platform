// src/app/reports/incidents/page.tsx  ->  /v2/reports/incidents
// rpt-03: server shell for the v2 Incidents report (copies reports/cutting/page.tsx). Middleware gates this
// path on `reports` (legacy's own key). Home card + navs point here since rpt-05.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import IncidentsReport from "./IncidentsReport";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Reports — v2",
};

export default async function IncidentsReportPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <IncidentsReport userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
