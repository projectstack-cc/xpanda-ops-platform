// src/app/carrier/page.tsx  →  /v2/carrier
// Server shell for the carrier view — mirrors app/logistics/page.tsx: session → PlatformHeader props.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import CarrierBoard from "./CarrierBoard";

export const dynamic = "force-dynamic";

export const metadata = { title: "XPanda - Carrier View" };

export default async function CarrierPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return <CarrierBoard userName={userName} isAdmin={isAdmin} permissions={permissions} />;
}
