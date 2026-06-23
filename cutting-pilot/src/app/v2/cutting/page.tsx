// src/app/v2/cutting/page.tsx  →  /v2/cutting
// Server component shell: reads operator identity from middleware-injected headers,
// passes it down to the client board so the board never needs a separate /me fetch.
import { headers } from "next/headers";
import CuttingBoard from "./CuttingBoard";

export default async function CuttingPage() {
  const h = await headers();
  const userId = h.get("X-User-Id") ?? "";
  const userName = h.get("X-User-Name") ?? "";
  const isAdmin = h.get("X-User-Is-Admin") === "1";

  return (
    <CuttingBoard userId={userId} userName={userName} isAdmin={isAdmin} />
  );
}
