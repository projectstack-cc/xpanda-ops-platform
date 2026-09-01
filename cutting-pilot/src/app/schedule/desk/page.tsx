// src/app/v2/schedule/desk/page.tsx  →  /v2/schedule/desk
// Interactive desk variant of the schedule board. Same session/permission pattern as /v2/schedule;
// gated on `schedule` via the existing /v2/schedule middleware prefix (no middleware change).
import { headers } from "next/headers";
import InteractiveScheduleBoard from "@/components/schedule/InteractiveScheduleBoard";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export const metadata = {
  title: "xPanda Schedule — Desk",
};

export default async function ScheduleDeskPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const cookieHeader = h.get("cookie");

  const { DB } = await getEnv();
  const session = await validateSession(DB, cookieHeader);

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <InteractiveScheduleBoard userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
