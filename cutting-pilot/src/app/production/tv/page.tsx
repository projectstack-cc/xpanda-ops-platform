// src/app/production/tv/page.tsx  →  /v2/production/tv
// Server component shell for the production TV board (prod-d-04), mirroring app/loading/page.tsx:
// reads identity from middleware-injected headers, calls validateSession() for the permission map,
// and hands both to the client board. Read-only wall display, gated production.tv (or
// production.log) by middleware.
import { headers } from "next/headers";
import ProductionTvBoard from "./ProductionTvBoard";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export const metadata = {
  title: "xPanda Production — TV",
};

export default async function ProductionTvPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const cookieHeader = h.get("cookie");

  const { DB } = await getEnv();
  const session = await validateSession(DB, cookieHeader);

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <ProductionTvBoard userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
