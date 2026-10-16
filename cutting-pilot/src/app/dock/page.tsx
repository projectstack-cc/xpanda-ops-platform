// src/app/dock/page.tsx  ->  /v2/dock
// dock-10: full-screen Dock Tablet page (one tablet per set of bays, `?bays=24,25`). Server
// shell, same pattern as app/logistics/loading/page.tsx; gated by middleware on
// `logistics.loading`. No PlatformHeader. Light mode is forced for /v2/dock by layout.tsx's
// pre-paint theme script. Unlinked until dock-11 (direct URL only).
import { Suspense } from "react";
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import DockTablet from "./DockTablet";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Dock",
};

export default async function DockTabletPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return (
    // DockTablet reads ?bays= via useSearchParams() -- Next.js requires a Suspense boundary.
    <Suspense fallback={null}>
      <DockTablet userName={userName} isAdmin={isAdmin} permissions={permissions} />
    </Suspense>
  );
}
