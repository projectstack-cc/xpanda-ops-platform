// src/app/loading/page.tsx  →  /v2/loading
// Server component shell: reads operator identity from middleware-injected headers, calls
// validateSession() for the permission map (same pattern as /v2/schedule), and hands both to
// the client board. The page itself collects no operator input — read-only wall display.
import { headers } from "next/headers";
import LoadingBoard from "@/components/loading/LoadingBoard";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export const metadata = {
  title: "xPanda Loading — v2",
};

export default async function LoadingPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const cookieHeader = h.get("cookie");

  const { DB } = await getEnv();
  const session = await validateSession(DB, cookieHeader);

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <LoadingBoard userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
