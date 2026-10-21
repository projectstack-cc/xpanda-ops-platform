// src/app/qc/page.tsx  ->  /v2/qc
// qc-01: server shell for the v2 QC Final Inspection board. Middleware gates this path on
// `qc` (same permission key as legacy's /qc/). Live since qc-07: home card, v2 + legacy nav, and the legacy /qc/ URLs redirect here.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import QcBoard from "./QcBoard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda QC — v2",
};

export default async function QcPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <QcBoard userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
