// src/app/orders/page.tsx  →  /v2/orders
// Server shell for the order-entry module. Middleware gates this path on the `orders`
// permission (see PERMISSION_MAP). Renders the manual order form (P339); packing-slip
// prefill lands in P340.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import OrderEntryForm from "@/components/orders/OrderEntryForm";

export const metadata = {
  title: "xPanda Orders — v2",
};

export default async function OrdersPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <OrderEntryForm userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
