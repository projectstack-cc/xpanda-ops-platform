// src/app/reports/cutting/page.tsx  ->  /v2/reports/cutting
// rpt-01: server shell for the v2 Cutting activity report (copies qc/page.tsx). Middleware gates this
// path on `reports` (legacy's own key). Direct URL only until rpt-05 repoints the home card + navs.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import CuttingReport from "./CuttingReport";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Reports — v2",
};

export default async function CuttingReportPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <CuttingReport userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
