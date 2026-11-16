// src/app/safety/manage/page.tsx  →  /v2/safety/manage  (saf-03)
// Server shell for the training-records page. Gated on safety.manage (view) by middleware (saf-01 rows). canEdit =
// safety.manage EDIT (X-User-Can-Edit-Safety-Manage, saf-03) or admin: shows Group sign-off and Void.
import { headers } from "next/headers";
import PlatformHeader from "@/components/PlatformHeader";
import TrainingRecords from "@/components/safety/TrainingRecords";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Safety training records — v2",
};

export default async function SafetyManagePage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const canEdit = h.get("X-User-Can-Edit-Safety-Manage") === "1" || h.get("X-User-Is-Admin") === "1";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <PlatformHeader
        userName={userName}
        isAdmin={session?.isAdministrator ?? false}
        permissions={session?.permissions ?? {}}
        currentPath="/v2/safety"
        title="Safety · v2"
      />
      <TrainingRecords canEdit={canEdit} />
    </div>
  );
}
