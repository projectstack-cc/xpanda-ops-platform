// src/app/blocks/calculator/page.tsx  →  /v2/blocks/calculator  (blk-01)
// Server shell: reads operator identity from middleware-injected headers, calls
// validateSession() for the permission map, and renders the platform header + client app.
// Gated by manufacturing.calculators (middleware row above /v2/blocks). Direct URL only until blk-03.
import { headers } from "next/headers";
import PlatformHeader from "@/components/PlatformHeader";
import BlockCalculator from "@/components/blockCalc/BlockCalculator";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function BlockCalculatorPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const cookieHeader = h.get("cookie");

  const { DB } = await getEnv();
  const session = await validateSession(DB, cookieHeader);

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        currentPath="/v2/blocks/calculator"
        title="Block Calculator · v2"
      />
      <BlockCalculator />
    </div>
  );
}
