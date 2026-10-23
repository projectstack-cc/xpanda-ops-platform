// src/app/qc/marina/[jobId]/page.tsx  ->  /v2/qc/marina/:jobId
// marina-04: server shell for one Marina Foam job. Resolves the param only — the client fetches
// GET /v2/api/qc/marina/jobs/:id and renders "Job not found" on 404. Gated on `qc.marina` (marina-01).
// Later seams (not built here): [jobId]/setup/[fileId] (marina-05), parts/[partId] + rework (marina-06).
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import MarinaJobDetail from "@/components/marina/MarinaJobDetail";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda QC · Marina Foam — v2",
};

export default async function MarinaJobPage({ params }: { params: { jobId: string } }) {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};
  const canEdit = isAdmin || permissions["qc.marina"]?.edit === true;

  return (
    <MarinaJobDetail
      userName={userName}
      isAdmin={isAdmin}
      permissions={permissions}
      canEdit={canEdit}
      jobId={params.jobId}
    />
  );
}
