"use client";
// src/components/admin/RolesTab.tsx — admin-04
// Port of legacy admin/roles.html: role list + editor (permission matrix, notification types, Test as role).
// Save is EXPLICIT (legacy auto-saved every toggle after 500ms) because edits land on live floor accounts.
// `permissions` is always sent whole, so keys not in PERMISSION_LABELS survive a save untouched — the
// admin-01 no-access-change guarantee depends on that. Unknown notification types are kept the same way.
import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import Modal from "@/components/Modal";
import { NOTIFICATION_TYPES, PERMISSION_GROUPS, PERMISSION_LABELS } from "@/lib/permissions";
import { adminApi, btnDangerSm, btnPrimary, btnSm, errorBannerCls, inputCls } from "@/lib/admin/client";
import type { AdminRole, PermissionMap } from "@/lib/admin/types";

interface Props {
  onChanged: () => void;
}

interface Working {
  name: string;
  description: string;
  permissions: PermissionMap;
  notification_types: string[];
}

const ADMIN_ROLE_ID = "role-administrator";
const FLAGS = ["view", "edit"] as const;
const KNOWN_NOTIFICATION_KEYS = new Set(NOTIFICATION_TYPES.map((n) => n.key));
const labelCls = "block text-xs font-semibold uppercase tracking-wider text-muted mb-1";
const checkCellCls = "flex items-center justify-center min-w-[44px] min-h-[44px] cursor-pointer";

function toWorking(r: AdminRole): Working {
  return {
    name: r.name,
    description: r.description,
    permissions: JSON.parse(JSON.stringify(r.permissions || {})),
    notification_types: [...r.notification_types],
  };
}

function flag(p: PermissionMap, key: string, f: "view" | "edit"): boolean {
  return !!(p[key] as any)?.[f];
}

function countPermChanges(a: PermissionMap, b: PermissionMap): number {
  let n = 0;
  for (const k of Array.from(new Set(Object.keys(a).concat(Object.keys(b))))) {
    for (const f of FLAGS) if (flag(a, k, f) !== flag(b, k, f)) n++;
  }
  return n;
}

function countNotifChanges(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let n = 0;
  for (const x of Array.from(sa)) if (!sb.has(x)) n++;
  for (const x of Array.from(sb)) if (!sa.has(x)) n++;
  return n;
}

function defaultSelection(roles: AdminRole[]): string | null {
  return (roles.find((r) => !r.is_system) ?? roles[0])?.id ?? null;
}

export default function RolesTab({ onChanged }: Props) {
  const [roles, setRoles] = useState<AdminRole[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [working, setWorking] = useState<Working | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDesc, setAddDesc] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const selected = useMemo(() => roles?.find((r) => r.id === selectedId) ?? null, [roles, selectedId]);

  const select = useCallback((role: AdminRole | null) => {
    setSelectedId(role?.id ?? null);
    setWorking(role ? toWorking(role) : null);
    setPendingSwitch(null);
    setDeleteArmed(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await adminApi<{ roles: AdminRole[] }>("GET", "/roles");
    setLoading(false);
    if (!r.ok) {
      setLoadError(r.error);
      return;
    }
    setLoadError(null);
    setRoles(r.data.roles);
    const id = defaultSelection(r.data.roles);
    select(r.data.roles.find((x) => x.id === id) ?? null);
  }, [select]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);

  // Delete arm: 4s idle or any click elsewhere disarms.
  useEffect(() => {
    if (!deleteArmed) return;
    const t = setTimeout(() => setDeleteArmed(false), 4000);
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest("[data-armed]")) setDeleteArmed(false);
    };
    const attach = setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => {
      clearTimeout(t);
      clearTimeout(attach);
      document.removeEventListener("click", onDocClick);
    };
  }, [deleteArmed]);

  const isAdminRole = selected?.id === ADMIN_ROLE_ID;
  const permChanges = selected && working ? countPermChanges(selected.permissions, working.permissions) : 0;
  const notifChanges = selected && working ? countNotifChanges(selected.notification_types, working.notification_types) : 0;
  const nameChanged = !!selected && !!working && working.name.trim() !== selected.name;
  const descChanged = !!selected && !!working && working.description.trim() !== (selected.description ?? "");
  const dirty = nameChanged || descChanged || permChanges > 0 || notifChanges > 0;

  const summary = [
    permChanges ? `${permChanges} permission change${permChanges === 1 ? "" : "s"}` : "",
    notifChanges ? `${notifChanges} notification change${notifChanges === 1 ? "" : "s"}` : "",
    nameChanged || descChanged ? "details changed" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  function onRoleClick(role: AdminRole) {
    if (role.id === selectedId) return;
    if (dirty && pendingSwitch !== role.id) {
      setPendingSwitch(role.id);
      return;
    }
    select(role);
  }

  function setPerm(key: string, f: "view" | "edit", checked: boolean) {
    setWorking((w) => {
      if (!w) return w;
      const cur = { view: flag(w.permissions, key, "view"), edit: flag(w.permissions, key, "edit") };
      // Legacy coupling: View off clears Edit; Edit needs View; View on never auto-checks Edit.
      const next = f === "view" ? { view: checked, edit: checked ? cur.edit : false } : { view: cur.view, edit: checked && cur.view };
      return { ...w, permissions: { ...w.permissions, [key]: { ...(w.permissions[key] as object), ...next } } };
    });
  }

  function toggleNotif(key: string) {
    setWorking((w) =>
      w
        ? {
            ...w,
            notification_types: w.notification_types.includes(key)
              ? w.notification_types.filter((x) => x !== key)
              : [...w.notification_types, key],
          }
        : w
    );
  }

  function replaceRole(role: AdminRole) {
    setRoles((prev) => (prev ? prev.map((r) => (r.id === role.id ? role : r)) : prev));
  }

  async function save() {
    if (!selected || !working || !dirty) return;
    const body: Record<string, unknown> = {};
    if (nameChanged) body.name = working.name.trim();
    if (descChanged) body.description = working.description.trim();
    if (permChanges > 0) body.permissions = working.permissions; // whole object — unlisted keys included
    if (notifChanges > 0) body.notification_types = working.notification_types;
    setSaving(true);
    setError(null);
    const r = await adminApi<{ role: AdminRole }>("PATCH", `/roles/${encodeURIComponent(selected.id)}`, body);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    replaceRole(r.data.role);
    setWorking(toWorking(r.data.role));
    setPendingSwitch(null);
    setStatus(`Saved ${r.data.role.name}.`);
    onChanged();
  }

  async function deleteRole() {
    if (!selected) return;
    setDeleteArmed(false);
    setBusy(true);
    setError(null);
    const r = await adminApi("DELETE", `/roles/${encodeURIComponent(selected.id)}`);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const name = selected.name;
    const rest = (roles ?? []).filter((x) => x.id !== selected.id);
    setRoles(rest);
    const id = defaultSelection(rest);
    select(rest.find((x) => x.id === id) ?? null);
    setStatus(`Deleted ${name}.`);
    onChanged();
  }

  async function testAs() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const r = await adminApi("POST", "/simulate-role", { role_id: selected.id });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    window.location.reload();
  }

  async function addRole(e: React.FormEvent) {
    e.preventDefault();
    const name = addName.trim();
    if (name.length < 2) return setAddError("Role name must be at least 2 characters.");
    setAdding(true);
    setAddError(null);
    const r = await adminApi<{ role: AdminRole }>("POST", "/roles", { name, description: addDesc.trim() });
    setAdding(false);
    if (!r.ok) {
      setAddError(r.error);
      return;
    }
    setRoles((prev) => [...(prev ?? []), r.data.role]);
    select(r.data.role);
    setAddOpen(false);
    setStatus(`Created ${r.data.role.name}.`);
    onChanged();
  }

  const unlistedKeys = working ? Object.keys(working.permissions).filter((k) => !(k in PERMISSION_LABELS)) : [];
  const unknownNotifs = working ? working.notification_types.filter((k) => !KNOWN_NOTIFICATION_KEYS.has(k)) : [];

  return (
    <div>
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
            <span>Couldn&apos;t load roles: {loadError}</span>
            <button type="button" className={btnSm} onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}
        {status && (
          <div role="status" className="text-sm font-semibold text-[var(--success-bg)]">
            {status}
          </div>
        )}
        {loading && !roles && <div className="py-8 text-sm text-muted">Loading roles…</div>}
      </div>

      {roles && (
        <div className="flex flex-wrap border-t border-[var(--border)]">
          {/* Role list */}
          <div className="flex-[1_1_260px] max-w-full sm:max-w-[320px] border-b sm:border-b-0 sm:border-r border-[var(--border)]">
            <div className="flex items-center justify-between gap-2 p-3 border-b border-[var(--border)]">
              <h2 className="text-sm font-bold text-text">Roles</h2>
              <button
                type="button"
                className={btnSm}
                disabled={dirty}
                title={dirty ? "Save or discard changes first" : undefined}
                onClick={() => {
                  setAddName("");
                  setAddDesc("");
                  setAddError(null);
                  setAddOpen(true);
                }}
              >
                + Add role
              </button>
            </div>
            <div>
              {roles.map((r) => {
                const active = r.id === selectedId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onRoleClick(r)}
                    aria-current={active ? "true" : undefined}
                    className={`w-full min-h-[52px] px-3 py-2 text-left flex items-center justify-between gap-2 border-b border-[var(--border-light)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                      active ? "border-l-[3px] border-l-[var(--brand)] bg-[var(--accent-soft)]" : "border-l-[3px] border-l-transparent hover:bg-[var(--ghost-bg)]"
                    } ${pendingSwitch === r.id ? "outline outline-1 outline-[var(--warn-border)]" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-text truncate">{r.name}</span>
                      <span className="block font-mono text-xs text-muted">{r.member_count} users</span>
                    </span>
                    {r.is_system && (
                      <span className="shrink-0 rounded-sm border border-[var(--border)] text-[10px] font-semibold uppercase tracking-wider text-muted px-1.5">
                        System
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-[999_1_520px] min-w-0 p-4 space-y-4">
            {!selected || !working ? (
              <div className="py-8 text-sm text-muted">Select a role to edit.</div>
            ) : (
              <>
                {pendingSwitch && (
                  <div role="status" className="rounded border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] px-3 py-2 text-sm font-semibold">
                    Unsaved changes — click the role again to discard
                  </div>
                )}

                <div className="flex flex-wrap items-start gap-4">
                  <div className="flex-[1_1_320px] min-w-0 space-y-3">
                    <div>
                      <label className={labelCls} htmlFor="role-name">Name</label>
                      <input
                        id="role-name"
                        className={inputCls}
                        value={working.name}
                        readOnly={isAdminRole}
                        onChange={(e) => setWorking({ ...working, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="role-desc">Description</label>
                      <input
                        id="role-desc"
                        className={inputCls}
                        value={working.description}
                        onChange={(e) => setWorking({ ...working, description: e.target.value })}
                      />
                    </div>
                    <div className="font-mono text-xs text-muted">{selected.id}</div>
                  </div>

                  <div className="flex-[1_1_240px] space-y-3">
                    {!isAdminRole && (
                      <div>
                        <button type="button" className={btnSm} disabled={busy || dirty} onClick={() => void testAs()}>
                          Test as this role
                        </button>
                        <p className="mt-1 text-xs text-muted">
                          Opens every page as this role sees it. Admin stays reachable so you can stop.
                        </p>
                      </div>
                    )}
                    {!selected.is_system && (
                      <div>
                        <button
                          type="button"
                          data-armed={deleteArmed ? "" : undefined}
                          className={deleteArmed ? btnDangerSm : btnSm}
                          disabled={busy || selected.member_count > 0}
                          onClick={() => (deleteArmed ? void deleteRole() : setDeleteArmed(true))}
                        >
                          {deleteArmed ? "Confirm delete?" : "Delete role"}
                        </button>
                        {selected.member_count > 0 && (
                          <p className="mt-1 text-xs text-muted">Reassign its {selected.member_count} users first</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {isAdminRole && (
                  <div className="rounded border border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)] px-3 py-2 text-sm font-semibold">
                    Administrators bypass every permission check; these toggles have no effect.
                  </div>
                )}

                <div className="flex flex-wrap gap-4">
                  {/* Permission matrix */}
                  <div className="flex-[3_1_420px] min-w-0 border border-[var(--border)] rounded overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-[var(--border)]">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">Permission</th>
                          <th className="px-1 py-2 w-[60px] text-center text-xs font-semibold uppercase tracking-wider text-muted">View</th>
                          <th className="px-1 py-2 w-[60px] text-center text-xs font-semibold uppercase tracking-wider text-muted">Edit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PERMISSION_GROUPS.map((group) => (
                          <GroupRows key={group} group={group}>
                            {Object.entries(PERMISSION_LABELS)
                              .filter(([, v]) => v.group === group)
                              .map(([key, v]) => {
                                const view = flag(working.permissions, key, "view");
                                const edit = flag(working.permissions, key, "edit");
                                return (
                                  <tr key={key} className="border-b border-[var(--border-light)]">
                                    <td className="px-3 py-1">
                                      <div className="text-text">{v.label}</div>
                                      <div className="font-mono text-xs text-muted">{key}</div>
                                    </td>
                                    <td className="px-1">
                                      <label className={checkCellCls}>
                                        <input
                                          type="checkbox"
                                          className="w-4 h-4"
                                          checked={view}
                                          disabled={isAdminRole}
                                          onChange={(e) => setPerm(key, "view", e.target.checked)}
                                        />
                                        <span className="sr-only">View {v.label}</span>
                                      </label>
                                    </td>
                                    <td className="px-1">
                                      <label className={checkCellCls}>
                                        <input
                                          type="checkbox"
                                          className="w-4 h-4"
                                          checked={edit}
                                          disabled={isAdminRole || !view}
                                          onChange={(e) => setPerm(key, "edit", e.target.checked)}
                                        />
                                        <span className="sr-only">Edit {v.label}</span>
                                      </label>
                                    </td>
                                  </tr>
                                );
                              })}
                          </GroupRows>
                        ))}
                        {unlistedKeys.length > 0 && (
                          <GroupRows group="Other keys (not in the label list)">
                            {unlistedKeys.map((key) => {
                              const raw = working.permissions[key] as unknown;
                              const isFlags = !!raw && typeof raw === "object" && ("view" in (raw as object) || "edit" in (raw as object));
                              return (
                                <tr key={key} className="border-b border-[var(--border-light)]">
                                  <td className="px-3 py-2 font-mono text-xs text-text">{key}</td>
                                  {isFlags ? (
                                    <>
                                      <td className="px-1 text-center text-xs text-muted">{flag(working.permissions, key, "view") ? "Yes" : "No"}</td>
                                      <td className="px-1 text-center text-xs text-muted">{flag(working.permissions, key, "edit") ? "Yes" : "No"}</td>
                                    </>
                                  ) : (
                                    <td colSpan={2} className="px-1 font-mono text-xs text-muted">{JSON.stringify(raw)}</td>
                                  )}
                                </tr>
                              );
                            })}
                          </GroupRows>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Notifications */}
                  <div className="flex-[1_1_260px] min-w-0 border border-[var(--border)] rounded p-3 space-y-2 self-start">
                    <div>
                      <h3 className="text-sm font-bold text-text">Notifications</h3>
                      <p className="text-xs text-muted">Push and bell alerts that members of this role receive.</p>
                    </div>
                    <div>
                      {NOTIFICATION_TYPES.map((n) => (
                        <label key={n.key} className="flex items-center gap-3 min-h-[44px] cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-4 h-4 shrink-0"
                            checked={working.notification_types.includes(n.key)}
                            onChange={() => toggleNotif(n.key)}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm text-text">{n.label}</span>
                            <span className="block font-mono text-xs text-muted">{n.key}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    {unknownNotifs.length > 0 && (
                      <div className="pt-2 border-t border-[var(--border-light)]">
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Other types (kept on save)</div>
                        {unknownNotifs.map((k) => (
                          <div key={k} className="font-mono text-xs text-muted">{k}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-[var(--border)]">
                  {dirty && <span className="text-xs font-semibold text-muted">{summary}</span>}
                  <button type="button" className={btnSm} disabled={!dirty || saving} onClick={() => select(selected)}>
                    Discard
                  </button>
                  <button type="button" className={btnPrimary} disabled={!dirty || saving} onClick={() => void save()}>
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Modal isOpen={addOpen} onClose={() => setAddOpen(false)} title="Add role">
        <form onSubmit={addRole} className="space-y-4" noValidate>
          <div>
            <label className={labelCls} htmlFor="add-role-name">Name</label>
            <input id="add-role-name" className={inputCls} value={addName} onChange={(e) => setAddName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="add-role-desc">Description</label>
            <input id="add-role-desc" className={inputCls} value={addDesc} onChange={(e) => setAddDesc(e.target.value)} />
          </div>
          <p className="text-xs text-muted">New roles start with every permission off.</p>
          {addError && (
            <p role="alert" className="text-sm font-semibold text-[var(--danger-bg)]">
              {addError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnSm} onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={btnPrimary} disabled={adding}>
              {adding ? "Saving…" : "Create role"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function GroupRows({ group, children }: { group: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-b border-[var(--border-light)] bg-[var(--surface-2)]">
        <td colSpan={3} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[var(--brand)]">
          {group}
        </td>
      </tr>
      {children}
    </>
  );
}
