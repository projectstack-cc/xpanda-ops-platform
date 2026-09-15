// src/app/logistics/load-builder/page.tsx  ->  /v2/logistics/load-builder
// Server shell for the v2 load builder's read-only plan view (lb-ui-01). Inherits the dark-launch
// gate from the existing `{ prefix: "/v2/logistics", keys: ["logistics.v2"] }` middleware rule —
// no role holds `logistics.v2` yet, so this resolves admin-only with no middleware change.
//
// Deliberately reads identity from the middleware-injected X-User-* headers only — no
// validateSession()/getEnv() call, unlike every other page in this module. This prompt's own scope
// fence is "no API routes, no D1, no data layer": the plan view runs pack() against a fixture and
// renders the result, nothing else, so there is no reason to touch D1 just to render the header.
import { headers } from "next/headers";
import PlatformHeader from "@/components/PlatformHeader";
import LoadPlanView from "./LoadPlanView";

export const metadata = {
  title: "xPanda Load Builder — v2",
};

export default async function LoadBuilderPage() {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const isAdmin = h.get("X-User-Is-Admin") === "1";

  let permissions: Record<string, { view?: boolean; edit?: boolean }> = {};
  try {
    permissions = JSON.parse(h.get("X-User-Permissions") ?? "{}");
  } catch {
    permissions = {};
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="Load builder · v2"
        currentPath="/v2/logistics/load-builder"
      />
      <LoadPlanView />
    </div>
  );
}
