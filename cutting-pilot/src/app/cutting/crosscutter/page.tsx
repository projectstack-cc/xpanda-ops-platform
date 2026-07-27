// src/app/cutting/crosscutter/page.tsx  →  /v2/cutting/crosscutter
// Server shell: reads operator identity from middleware-injected headers, calls
// validateSession() for the permission map, and renders the platform header + client board.
// Standalone from the main /v2/cutting board — no job link, no jobs.status writes.
import { headers } from "next/headers";
import PlatformHeader from "@/components/PlatformHeader";
import ChunkBoard from "./ChunkBoard";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export default async function CrossCutterPage() {
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
        currentPath="/v2/cutting/crosscutter"
        title="Cross Cutter / Hole Cutter · v2"
      />
      <ChunkBoard />
    </div>
  );
}
