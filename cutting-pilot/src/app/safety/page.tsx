// src/app/safety/page.tsx  →  /v2/safety  (saf-02)
// Server shell for the v2 Safety hub: platform header + client hub. Gated on `safety` (middleware, saf-01).
// saf-04: the nav, home card and legacy /safety/ stubs all point here.
import { headers } from "next/headers";
import PlatformHeader from "@/components/PlatformHeader";
import SafetyHub from "@/components/safety/SafetyHub";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Safety — v2",
};

export default async function SafetyPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const canManage = h.get("X-User-Can-Manage-Safety") === "1" || h.get("X-User-Is-Admin") === "1";

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
      <SafetyHub canManage={canManage} />
    </div>
  );
}
