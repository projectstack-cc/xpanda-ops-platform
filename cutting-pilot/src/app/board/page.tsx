// src/app/board/page.tsx  →  /v2/board
// Server shell for the v2 production board. Middleware gates this path on the `jobs`
// permission (same as the legacy job board). Renders the read-only board UI (P342); inline
// edit + assign land in P343.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import ProductionBoard from "@/components/board/ProductionBoard";

export const metadata = {
  title: "xPanda Production Board — v2",
};

export default async function BoardPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <ProductionBoard userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
