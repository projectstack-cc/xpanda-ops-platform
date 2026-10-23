// src/app/qc/marina/page.tsx  ->  /v2/qc/marina
// marina-04: server shell for the Marina Foam job list. Middleware gates this path on `qc.marina`
// (marina-01). Direct URL only — no nav entry and no /v2/qc button until marina-07.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import MarinaJobList from "@/components/marina/MarinaJobList";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda QC · Marina Foam — v2",
};

export default async function MarinaPage({ searchParams }: { searchParams: { status?: string } }) {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};
  const canEdit = isAdmin || permissions["qc.marina"]?.edit === true;
  const initialStatus = searchParams.status === "complete" ? "complete" : "open";

  return (
    <MarinaJobList
      userName={userName}
      isAdmin={isAdmin}
      permissions={permissions}
      canEdit={canEdit}
      initialStatus={initialStatus}
    />
  );
}
