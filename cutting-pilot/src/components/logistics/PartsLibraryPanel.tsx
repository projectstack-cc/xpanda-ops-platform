"use client";
// src/components/logistics/PartsLibraryPanel.tsx
// lb-ui-10 Part B (react-component-agent §9b). Design read: a planner managing the shared parts
// catalog from inside Load Builder -- dense, list-first, desktop tool chrome (same register as
// BolGenerateModal.tsx, not a floor-tablet surface). Full CRUD against /api/parts
// (handleApiParts, _worker.js/routes/production.js) -- Step 0 confirmed GET/POST/PUT/DELETE all
// exist there. This writes to LIVE, UNFENCED production data (no V2_LOGISTICS_WRITES_ENABLED gate
// applies to /api/parts -- see the sprint charter's "one sprint-wide exception"), so every
// destructive or overwriting action is behind an explicit confirmation step, and this component's
// own dev-time verification never calls anything but GET (see CHANGELOG / lb-ui-10).
//
// Edit form only exposes part_number/customer/density_material/length_in/width_in/height_in/notes/
// bundle_qty: handleApiParts's PUT (lines 68-115) never writes name/color/allow_rotation/sort_order/
// category/parent_group to the row no matter what's sent -- those are POST-only (create-time) on
// this endpoint. Showing controls for fields PUT silently drops would be a broken control, so they
// render read-only in edit mode instead (BACKLOG follow-up: broader PUT support).
//
// Cache note: this panel owns its own fetch/list state, refetched after every write, so its own
// view is always correct. It does NOT invalidate PartsPicker.tsx's or partMatch.ts's separate
// module-level /api/parts caches (Orders flow) -- both are outside this prompt's file fence. Load
// Builder's own job-pull matching (JobPullModal.tsx's fetchLoadBuilderSkus) has no cache of its own
// and always re-fetches, so it is unaffected. See CHANGELOG for the exact stale-read sequence this
// leaves on the Orders side.
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronRight } from "lucide-react";
import Modal from "@/components/Modal";
import {
  validatePartCreate,
  validatePartUpdate,
  nextSortOrder,
  buildCreatePayload,
  buildUpdatePayload,
  partToCreateForm,
  partToUpdateForm,
  emptyCreateForm,
  groupByCategory,
  type PartRecord,
  type PartCreateForm,
  type PartUpdateForm,
} from "@/lib/partsLibrary";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const inputClass =
  "w-full min-h-[36px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-muted">{label}</label>
      {children}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs font-semibold text-muted">{label}</span>
      <p className="min-h-[36px] flex items-center px-2.5 py-1.5 rounded-md border border-dashed border-[var(--border)] text-sm text-muted">
        {value || "—"}
      </p>
    </div>
  );
}

export default function PartsLibraryPanel({ isOpen, onClose }: Props) {
  const [parts, setParts] = useState<PartRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<PartCreateForm>(emptyCreateForm());
  const [createErrors, setCreateErrors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PartUpdateForm | null>(null);
  const [editErrors, setEditErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function refetch() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/parts");
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error || "Failed to load parts.");
      setParts((body.parts as PartRecord[]) || []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load parts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    setStatusMessage(null);
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? parts.filter(
        (p) =>
          (p.part_number || "").toLowerCase().includes(q) ||
          (p.name || "").toLowerCase().includes(q) ||
          (p.customer || "").toLowerCase().includes(q)
      )
    : parts;
  const { groups, keys } = groupByCategory(filtered);

  function startCreate() {
    setShowCreate(true);
    setCreateForm(emptyCreateForm());
    setCreateErrors([]);
  }

  async function submitCreate() {
    const validation = validatePartCreate(createForm);
    if (!validation.ok) {
      setCreateErrors(validation.errors);
      return;
    }
    setCreating(true);
    setCreateErrors([]);
    try {
      const payload = buildCreatePayload(createForm, nextSortOrder(parts));
      const res = await fetch("/api/parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setCreateErrors([data.error || `HTTP ${res.status}`]);
        return;
      }
      setShowCreate(false);
      setStatusMessage(`Created ${payload.part_number}.`);
      await refetch();
    } catch {
      setCreateErrors(["Network error."]);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(p: PartRecord) {
    setEditingId(p.id);
    setEditForm(partToUpdateForm(p));
    setEditErrors([]);
    setConfirmDeleteId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
    setEditErrors([]);
  }

  async function submitEdit() {
    if (!editForm) return;
    const validation = validatePartUpdate(editForm);
    if (!validation.ok) {
      setEditErrors(validation.errors);
      return;
    }
    setSaving(true);
    setEditErrors([]);
    try {
      const payload = buildUpdatePayload(editForm);
      const res = await fetch("/api/parts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setEditErrors([data.error || `HTTP ${res.status}`]);
        return;
      }
      setStatusMessage(`Updated ${payload.part_number}.`);
      cancelEdit();
      await refetch();
    } catch {
      setEditErrors(["Network error."]);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(id: string, partNumber: string) {
    setDeleting(true);
    try {
      const res = await fetch("/api/parts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatusMessage(`Failed to delete ${partNumber}: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      setStatusMessage(`Deleted ${partNumber}.`);
      setConfirmDeleteId(null);
      await refetch();
    } catch {
      setStatusMessage(`Failed to delete ${partNumber}: network error.`);
    } finally {
      setDeleting(false);
    }
  }

  function toggleCategory(cat: string) {
    setCollapsed((c) => ({ ...c, [cat]: !c[cat] }));
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Parts library" size="xl">
      <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-xs px-3 py-2">
        This edits the live parts catalog shared with Orders and job matching — changes are
        immediate and there is no undo. Delete requires a second confirmation click.
      </div>

      {statusMessage && (
        <div className="rounded-md bg-[color-mix(in_srgb,var(--success-bg)_12%,transparent)] text-[var(--success-bg)] text-sm px-3 py-2 font-medium">
          {statusMessage}
        </div>
      )}
      {loadError && <p className="text-sm text-[var(--danger-text)] px-1">{loadError}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by part #, name, or customer…"
          className={`${inputClass} flex-1 min-w-[200px]`}
        />
        <button
          type="button"
          onClick={() => (showCreate ? setShowCreate(false) : startCreate())}
          className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer transition-colors border border-[var(--brand)] text-[var(--brand)] hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] inline-flex items-center gap-1.5"
        >
          {showCreate ? <X size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          {showCreate ? "Cancel" : "New part"}
        </button>
      </div>

      {showCreate && (
        <div className="rounded-md border-2 border-[var(--brand)] p-3 space-y-3">
          <p className="text-sm font-semibold text-text">New part</p>
          {createErrors.length > 0 && (
            <div className="rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs px-3 py-2 space-y-0.5">
              {createErrors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Part number *">
              <input className={inputClass} value={createForm.part_number} onChange={(e) => setCreateForm((f) => ({ ...f, part_number: e.target.value }))} />
            </Field>
            <Field label="Name">
              <input className={inputClass} value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Customer">
              <input className={inputClass} value={createForm.customer} onChange={(e) => setCreateForm((f) => ({ ...f, customer: e.target.value }))} />
            </Field>
            <Field label="Density / material">
              <input className={inputClass} value={createForm.density_material} onChange={(e) => setCreateForm((f) => ({ ...f, density_material: e.target.value }))} />
            </Field>
            <Field label="Category">
              <input className={inputClass} value={createForm.category} onChange={(e) => setCreateForm((f) => ({ ...f, category: e.target.value }))} />
            </Field>
            <Field label="Parent group">
              <input className={inputClass} value={createForm.parent_group} onChange={(e) => setCreateForm((f) => ({ ...f, parent_group: e.target.value }))} />
            </Field>
            <Field label="Length (in) *">
              <input type="number" step="any" className={`${inputClass} font-mono tabular-nums`} value={createForm.length_in} onChange={(e) => setCreateForm((f) => ({ ...f, length_in: e.target.value }))} />
            </Field>
            <Field label="Width (in) *">
              <input type="number" step="any" className={`${inputClass} font-mono tabular-nums`} value={createForm.width_in} onChange={(e) => setCreateForm((f) => ({ ...f, width_in: e.target.value }))} />
            </Field>
            <Field label="Height (in) *">
              <input type="number" step="any" className={`${inputClass} font-mono tabular-nums`} value={createForm.height_in} onChange={(e) => setCreateForm((f) => ({ ...f, height_in: e.target.value }))} />
            </Field>
            <Field label="Weight">
              <input type="number" step="any" className={`${inputClass} font-mono tabular-nums`} value={createForm.weight} onChange={(e) => setCreateForm((f) => ({ ...f, weight: e.target.value }))} />
            </Field>
            <Field label="Bundle qty">
              <input type="number" step="1" min="0" className={`${inputClass} font-mono tabular-nums`} value={createForm.bundle_qty} onChange={(e) => setCreateForm((f) => ({ ...f, bundle_qty: e.target.value }))} />
            </Field>
            <Field label="Color">
              <input type="color" className="w-full h-9 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] cursor-pointer" value={createForm.color} onChange={(e) => setCreateForm((f) => ({ ...f, color: e.target.value }))} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className={`${inputClass} min-h-[60px] resize-y`} value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
            <input type="checkbox" checked={createForm.allow_rotation} onChange={(e) => setCreateForm((f) => ({ ...f, allow_rotation: e.target.checked }))} />
            Allow rotation
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitCreate}
              disabled={creating}
              className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer bg-[var(--brand)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? "Creating…" : "Create part"}
            </button>
          </div>
        </div>
      )}

      <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
        {loading && <p className="text-sm text-muted px-2 py-3">Loading…</p>}
        {!loading && !loadError && filtered.length === 0 && <p className="text-sm text-muted px-2 py-3">No parts found.</p>}
        <div className="space-y-3">
          {keys.map((cat) => {
            const catParts = groups[cat];
            const isCollapsed = !!collapsed[cat];
            return (
              <div key={cat}>
                <button
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className="w-full flex items-center gap-1.5 text-xs font-bold text-muted uppercase tracking-wide py-1 cursor-pointer"
                >
                  {isCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                  {cat} ({catParts.length})
                </button>
                {!isCollapsed && (
                  <div className="space-y-2">
                    {catParts.map((p) => {
                      const isEditing = editingId === p.id;
                      const isConfirmingDelete = confirmDeleteId === p.id;
                      return (
                        <div key={p.id} className="rounded-md border border-[var(--card-border)] px-3 py-2 space-y-2">
                          {!isEditing && (
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className="w-3 h-3 rounded-full shrink-0" style={{ background: p.color || "#D97706" }} aria-hidden="true" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-text truncate">{p.part_number || "—"}{p.name && p.name !== p.part_number ? ` — ${p.name}` : ""}</div>
                                <div className="text-xs text-muted font-mono tabular-nums truncate">
                                  {[p.customer, p.density_material, `${p.length_in}×${p.width_in}×${p.height_in}"`].filter(Boolean).join(" · ")}
                                </div>
                              </div>
                              {!isConfirmingDelete && (
                                <div className="flex gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => startEdit(p)}
                                    className="p-1.5 rounded-md text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer"
                                    aria-label={`Edit ${p.part_number}`}
                                  >
                                    <Pencil size={14} aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(p.id)}
                                    className="p-1.5 rounded-md text-[var(--danger-text)] hover:bg-[color-mix(in_srgb,var(--danger-bg)_10%,transparent)] cursor-pointer"
                                    aria-label={`Delete ${p.part_number}`}
                                  >
                                    <Trash2 size={14} aria-hidden="true" />
                                  </button>
                                </div>
                              )}
                              {isConfirmingDelete && (
                                <div className="w-full flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-semibold text-[var(--danger-text)]">
                                    Remove {p.part_number} from the shared catalog (Orders + job matching), permanently?
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => confirmDelete(p.id, p.part_number)}
                                    disabled={deleting}
                                    className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--danger-bg)] text-white cursor-pointer disabled:opacity-50"
                                  >
                                    {deleting ? "Deleting…" : "Confirm delete"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="px-2.5 py-1 rounded-md text-xs font-semibold border border-[var(--border)] text-muted cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {isEditing && editForm && (
                            <div className="space-y-2">
                              {editErrors.length > 0 && (
                                <div className="rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs px-3 py-2 space-y-0.5">
                                  {editErrors.map((e, i) => (
                                    <p key={i}>{e}</p>
                                  ))}
                                </div>
                              )}
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                <Field label="Part number *">
                                  <input className={inputClass} value={editForm.part_number} onChange={(e) => setEditForm((f) => (f ? { ...f, part_number: e.target.value } : f))} />
                                </Field>
                                <Field label="Customer">
                                  <input className={inputClass} value={editForm.customer} onChange={(e) => setEditForm((f) => (f ? { ...f, customer: e.target.value } : f))} />
                                </Field>
                                <Field label="Density / material">
                                  <input className={inputClass} value={editForm.density_material} onChange={(e) => setEditForm((f) => (f ? { ...f, density_material: e.target.value } : f))} />
                                </Field>
                                <Field label="Length (in) *">
                                  <input type="number" step="any" className={`${inputClass} font-mono tabular-nums`} value={editForm.length_in} onChange={(e) => setEditForm((f) => (f ? { ...f, length_in: e.target.value } : f))} />
                                </Field>
                                <Field label="Width (in) *">
                                  <input type="number" step="any" className={`${inputClass} font-mono tabular-nums`} value={editForm.width_in} onChange={(e) => setEditForm((f) => (f ? { ...f, width_in: e.target.value } : f))} />
                                </Field>
                                <Field label="Height (in) *">
                                  <input type="number" step="any" className={`${inputClass} font-mono tabular-nums`} value={editForm.height_in} onChange={(e) => setEditForm((f) => (f ? { ...f, height_in: e.target.value } : f))} />
                                </Field>
                                <Field label="Bundle qty">
                                  <input type="number" step="1" min="0" className={`${inputClass} font-mono tabular-nums`} value={editForm.bundle_qty} onChange={(e) => setEditForm((f) => (f ? { ...f, bundle_qty: e.target.value } : f))} />
                                </Field>
                                <ReadOnlyField label="Name (set at creation — PUT doesn't update this)" value={p.name} />
                                <ReadOnlyField label="Category (set at creation — PUT doesn't update this)" value={p.category} />
                              </div>
                              <Field label="Notes">
                                <textarea className={`${inputClass} min-h-[50px] resize-y`} value={editForm.notes} onChange={(e) => setEditForm((f) => (f ? { ...f, notes: e.target.value } : f))} />
                              </Field>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={submitEdit}
                                  disabled={saving}
                                  className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer bg-[var(--brand)] text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
                                >
                                  <Check size={14} aria-hidden="true" /> {saving ? "Saving…" : "Save changes"}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEdit}
                                  className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer border border-[var(--border)] text-muted"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
