// src/app/notes/page.tsx  →  /v2/notes
// Server shell: reads operator identity from middleware-injected headers, calls
// validateSession() for the permission map, and renders the platform header + client board.
// Mirrors app/cutting/crosscutter/page.tsx exactly.
import { headers } from "next/headers";
import PlatformHeader from "@/components/PlatformHeader";
import ShiftNotesBoard from "./ShiftNotesBoard";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export const metadata = {
  title: "xPanda Shift Notes — v2",
};

export default async function NotesPage() {
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
        currentPath="/v2/notes"
        title="Shift Notes · v2"
      />
      <ShiftNotesBoard />
    </div>
  );
}
