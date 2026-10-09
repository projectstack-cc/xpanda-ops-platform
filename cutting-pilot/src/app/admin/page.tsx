// src/app/admin/page.tsx  ->  /v2/admin (admin-03)
// Server shell for v2 Admin (collapses legacy admin/users, roles, parts, activity-log). Middleware gates
// the path on `admin` OR `manufacturing.calculators` (plus the real-admin escape hatch); this page adds
// the per-tab layer via computeAdminAccess. Unlinked until the admin cutover prompt.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import { computeAdminAccess, type AdminAccess, type AdminTab } from "@/lib/admin/types";
import AdminDashboard from "./AdminDashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Admin",
};

const TAB_ORDER: AdminTab[] = ["users", "roles", "parts", "activity"];

export default async function AdminPage({ searchParams }: { searchParams: { tab?: string } }) {
  const h = await headers();
  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const access: AdminAccess | null = session ? computeAdminAccess(session) : null;
  const allowed = access ? TAB_ORDER.filter((t) => access[t]) : [];
  if (!session || !access || allowed.length === 0) {
    // Absolute URL: the legacy home lives outside the /v2 basePath (mirrors middleware's denial).
    const host = h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto") ?? "https";
    redirect(`${proto}://${host}/?access_denied=1`);
  }

  const requested = searchParams.tab as AdminTab | undefined;
  const initialTab: AdminTab = requested && allowed.includes(requested) ? requested : allowed[0];

  return (
    <AdminDashboard
      userName={h.get("X-User-Name") ?? session.displayName ?? session.username}
      userId={session.userId}
      isAdmin={session.isAdministrator}
      permissions={session.permissions}
      access={access}
      initialTab={initialTab}
    />
  );
}
