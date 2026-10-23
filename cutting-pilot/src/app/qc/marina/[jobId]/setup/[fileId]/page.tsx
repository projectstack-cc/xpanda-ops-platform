// src/app/qc/marina/[jobId]/setup/[fileId]/page.tsx  ->  /v2/qc/marina/:jobId/setup/:fileId
// marina-05: server shell for the cut-sheet setup screen (one part per PDF page, pdf.js suggestions).
// Resolves the params only — the client checks file / job / canEdit and renders a message otherwise.
// Gated on `qc.marina` by the /v2/qc/marina PERMISSION_MAP row (marina-01).
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import CutSheetSetup from "@/components/marina/CutSheetSetup";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda QC · Marina Foam setup — v2",
};

export default async function MarinaSetupPage({ params }: { params: { jobId: string; fileId: string } }) {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};
  const canEdit = isAdmin || permissions["qc.marina"]?.edit === true;

  return (
    <CutSheetSetup
      userName={userName}
      isAdmin={isAdmin}
      permissions={permissions}
      canEdit={canEdit}
      jobId={params.jobId}
      fileId={params.fileId}
    />
  );
}
