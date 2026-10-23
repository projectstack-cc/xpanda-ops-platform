// src/app/qc/marina/parts/[partId]/page.tsx  ->  /v2/qc/marina/parts/:partId
// marina-06: server shell for the Marina part / inspect screen. Resolves the param only — the client
// fetches GET /v2/api/qc/marina/parts/:id and renders "Part not found" on 404.
// Gated on `qc.marina` by the /v2/qc/marina PERMISSION_MAP row (marina-01).
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import PartInspect from "@/components/marina/PartInspect";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda QC · Marina Foam inspect — v2",
};

export default async function MarinaPartPage({ params }: { params: { partId: string } }) {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};
  const canEdit = isAdmin || permissions["qc.marina"]?.edit === true;

  return (
    <PartInspect userName={userName} isAdmin={isAdmin} permissions={permissions} canEdit={canEdit} partId={params.partId} />
  );
}
