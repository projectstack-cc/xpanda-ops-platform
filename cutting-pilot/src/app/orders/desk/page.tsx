// src/app/orders/desk/page.tsx  →  /v2/orders/desk
// ord-dash-02: server shell for the Orders intake desk. DARK — reachable by direct URL only (no nav,
// home card or legacy link until ord-dash-04). Gated by the existing `/v2/orders` → `orders` row in
// middleware's PERMISSION_MAP (no change). Data: GET /v2/api/orders/desk (ord-dash-01).
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import OrderDesk from "./OrderDesk";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Orders desk — v2",
};

export default async function OrderDeskPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <OrderDesk userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
