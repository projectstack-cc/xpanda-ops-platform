// src/app/v2/cutting/page.tsx  →  /v2/cutting
// Server component shell: reads operator identity from middleware-injected headers,
// calls validateSession() to obtain the full permission map, and passes both down
// to the client board (no client /me fetch needed).
import { headers } from "next/headers";
import CuttingBoard from "./CuttingBoard";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export default async function CuttingPage() {
  const h = await headers();
  const userId = h.get("X-User-Id") ?? "";
  const userName = h.get("X-User-Name") ?? "";
  const cookieHeader = h.get("cookie");

  const { DB } = await getEnv();
  const session = await validateSession(DB, cookieHeader);

  const isAdmin = session?.isAdministrator ?? false;
  const permissions = session?.permissions ?? {};

  return (
    <CuttingBoard
      userId={userId}
      userName={userName}
      isAdmin={isAdmin}
      permissions={permissions}
    />
  );
}
