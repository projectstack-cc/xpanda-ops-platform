// src/app/qc/marina/rework/page.tsx  ->  /v2/qc/marina/rework[?job=<id>]
// marina-06: server shell for the Marina rework queue. ?job= narrows it to one job (read server-side).
// Gated on `qc.marina` by the /v2/qc/marina PERMISSION_MAP row (marina-01).
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import ReworkQueue from "@/components/marina/ReworkQueue";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda QC · Marina Foam rework — v2",
};

export default async function MarinaReworkPage({ searchParams }: { searchParams: { job?: string } }) {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};
  const canEdit = isAdmin || permissions["qc.marina"]?.edit === true;
  const jobId = typeof searchParams?.job === "string" && searchParams.job.trim() ? searchParams.job.trim() : null;

  return (
    <ReworkQueue userName={userName} isAdmin={isAdmin} permissions={permissions} canEdit={canEdit} jobId={jobId} />
  );
}
