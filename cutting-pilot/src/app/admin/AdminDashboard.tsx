"use client";
// src/app/admin/AdminDashboard.tsx — admin-03
// Page body for /v2/admin: title block, real-admin metric tiles, and the Users · Roles · Parts · Activity
// tab card. Tabs mount when shown (no keep-alive) and sync ?tab= via history.replaceState, not the router.
// The "Testing as" strip + Stop is the global SimulationBanner in the root layout (admin-02), which already
// renders on this page — no second banner here.
import { useCallback, useEffect, useState } from "react";
import PlatformHeader from "@/components/PlatformHeader";
import MetricTile from "@/components/dashboard/MetricTile";
import UsersTab from "@/components/admin/UsersTab";
import RolesTab from "@/components/admin/RolesTab";
import { adminApi } from "@/lib/admin/client";
import type { AdminAccess, AdminStats, AdminTab } from "@/lib/admin/types";

interface Props {
  userName: string;
  userId: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
  access: AdminAccess;
  initialTab: AdminTab;
}

const TABS: { key: AdminTab; label: string }[] = [
  { key: "users", label: "Users" },
  { key: "roles", label: "Roles" },
  { key: "parts", label: "Parts" },
  { key: "activity", label: "Activity" },
];

function TabPending({ name }: { name: string }) {
  return <div className="p-10 text-center text-sm text-muted">{name} — not built yet</div>;
}

export default function AdminDashboard({ userName, userId, isAdmin, permissions, access, initialTab }: Props) {
  const [tab, setTabState] = useState<AdminTab>(initialTab);
  const [stats, setStats] = useState<AdminStats | null>(null);

  const refreshStats = useCallback(async () => {
    if (!access.isRealAdmin) return;
    const r = await adminApi<{ stats: AdminStats }>("GET", "/stats");
    if (r.ok) setStats(r.data.stats);
  }, [access.isRealAdmin]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const setTab = (t: AdminTab) => {
    setTabState(t);
    window.history.replaceState(null, "", `/v2/admin?tab=${t}`);
  };

  const visibleTabs = TABS.filter((t) => access[t.key]);

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="Admin"
        currentPath="/v2/admin"
      />

      <div className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 space-y-4">
        <div>
          <div className="text-[var(--brand)] text-xs font-semibold uppercase tracking-wider">ADMINISTRATION</div>
          <h1 className="text-2xl font-bold text-text">Platform Admin</h1>
          <p className="text-sm text-muted">Users, roles and permissions, the parts library, and the audit trail.</p>
        </div>

        {access.isRealAdmin && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MetricTile
              label="Users"
              value={stats?.users_active}
              unit={`active / ${stats ? stats.users_total : "—"} total`}
              caption={stats ? `${stats.users_total - stats.users_active} disabled` : undefined}
              onClick={access.users ? () => setTab("users") : undefined}
            />
            <MetricTile
              label="Roles"
              value={stats?.roles}
              unit="roles"
              caption={stats ? `${stats.users_without_role} users without a role` : undefined}
              onClick={access.roles ? () => setTab("roles") : undefined}
            />
            <MetricTile
              label="Activity"
              value={stats?.activity_24h}
              unit="last 24h"
              caption={stats ? `${stats.activity_7d} last 7 days` : undefined}
              onClick={access.activity ? () => setTab("activity") : undefined}
            />
          </div>
        )}

        <div className="bg-surface border border-[var(--card-border)] rounded">
          <nav aria-label="Admin sections" className="flex overflow-x-auto border-b border-[var(--border)]">
            {visibleTabs.map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  aria-current={active ? "page" : undefined}
                  className={`min-h-[44px] px-4 text-sm font-semibold border-b-2 -mb-px cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    active ? "border-[var(--brand)] text-text" : "border-transparent text-muted hover:text-text"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>

          {tab === "users" && access.users && <UsersTab currentUserId={userId} onChanged={refreshStats} />}
          {tab === "roles" && access.roles && <RolesTab onChanged={refreshStats} />}
          {tab === "parts" && access.parts && <TabPending name="Parts" />}
          {tab === "activity" && access.activity && <TabPending name="Activity" />}
        </div>
      </div>
    </div>
  );
}
