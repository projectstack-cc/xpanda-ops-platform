// src/app/board/page.tsx  →  /v2/board
// Server shell for the v2 production board. Middleware gates this path on the `jobs`
// permission (same as the legacy job board). Placeholder only — the read-only board UI
// consuming GET /v2/api/board lands in P342.
import { headers } from "next/headers";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";

export const metadata = {
  title: "xPanda Production Board — v2",
};

export default async function BoardPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";

  const { DB } = await getEnv();
  await validateSession(DB, h.get("cookie"));

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 500 }}>Production board</h1>
      <p style={{ color: "#6b7280" }}>
        Coming in P342 — read-only board UI with status cards and click-through modals.
        {userName ? ` Signed in as ${userName}.` : ""}
      </p>
    </main>
  );
}
