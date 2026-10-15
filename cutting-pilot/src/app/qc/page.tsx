// src/app/qc/page.tsx  ->  /v2/qc
// qc-01: server shell for the v2 QC Final Inspection board. Middleware gates this path on
// `qc` (same permission key as legacy's /qc/). Deliberately NOT wired into PlatformHeader's nav,
// the home page or qc/index.html — reachable by direct URL only, per the v2 visibility gate
// (xpanda-ops-agents.md §1): a module is built-and-deployed-but-unlinked until Steve has tested
// it and confirmed it's complete.
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
