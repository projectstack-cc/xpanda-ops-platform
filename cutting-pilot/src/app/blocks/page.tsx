// src/app/blocks/page.tsx  →  /v2/blocks
// Server shell: reads operator identity from middleware-injected headers, calls
// validateSession() for the permission map, and renders the platform header + client app.
// Standalone module — no job link, ephemeral (no persistence).
import { headers } from "next/headers";
import PlatformHeader from "@/components/PlatformHeader";
import BlocksApp from "./BlocksApp";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export default async function BlocksPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const cookieHeader = h.get("cookie");

  const { DB } = await getEnv();
  const session = await validateSession(DB, cookieHeader);

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        currentPath="/v2/blocks"
        title="Block nesting · v2"
      />
      <BlocksApp />
    </div>
  );
}
