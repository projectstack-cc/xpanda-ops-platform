"use client";
// src/components/admin/UserEditModal.tsx — admin-03
// Create / edit a user. Composes the shared Modal. Edit sends only changed fields (role_ids whenever the
// role set changed; password only if changed). Validation is inline — no alert.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { adminApi, btnPrimary, btnSm, inputCls } from "@/lib/admin/client";
import type { AdminRole, AdminUser } from "@/lib/admin/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** null = create */
  user: AdminUser | null;
  roles: AdminRole[];
  onSaved: () => void;
}

const labelCls = "block text-xs font-semibold uppercase tracking-wider text-muted mb-1";

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export default function UserEditModal({ isOpen, onClose, user, roles, onSaved }: Props) {
  const isCreate = user === null;
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [shift, setShift] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setUsername(user?.username ?? "");
    setDisplayName(user?.display_name ?? "");
    setPassword(user?.password ?? "");
    setRoleIds(user ? user.roles.map((r) => r.role_id) : []);
    setShift(user?.shift ?? "");
    setError(null);
    setSaving(false);
  }, [isOpen, user]);

  const toggleRole = (id: string) =>
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const uname = username.trim().toLowerCase();
    const dn = displayName.trim();
    if (isCreate && !uname) return setError("Username is required.");
    if (!dn) return setError("Display name is required.");
    if (roleIds.length === 0) return setError("Select at least one role.");
    setError(null);

    let r;
    setSaving(true);
    if (isCreate) {
      r = await adminApi("POST", "/users", {
        username: uname,
        display_name: dn,
        password: password || undefined,
        role_ids: roleIds,
        shift: shift || null,
      });
    } else {
      const patch: Record<string, unknown> = {};
      if (dn !== user.display_name) patch.display_name = dn;
      if (!sameSet(roleIds, user.roles.map((x) => x.role_id))) patch.role_ids = roleIds;
      if ((shift || null) !== user.shift) patch.shift = shift || null;
      if (password && password !== user.password) patch.password = password;
      if (Object.keys(patch).length === 0) {
        setSaving(false);
        onClose();
        return;
      }
      r = await adminApi("PATCH", `/users/${encodeURIComponent(user.id)}`, patch);
    }
    setSaving(false);
    if (!r.ok) {
      setError(r.error.startsWith("Username already exists") ? "Username already exists." : r.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isCreate ? "Add user" : `Edit ${user.display_name}`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label className={labelCls} htmlFor="ue-username">Username</label>
          {isCreate ? (
            <input
              id="ue-username"
              className={inputCls}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
            />
          ) : (
            <div id="ue-username" className="font-mono text-sm text-text">{user.username}</div>
          )}
        </div>
        <div>
          <label className={labelCls} htmlFor="ue-display">Display name</label>
          <input id="ue-display" className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="ue-password">Password</label>
          <input
            id="ue-password"
            className={`${inputCls} font-mono`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isCreate ? "Leave blank to use the username" : undefined}
            autoComplete="off"
          />
        </div>
        <fieldset>
          <legend className={labelCls}>Roles</legend>
          <div className="border border-[var(--border)] rounded max-h-64 overflow-y-auto">
            {roles.map((r) => (
              <label
                key={r.id}
                className="flex items-center gap-3 min-h-[44px] px-3 border-b border-[var(--border-light)] last:border-b-0 cursor-pointer text-sm"
              >
                <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} className="w-4 h-4" />
                <span className="text-text">{r.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className={labelCls} htmlFor="ue-shift">Shift</label>
          <select id="ue-shift" className={inputCls} value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="">None</option>
            <option value="1st">1st</option>
            <option value="2nd">2nd</option>
            <option value="3rd">3rd</option>
          </select>
        </div>

        {error && (
          <p role="alert" className="text-sm font-semibold text-[var(--danger-bg)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnSm} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={saving}>
            {saving ? "Saving…" : isCreate ? "Create user" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
