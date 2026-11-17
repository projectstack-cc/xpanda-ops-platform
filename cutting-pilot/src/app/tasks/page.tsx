// src/app/tasks/page.tsx  →  /v2/tasks  (tasks-02)
// Server shell for the Daily Tasks manager page. Gated on tasks.manage (view) by middleware (tasks-01 rows).
// canEdit = tasks.manage EDIT (X-User-Can-Edit-Tasks) or admin: shows New / Edit / Remove. Direct URL only until
// tasks-04 (no nav/home link). ?date=YYYY-MM-DD picks the day; default = ET today.
import { headers } from "next/headers";
import PlatformHeader from "@/components/PlatformHeader";
import DailyTasks from "@/components/tasks/DailyTasks";
import { validateSession } from "@/lib/session";
import { getEnv } from "@/lib/db";
import { etNowWallClock } from "@/lib/etDateTime";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "xPanda Daily Tasks — v2",
};

export default async function DailyTasksPage({ searchParams }: { searchParams: { date?: string | string[] } }) {
  const h = await headers();
  const userName = h.get("X-User-Name") ?? "";
  const canEdit = h.get("X-User-Can-Edit-Tasks") === "1" || h.get("X-User-Is-Admin") === "1";

  const { DB } = await getEnv();
  const session = await validateSession(DB, h.get("cookie"));

  const raw = typeof searchParams?.date === "string" ? searchParams.date : "";
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) ? raw : etNowWallClock().date;

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <PlatformHeader
        userName={userName}
        isAdmin={session?.isAdministrator ?? false}
        permissions={session?.permissions ?? {}}
        currentPath="/v2/tasks"
        title="Daily Tasks · v2"
      />
      <DailyTasks canEdit={canEdit} initialDate={initialDate} />
    </div>
  );
}
