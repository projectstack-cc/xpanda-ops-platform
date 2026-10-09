"use client";
// src/components/admin/UsersTab.tsx — admin-03
// Port of legacy admin/users.html. Passwords stay available (plaintext by design, for floor-worker recovery —
// AGENTS §3) but are masked by default with a per-row reveal. Reset / Disable / Enable / Delete use the
// house two-step arm/confirm (BolEmailQueue armedRid pattern): any other click or 4s idle disarms.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import SearchInput from "@/components/dashboard/SearchInput";
import FilterSelect from "@/components/dashboard/FilterSelect";
import UserEditModal from "@/components/admin/UserEditModal";
import { adminApi, btnDangerSm, btnPrimary, btnSm, errorBannerCls } from "@/lib/admin/client";
import type { AdminRole, AdminUser } from "@/lib/admin/types";

interface Props {
  currentUserId: string;
  onChanged: () => void;
}

type ArmAction = "reset" | "toggle" | "delete";

const thCls = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted";
const tdCls = "px-3 py-2 align-middle";

export default function UsersTab({ currentUserId, onChanged }: Props) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");

  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<{ id: string; action: ArmAction } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const loadUsers = useCallback(async () => {
    const r = await adminApi<{ users: AdminUser[] }>("GET", "/users");
    if (r.ok) {
      setUsers(r.data.users);
      setLoadError(null);
    } else {
      setLoadError(r.error);
    }
    return r.ok;
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [, rr] = await Promise.all([loadUsers(), adminApi<{ roles: AdminRole[] }>("GET", "/roles")]);
    if (rr.ok) setRoles(rr.data.roles);
    else setLoadError((prev) => prev ?? rr.error);
    setLoading(false);
  }, [loadUsers]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Transient success line.
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);

  // Disarm after 4s idle, or on any click outside the armed button.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    const onDocClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest("[data-armed]");
      if (!el) setArmed(null);
    };
    const attach = setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => {
      clearTimeout(t);
      clearTimeout(attach);
      document.removeEventListener("click", onDocClick);
    };
  }, [armed]);

  const afterMutation = async (msg: string) => {
    setStatus(msg);
    await loadUsers();
    onChanged();
  };

  async function runArmed(u: AdminUser, action: ArmAction) {
    setArmed(null);
    setBusyId(u.id);
    setError(null);
    const r =
      action === "reset"
        ? await adminApi("PATCH", `/users/${encodeURIComponent(u.id)}`, { first_login: true })
        : action === "toggle"
          ? await adminApi("PATCH", `/users/${encodeURIComponent(u.id)}`, { is_active: !u.is_active })
          : await adminApi("DELETE", `/users/${encodeURIComponent(u.id)}`);
    setBusyId(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const name = u.display_name || u.username;
    await afterMutation(
      action === "reset"
        ? `${name} will be asked to set a new password at next login.`
        : action === "toggle"
          ? `${name} ${u.is_active ? "disabled" : "enabled"}.`
          : `${name} deleted.`
    );
  }

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (q && !u.display_name.toLowerCase().includes(q) && !u.username.toLowerCase().includes(q)) return false;
      if (roleFilter && !u.roles.some((r) => r.role_id === roleFilter)) return false;
      if (statusFilter === "active" && !u.is_active) return false;
      if (statusFilter === "disabled" && u.is_active) return false;
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);

  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const armButton = (u: AdminUser, action: ArmAction, label: string, confirmLabel: string) => {
    const isArmed = armed?.id === u.id && armed.action === action;
    return (
      <button
        key={action}
        type="button"
        data-armed={isArmed ? "" : undefined}
        disabled={busyId === u.id}
        onClick={() => (isArmed ? void runArmed(u, action) : setArmed({ id: u.id, action }))}
        className={isArmed ? btnDangerSm : btnSm}
      >
        {isArmed ? confirmLabel : label}
      </button>
    );
  };

  return (
    <div>
      <div className="p-3 border-b border-[var(--border)] flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or username" />
        <FilterSelect
          value={roleFilter}
          onChange={setRoleFilter}
          allLabel="All roles"
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
        />
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          allLabel="All statuses"
          options={[
            { value: "active", label: "Active" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
        <div className="flex-1" />
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          + Add user
        </button>
      </div>

      <div className="p-3 space-y-2">
        {error && (
          <div role="alert" className={errorBannerCls}>
            <span>{error}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setError(null)} className="shrink-0 cursor-pointer">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        {loadError && (
          <div role="alert" className={errorBannerCls}>
            <span>Couldn&apos;t load users: {loadError}</span>
            <button type="button" className={btnSm} onClick={() => void loadAll()}>
              Retry
            </button>
          </div>
        )}
        {status && (
          <div role="status" className="text-sm font-semibold text-[var(--success-bg)]">
            {status}
          </div>
        )}

        {loading && !users ? (
          <div className="py-8 text-sm text-muted">Loading users…</div>
        ) : users ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="border-b border-[var(--border)]">
                <tr>
                  <th className={thCls}>Name</th>
                  <th className={thCls}>Username</th>
                  <th className={thCls}>Roles</th>
                  <th className={thCls}>Shift</th>
                  <th className={thCls}>Password</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>First login</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted">
                      No users match these filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => {
                    const self = u.id === currentUserId;
                    const shown = revealed.has(u.id);
                    return (
                      <tr key={u.id} className="border-b border-[var(--border-light)] last:border-b-0">
                        <td className={`${tdCls} font-semibold text-text`}>
                          {u.display_name}
                          {self && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
                        </td>
                        <td className={`${tdCls} font-mono text-xs`}>{u.username}</td>
                        <td className={tdCls}>
                          {u.roles.length === 0 ? (
                            <span className="text-xs font-semibold text-[var(--warn-text)]">No role</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {u.roles.map((r) => (
                                <span
                                  key={r.role_id}
                                  className="rounded-sm bg-[var(--accent-soft)] border border-[var(--border)] text-xs px-2"
                                >
                                  {r.role_name}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className={tdCls}>{u.shift ?? "—"}</td>
                        <td className={tdCls}>
                          <div className="flex items-center gap-1 font-mono text-xs">
                            <span className="min-w-[6ch]">{shown ? u.password : "••••••"}</span>
                            <button
                              type="button"
                              onClick={() => toggleReveal(u.id)}
                              aria-label={shown ? "Hide password" : "Show password"}
                              className="flex items-center justify-center min-w-[44px] min-h-[44px] md:min-w-[32px] md:min-h-[32px] rounded text-muted hover:text-text cursor-pointer"
                            >
                              {shown ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                            </button>
                          </div>
                        </td>
                        <td className={tdCls}>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              aria-hidden="true"
                              className={`inline-block w-2 h-2 rounded-full ${u.is_active ? "bg-[var(--success-bg)]" : "bg-[var(--muted)]"}`}
                            />
                            {u.is_active ? "Active" : "Disabled"}
                          </span>
                        </td>
                        <td className={tdCls}>{u.first_login ? <span className="text-[var(--warn-text)] font-semibold">Pending</span> : "—"}</td>
                        <td className={tdCls}>
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              className={btnSm}
                              disabled={busyId === u.id}
                              onClick={() => {
                                setEditing(u);
                                setModalOpen(true);
                              }}
                            >
                              Edit
                            </button>
                            {armButton(u, "reset", "Reset password", "Confirm reset?")}
                            {!self && (
                              armButton(u, "toggle", u.is_active ? "Disable" : "Enable",
                                u.is_active ? "Confirm disable?" : "Confirm enable?")
                            )}
                            {!self && armButton(u, "delete", "Delete", "Confirm delete?")}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <UserEditModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        user={editing}
        roles={roles}
        onSaved={() => {
          const created = !editing;
          setModalOpen(false);
          void afterMutation(created ? "User created." : "User updated.");
        }}
      />
    </div>
  );
}
