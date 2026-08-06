// src/app/orders/page.tsx  →  /v2/orders
// Server shell for the order-entry module. Middleware gates this path on the `orders`
// permission (see PERMISSION_MAP). Placeholder only — the order form lands in P339,
// the /v2/api/orders handler in P338.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export const metadata = {
  title: "xPanda Orders — v2",
};

export default async function OrdersPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  await validateSession(DB, h.get("cookie"));

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 500 }}>Order entry</h1>
      <p style={{ color: "#6b7280" }}>
        Coming in P339 — manual order form and packing-slip prefill.
        {userName ? ` Signed in as ${userName}.` : ""}
      </p>
    </main>
  );
}
