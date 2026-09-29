// src/app/production/schedule/page.tsx  →  /v2/production/schedule
// Server shell for the production schedule editor (prod-d-03): reads operator identity from
// middleware-injected headers, calls validateSession() for the permission map, and renders the
// platform header + client editor. Gated production.manage by middleware.
import { headers } from "next/headers";
import PlatformHeader from "@/components/PlatformHeader";
import ScheduleEditor from "./ScheduleEditor";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export default async function ProductionSchedulePage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const isAdmin = h.get("X-User-Is-Admin") === "1";
  const cookieHeader = h.get("cookie");

  const { DB } = await getEnv();
  const session = await validateSession(DB, cookieHeader);

  const permissions = session?.permissions ?? {};

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        currentPath="/v2/production/schedule"
        title="Production Schedule · v2"
      />
      <ScheduleEditor />
    </div>
  );
}
