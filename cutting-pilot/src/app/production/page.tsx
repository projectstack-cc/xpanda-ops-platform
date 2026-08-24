// src/app/production/page.tsx  →  /v2/production
// Server shell: reads operator identity from middleware-injected headers, calls
// validateSession() for the permission map, and renders the platform header + client board.
// Standalone v2 Production log — no job link, no jobs.status writes, no inventory side-effects.
import { headers } from "next/headers";
import PlatformHeader from "@/components/PlatformHeader";
import ProductionBoard from "./ProductionBoard";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export default async function ProductionPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const cookieHeader = h.get("cookie");

  const { DB } = await getEnv();
  const session = await validateSession(DB, cookieHeader);

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        currentPath="/v2/production"
        title="Production Log · v2"
      />
      <ProductionBoard />
    </div>
  );
}
