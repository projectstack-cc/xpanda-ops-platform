// src/app/v2/schedule/page.tsx  →  /v2/schedule
// Server component shell: reads operator identity from middleware-injected headers, calls
// validateSession() for the permission map (same pattern as /v2/cutting), and hands both to
// the client board. The page itself collects no operator input — read-only wall display.
import { headers } from "next/headers";
import ScheduleBoard from "@/components/schedule/ScheduleBoard";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export const metadata = {
  title: "xPanda Schedule — v2",
};

export default async function SchedulePage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const cookieHeader = h.get("cookie");

  const { DB } = await getEnv();
  const session = await validateSession(DB, cookieHeader);

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <ScheduleBoard userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
