"use client";
// src/components/board/OrderEditModal.tsx
// P439 — full in-place edit modal opened from the Edit button on each /v2/board row. Mirrors
// what the legacy jobs/index.html "Edit Job" modal edits (customer, PO, INV, ship-to, ship_date,
// status, priority, notes, cutting/packing instructions, line items), adds the Job Shifts
// chip section (manager-only add/remove), the assignment chip section (manager-only writes via
// the legacy /api/jobs/:id/assignments endpoints), and reuses the cut-list + packing-slip
// dropdown viewers from OrderDetailModal. Save posts to PUT /v2/api/orders/:id; shifts use
// the new /v2/api/orders/:id/shifts endpoints (manager-gated server-side from
// X-User-Is-Admin + X-User-Permissions, the new header injected by middleware).
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";
import { buildCutListPdf, type CutListJob, type CutListLineItem } from "@/lib/cutList";
import PartsPicker from "@/components/orders/PartsPicker";
import type { OrderLineItem } from "@/components/orders/OrderEntryForm";

interface EditJob {
  id: string;
  customer: string | null;
  po_number: string | null;
  invoice_number: string | null;
  status: string;
  priority: string | null;
  priority_level: number | null;
  ship_date: string | null;
  ship_day: string | null;
  location: string | null;
  delivery_time: string | null;
  method: string | null;
  carrier: string | null;
  load_count: number | null;
  total_bdft: number | null;
  notes: string | null;
  cutting_instructions: string | null;
  packing_instructions: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  ship_to_company: string | null;
  ship_to_attention: string | null;
  ship_to_street: string | null;
  ship_to_street2: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  source: string | null;
  processes: any;
  has_packing_slip: boolean;
}

interface StoredLineItem {
  id?: string;
  part_id: string | null;
  part_number: string | null;
  description: string | null;
  quantity: number | string | null;
  dimensions: string | null;
  density: string | null;
}

interface BoardResponse {
  ok: boolean;
  error?: string;
  job?: EditJob;
  line_items?: StoredLineItem[];
  shifts?: string[];
}

interface Assignee {
  user_id: string;
  name: string;
}
interface AssignableUser {
  id: string;
  name: string;
  username: string;
}

interface OrderEditModalProps {
  jobId: string | null;
  onClose: () => void;
  onSaved: () => void;
  // Read-only user context for manager gating of the Shifts + Assignees chip sections. The
  // server enforces these too, but mirroring them client-side avoids showing controls that
  // will 403 on click.
  isAdmin?: boolean;
  permissions?: Record<string, { view?: boolean; edit?: boolean }>;
}

const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_production", label: "In production" },
  { value: "done", label: "Done" },
  { value: "loading", label: "Loading" },
  { value: "shipped", label: "Shipped" },
];
const PRIORITY_LEVEL_OPTIONS = [
  { value: 0, label: "Normal" },
  { value: 1, label: "Elevated" },
  { value: 2, label: "High" },
  { value: 3, label: "Critical" },
];
const SHIFT_LABELS: Record<string, string> = { "1st": "1st Shift", "2nd": "2nd Shift", "3rd": "3rd Shift" };

const inputClass =
  "w-full min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
const labelClass = "block text-xs font-semibold text-muted mb-1";

const EMPTY_LINE: OrderLineItem = { part_number: "", description: "", quantity: "", dimensions: "", density: "" };

// Module-level cache for /api/assignable-users (lazy, once per session — same trick
// ProductionBoard.tsx:100 uses for BoardRowEdit).
let assignableUsersCache: AssignableUser[] | null = null;

export default function OrderEditModal({ jobId, onClose, onSaved, isAdmin = false, permissions = {} }: OrderEditModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [job, setJob] = useState<EditJob | null>(null);
  const [lineItems, setLineItems] = useState<OrderLineItem[]>([{ ...EMPTY_LINE }]);
  const [shifts, setShifts] = useState<string[]>([]);
  const [addingShift, setAddingShift] = useState("");

  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [addingUserId, setAddingUserId] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);

  const [partsPickerOpen, setPartsPickerOpen] = useState(false);

  // Packing-slip + cut-list dropdown viewers (lifted from OrderDetailModal.tsx).
  const [slipOpen, setSlipOpen] = useState(false);
  const [cutListOpen, setCutListOpen] = useState(false);
  const [cutListLoading, setCutListLoading] = useState(false);
  const [cutListDoc, setCutListDoc] = useState<{ src: string; filename: string } | null>(null);
  const [cutListError, setCutListError] = useState<string | null>(null);
  const cutListBlobUrlRef = useRef<string | null>(null);

  const [originalSnapshot, setOriginalSnapshot] = useState<string>("");

  const statusLocked = job?.status === "loading" || job?.status === "shipped";
  const canManageShifts = isAdmin || !!permissions["jobs.manage"]?.edit;
  const canManageAssignees = isAdmin || !!permissions["jobs.manage"]?.edit;

  useEffect(() => {
    if (cutListBlobUrlRef.current) {
      try { URL.revokeObjectURL(cutListBlobUrlRef.current); } catch {}
      cutListBlobUrlRef.current = null;
    }
    setCutListError(null);
    setCutListDoc(null);
    setCutListOpen(false);
    setSlipOpen(false);

    if (!jobId) {
      setJob(null);
      setLineItems([{ ...EMPTY_LINE }]);
      setShifts([]);
      setAssignees([]);
      setAddingUserId("");
      setAddingShift("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setJob(null);
    setLineItems([{ ...EMPTY_LINE }]);
    setShifts([]);
    setAssignees([]);
    setSaveError(null);
    setAssignError(null);

    (async () => {
      try {
        const [boardRes, shiftsRes] = await Promise.all([
          fetch(`/v2/api/board/${jobId}`),
          fetch(`/v2/api/orders/${jobId}/shifts`),
        ]);
        const boardJson: BoardResponse = await boardRes.json();
        const shiftsJson = await shiftsRes.json();
        if (cancelled) return;
        if (!boardRes.ok || !boardJson.ok || !boardJson.job) {
          setLoadError(boardJson.error || "Couldn't load this order.");
          return;
        }
        const j = boardJson.job;
        setJob(j);
        const lis: OrderLineItem[] = (boardJson.line_items ?? []).map((li) => ({
          part_id: li.part_id ?? undefined,
          part_number: li.part_number ?? "",
          description: li.description ?? "",
          quantity: li.quantity == null ? "" : String(li.quantity),
          dimensions: li.dimensions ?? "",
          density: li.density ?? "",
        }));
        setLineItems(lis.length ? lis : [{ ...EMPTY_LINE }]);
        setShifts(Array.isArray(shiftsJson.shifts) ? shiftsJson.shifts : []);
        const snapshot = JSON.stringify({ ...j, line_items: lis });
        setOriginalSnapshot(snapshot);
      } catch {
        if (!cancelled) setLoadError("Network error — couldn't reach the server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    if (!assignableUsersCache) {
      fetch("/api/assignable-users")
        .then((r) => r.json())
        .then((data) => {
          if (data?.ok) {
            const users = (data.users as AssignableUser[]) || [];
            assignableUsersCache = users;
            if (!cancelled) setAssignableUsers(users);
          }
        })
        .catch(() => {
          // Non-fatal — the panel still allows removing existing assignees without this list.
        });
    } else if (!cancelled) {
      setAssignableUsers(assignableUsersCache);
    }

    (async () => {
      try {
        const ar = await fetch(`/api/jobs/${jobId}/assignments`);
        const aj = await ar.json();
        if (!cancelled && ar.ok && aj?.ok) setAssignees(aj.assignees || []);
      } catch { /* non-fatal */ }
    })();

    return () => {
      cancelled = true;
      if (cutListBlobUrlRef.current) {
        try { URL.revokeObjectURL(cutListBlobUrlRef.current); } catch {}
        cutListBlobUrlRef.current = null;
      }
    };
  }, [jobId]);

  function updateLine(idx: number, patch: Partial<OrderLineItem>) {
    setLineItems((prev) => prev.map((li, i) => (i === idx ? { ...li, ...patch } : li)));
  }
  function addLine() {
    setLineItems((prev) => [...prev, { ...EMPTY_LINE }]);
  }
  function addPartLine(line: OrderLineItem) {
    setLineItems((prev) => {
      const onlyEmpty = prev.length === 1 && !prev[0].part_number && !prev[0].description && !prev[0].dimensions;
      return onlyEmpty ? [line] : [...prev, line];
    });
  }
  function removeLine(idx: number) {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  function buildCurrentSnapshot(): string {
    if (!job) return "";
    const cur: any = {
      ...job,
      line_items: lineItems.map((li) => ({
        part_id: li.part_id || null,
        part_number: li.part_number,
        description: li.description,
        quantity: li.quantity,
        dimensions: li.dimensions,
        density: li.density,
      })),
    };
    return JSON.stringify(cur);
  }
  function isDirty(): boolean {
    if (!originalSnapshot) return false;
    return originalSnapshot !== buildCurrentSnapshot();
  }

  async function handleSave() {
    if (!job) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: any = {
        customer: job.customer ?? "",
        po_number: job.po_number ?? "",
        invoice_number: job.invoice_number ?? "",
        ship_date: job.ship_date ?? "",
        ship_day: job.ship_day ?? "",
        location: job.location ?? "",
        delivery_time: job.delivery_time ?? "",
        carrier: job.carrier ?? "",
        load_count: Number.isFinite(Number(job.load_count)) ? Number(job.load_count) : 1,
        total_bdft: Number.isFinite(Number(job.total_bdft)) ? Number(job.total_bdft) : 0,
        notes: job.notes ?? "",
        cutting_instructions: job.cutting_instructions ?? "",
        packing_instructions: job.packing_instructions ?? "",
        contact_name: job.contact_name ?? "",
        contact_phone: job.contact_phone ?? "",
        ship_to_company: job.ship_to_company ?? "",
        ship_to_attention: job.ship_to_attention ?? "",
        ship_to_street: job.ship_to_street ?? "",
        ship_to_street2: job.ship_to_street2 ?? "",
        ship_to_city: job.ship_to_city ?? "",
        ship_to_state: job.ship_to_state ?? "",
        ship_to_zip: job.ship_to_zip ?? "",
        status: job.status,
        priority: job.priority ?? "normal",
        priority_level: Number.isFinite(Number(job.priority_level)) ? Number(job.priority_level) : 0,
        source: job.source ?? "manual",
        line_items: lineItems.map((li) => ({
          part_id: li.part_id || undefined,
          part_number: (li.part_number || "").trim(),
          description: (li.description || "").trim(),
          quantity: Number.isFinite(Number(li.quantity)) ? Number(li.quantity) : 0,
          dimensions: (li.dimensions || "").trim(),
          density: li.density || "",
        })),
      };
      const res = await fetch(`/v2/api/orders/${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSaveError(data.error || "Couldn't save. Try again.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setSaveError("Network error — couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    onClose();
  }

  async function handleToggleCutList() {
    if (!job) return;
    const opening = !cutListOpen;
    setCutListOpen(opening);
    if (!opening || cutListDoc) return;
    setCutListLoading(true);
    setCutListError(null);
    try {
      const clJob: CutListJob = {
        id: job.id,
        invoice_number: job.invoice_number,
        ship_date: job.ship_date,
        customer: job.customer,
        ship_to_company: job.ship_to_company,
        ship_to_attention: job.ship_to_attention,
        ship_to_street: job.ship_to_street,
        ship_to_street2: job.ship_to_street2,
        ship_to_city: job.ship_to_city,
        ship_to_state: job.ship_to_state,
        ship_to_zip: job.ship_to_zip,
        carrier: job.carrier,
        line_items: lineItems.map<CutListLineItem>((li) => ({
          part_number: li.part_number,
          description: li.description,
          quantity: li.quantity,
          dimensions: li.dimensions,
          density: li.density,
        })),
      };
      const pdfBytes = await buildCutListPdf(clJob);
      const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      if (cutListBlobUrlRef.current) {
        try { URL.revokeObjectURL(cutListBlobUrlRef.current); } catch {}
      }
      const url = URL.createObjectURL(blob);
      cutListBlobUrlRef.current = url;
      setCutListDoc({ src: url, filename: `cut-list-${job.invoice_number || job.id}.pdf` });
    } catch {
      setCutListError("Couldn't generate the cut list. Please try again.");
    } finally {
      setCutListLoading(false);
    }
  }

  async function handleAddShift(shift: string) {
    if (!jobId || !shift) return;
    try {
      const res = await fetch(`/v2/api/orders/${jobId}/shifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift }),
      });
      const data = await res.json();
      if (res.status === 403) {
        setSaveError(data.error || "Manager access required to assign shifts.");
        return;
      }
      if (!res.ok || !data.ok) {
        setSaveError(data.error || "Couldn't add shift. Try again.");
        return;
      }
      const r = await fetch(`/v2/api/orders/${jobId}/shifts`);
      const j = await r.json();
      if (r.ok && j?.ok) setShifts(Array.isArray(j.shifts) ? j.shifts : []);
    } catch {
      setSaveError("Network error — couldn't reach the server.");
    }
  }
  async function handleRemoveShift(shift: string) {
    if (!jobId) return;
    try {
      const res = await fetch(`/v2/api/orders/${jobId}/shifts/${encodeURIComponent(shift)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.status === 403) {
        setSaveError(data.error || "Manager access required to assign shifts.");
        return;
      }
      if (!res.ok || !data.ok) {
        setSaveError(data.error || "Couldn't remove shift. Try again.");
        return;
      }
      setShifts((prev) => prev.filter((s) => s !== shift));
    } catch {
      setSaveError("Network error — couldn't reach the server.");
    }
  }

  async function handleAddAssignee() {
    if (!jobId || !addingUserId) return;
    setAssignError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: addingUserId }),
      });
      const data = await res.json();
      if (res.status === 403) {
        setAssignError("Manager access required to assign.");
        return;
      }
      if (!res.ok || !data.ok) {
        setAssignError(data.error || "Couldn't assign. Try again.");
        return;
      }
      setAddingUserId("");
      const added = assignableUsers.find((u) => u.id === addingUserId);
      if (added) setAssignees((prev) => [...prev, { user_id: added.id, name: added.name }]);
    } catch {
      setAssignError("Network error — couldn't reach the server.");
    }
  }
  async function handleRemoveAssignee(userId: string) {
    if (!jobId) return;
    setAssignError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/assignments/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (res.status === 403) {
        setAssignError("Manager access required to assign.");
        return;
      }
      if (!res.ok || !data.ok) {
        setAssignError(data.error || "Couldn't remove. Try again.");
        return;
      }
      setAssignees((prev) => prev.filter((a) => a.user_id !== userId));
    } catch {
      setAssignError("Network error — couldn't reach the server.");
    }
  }

  const availableToAdd = assignableUsers.filter((u) => !assignees.some((a) => a.user_id === u.id));
  const slipDoc = job?.has_packing_slip
    ? { src: `/api/jobs/${job.id}/packing-slip`, filename: `packing-slip-${job.id}.pdf` }
    : null;

  return (
    <Modal isOpen={!!jobId} onClose={handleClose} title={job ? job.customer || "Edit order" : "Edit order"} size="xl">
      {loading && <p className="text-sm text-muted py-4">Loading order…</p>}

      {!loading && loadError && (
        <p className="text-sm text-[var(--warn-text)] py-4">{loadError}</p>
      )}

      {!loading && job && (
        <div className="space-y-4 max-h-[75vh] overflow-y-auto -mx-2 px-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{job.invoice_number ? `INV# ${job.invoice_number}` : "No INV#"}</span>
            {job.ship_to_city && (
              <span>
                {job.ship_to_city}
                {job.ship_to_state ? `, ${job.ship_to_state}` : ""}
              </span>
            )}
            {job.ship_date && <span>Ship {job.ship_date}</span>}
          </div>

          {saveError && (
            <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-3 py-2">
              {saveError}
            </div>
          )}

          {isDirty() && !saving && (
            <div className="rounded-md border border-[var(--brand)] bg-[var(--info-bg)] text-[var(--info-text)] text-sm px-3 py-2 flex items-center justify-between gap-3">
              <span>You have unsaved changes.</span>
              <button
                type="button"
                onClick={handleSave}
                className="min-h-[36px] px-3 rounded-md bg-[var(--brand)] text-white text-xs font-semibold cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                Save changes
              </button>
            </div>
          )}

          {/* Header — customer / PO / INV (3-col grid) */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">Customer & order</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className={labelClass}>Customer</span>
                <input
                  type="text"
                  value={job.customer ?? ""}
                  onChange={(e) => setJob({ ...job, customer: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>PO number</span>
                <input
                  type="text"
                  value={job.po_number ?? ""}
                  onChange={(e) => setJob({ ...job, po_number: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Invoice number</span>
                <input
                  type="text"
                  value={job.invoice_number ?? ""}
                  onChange={(e) => setJob({ ...job, invoice_number: e.target.value })}
                  className={inputClass}
                />
              </label>
            </div>
          </section>

          {/* Ship-to */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">Ship-to</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className={labelClass}>Company</span>
                <input
                  type="text"
                  value={job.ship_to_company ?? ""}
                  onChange={(e) => setJob({ ...job, ship_to_company: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Attention</span>
                <input
                  type="text"
                  value={job.ship_to_attention ?? ""}
                  onChange={(e) => setJob({ ...job, ship_to_attention: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className={labelClass}>Street</span>
                <input
                  type="text"
                  value={job.ship_to_street ?? ""}
                  onChange={(e) => setJob({ ...job, ship_to_street: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className={labelClass}>Street 2</span>
                <input
                  type="text"
                  value={job.ship_to_street2 ?? ""}
                  onChange={(e) => setJob({ ...job, ship_to_street2: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>City</span>
                <input
                  type="text"
                  value={job.ship_to_city ?? ""}
                  onChange={(e) => setJob({ ...job, ship_to_city: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>State</span>
                <input
                  type="text"
                  value={job.ship_to_state ?? ""}
                  onChange={(e) => setJob({ ...job, ship_to_state: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>ZIP</span>
                <input
                  type="text"
                  value={job.ship_to_zip ?? ""}
                  onChange={(e) => setJob({ ...job, ship_to_zip: e.target.value })}
                  className={inputClass}
                />
              </label>
            </div>
            <p className="text-[11px] text-muted">Changing any ship-to field clears the verified badge (set to &quot;unverified&quot; on save).</p>
          </section>

          {/* Ship date + Status + Priority + Priority level */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">Schedule</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <label className="block">
                <span className={labelClass}>Ship date</span>
                <input
                  type="date"
                  value={job.ship_date ?? ""}
                  onChange={(e) => setJob({ ...job, ship_date: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Status</span>
                <select
                  value={job.status}
                  onChange={(e) => setJob({ ...job, status: e.target.value })}
                  disabled={statusLocked}
                  title={statusLocked ? "Loading/shipped jobs can't be changed from the board." : undefined}
                  className={`${inputClass} ${statusLocked ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Priority</span>
                <select
                  value={job.priority ?? "normal"}
                  onChange={(e) => setJob({ ...job, priority: e.target.value })}
                  className={inputClass}
                >
                  <option value="normal">Normal</option>
                  <option value="rush">Rush</option>
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Priority level</span>
                <select
                  value={job.priority_level ?? 0}
                  onChange={(e) => setJob({ ...job, priority_level: Number(e.target.value) })}
                  className={inputClass}
                >
                  {PRIORITY_LEVEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {/* Carrier / Location / Load count / Total BDFT */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">Shipping details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <label className="block">
                <span className={labelClass}>Carrier</span>
                <input
                  type="text"
                  value={job.carrier ?? ""}
                  onChange={(e) => setJob({ ...job, carrier: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Location</span>
                <input
                  type="text"
                  value={job.location ?? ""}
                  onChange={(e) => setJob({ ...job, location: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Load count</span>
                <input
                  type="number"
                  min={1}
                  value={job.load_count ?? 1}
                  onChange={(e) => setJob({ ...job, load_count: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Total BDFT</span>
                <input
                  type="number"
                  min={0}
                  value={job.total_bdft ?? 0}
                  onChange={(e) => setJob({ ...job, total_bdft: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
            </div>
          </section>

          {/* Notes */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">Notes</h2>
            <textarea
              value={job.notes ?? ""}
              onChange={(e) => setJob({ ...job, notes: e.target.value })}
              rows={2}
              className={inputClass}
            />
          </section>

          {/* Cutting / Packing instructions */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">Instructions</h2>
            <label className="block">
              <span className={labelClass}>Cutting instructions</span>
              <textarea
                value={job.cutting_instructions ?? ""}
                onChange={(e) => setJob({ ...job, cutting_instructions: e.target.value })}
                rows={3}
                placeholder="Cutting-floor instructions — routing, taper notes, batch sizes…"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Packing instructions</span>
              <textarea
                value={job.packing_instructions ?? ""}
                onChange={(e) => setJob({ ...job, packing_instructions: e.target.value })}
                rows={3}
                placeholder="Floor operator instructions — labeling, load on risers, QC requirements, unloading notes…"
                className={inputClass}
              />
            </label>
          </section>

          {/* Line items — full editor (reuse EMPTY_LINE / addLine / removeLine / updateLine from OrderEntryForm) */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">Line items</h2>
            <div className="space-y-3">
              {lineItems.map((li, idx) => (
                <div key={idx} className="rounded-lg border border-[var(--card-border)] p-3 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="block">
                      <span className={labelClass}>Part number</span>
                      <input
                        type="text"
                        value={li.part_number}
                        onChange={(e) => updateLine(idx, { part_number: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className={labelClass}>Description</span>
                      <input
                        type="text"
                        value={li.description}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                    <label className="block">
                      <span className={labelClass}>Quantity</span>
                      <input
                        type="number"
                        min={0}
                        value={li.quantity}
                        onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className={labelClass}>Dimensions</span>
                      <input
                        type="text"
                        value={li.dimensions}
                        onChange={(e) => updateLine(idx, { dimensions: e.target.value })}
                        placeholder='e.g. 76 x 38 x 12'
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className={labelClass}>Density</span>
                      <input
                        type="text"
                        value={li.density}
                        onChange={(e) => updateLine(idx, { density: e.target.value })}
                        placeholder="1.0 RC"
                        className={inputClass}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      disabled={lineItems.length <= 1}
                      aria-label="Remove line"
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md border border-[var(--input-border)] text-muted hover:text-text hover:bg-[var(--ghost-bg)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={addLine}
                className="min-h-[44px] px-4 inline-flex items-center gap-2 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
              >
                <Plus size={16} aria-hidden="true" />
                Add line
              </button>
              <button
                type="button"
                onClick={() => setPartsPickerOpen(true)}
                className="min-h-[44px] px-4 inline-flex items-center gap-2 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
              >
                From parts library
              </button>
            </div>
          </section>

          {/* Job Shifts (manager-gated) */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">Job shifts</h2>
            <div className="flex flex-wrap items-center gap-2">
              {shifts.length === 0 && <span className="text-xs text-muted">No shifts assigned</span>}
              {shifts.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-[var(--info-bg)] text-xs font-medium text-[var(--info-text)] border border-[var(--info-border)]"
                >
                  {SHIFT_LABELS[s] || s}
                  {canManageShifts && (
                    <button
                      type="button"
                      onClick={() => handleRemoveShift(s)}
                      aria-label={`Remove ${s} shift`}
                      className="min-w-[20px] min-h-[20px] inline-flex items-center justify-center rounded-full hover:bg-[var(--card-border)] cursor-pointer text-[var(--info-text)] hover:text-text"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {canManageShifts && (
                <span className="inline-flex items-center gap-1">
                  <select
                    value={addingShift}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAddingShift("");
                      if (v) handleAddShift(v);
                    }}
                    className="min-h-[32px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-xs px-2"
                  >
                    <option value="">Add shift…</option>
                    {["1st", "2nd", "3rd"].filter((s) => !shifts.includes(s)).map((s) => (
                      <option key={s} value={s}>{SHIFT_LABELS[s]}</option>
                    ))}
                  </select>
                </span>
              )}
            </div>
            {!canManageShifts && (
              <p className="text-xs text-muted">Only managers can assign shifts.</p>
            )}
          </section>

          {/* Assignees */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text">Assigned</h2>
            {assignError && <p className="text-xs text-[var(--warn-text)]">{assignError}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {assignees.length === 0 && <span className="text-xs text-muted">Unassigned</span>}
              {assignees.map((a) => (
                <span
                  key={a.user_id}
                  className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-[var(--ghost-bg)] text-xs font-medium text-text"
                >
                  {a.name}
                  {canManageAssignees && (
                    <button
                      type="button"
                      onClick={() => handleRemoveAssignee(a.user_id)}
                      aria-label={`Remove ${a.name}`}
                      className="min-w-[20px] min-h-[20px] inline-flex items-center justify-center rounded-full hover:bg-[var(--card-border)] cursor-pointer text-muted hover:text-text"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {canManageAssignees && availableToAdd.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <select
                    value={addingUserId}
                    onChange={(e) => setAddingUserId(e.target.value)}
                    className="min-h-[32px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-xs px-2"
                  >
                    <option value="">+ Add…</option>
                    {availableToAdd.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddAssignee}
                    disabled={!addingUserId}
                    className="min-h-[32px] px-2 rounded-md border border-[var(--input-border)] text-text text-xs font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </span>
              )}
            </div>
          </section>

          {/* Cut List dropdown viewer (lifted from OrderDetailModal) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleToggleCutList}
              disabled={cutListLoading}
              className="flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              aria-expanded={cutListOpen}
            >
              {cutListOpen ? <ChevronDown size={16} className="shrink-0" aria-hidden="true" /> : <ChevronRight size={16} className="shrink-0" aria-hidden="true" />}
              {cutListLoading ? "Generating Cut List…" : "Cut List"}
            </button>
            {cutListOpen && cutListDoc && (
              <PdfViewer src={cutListDoc.src} filename={cutListDoc.filename} title="Cut list" />
            )}
            {cutListError && <p className="text-sm text-[var(--warn-text)]">{cutListError}</p>}
          </div>

          {/* Packing Slip dropdown viewer (lifted from OrderDetailModal) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setSlipOpen((v) => !v)}
              disabled={!slipDoc}
              className="flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              aria-expanded={slipOpen}
            >
              {slipOpen ? <ChevronDown size={16} className="shrink-0" aria-hidden="true" /> : <ChevronRight size={16} className="shrink-0" aria-hidden="true" />}
              Packing Slip
            </button>
            {!slipDoc && <p className="text-sm text-muted">No packing slip attached.</p>}
            {slipOpen && slipDoc && (
              <PdfViewer src={slipDoc.src} filename={slipDoc.filename} title="Packing slip" />
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <PartsPicker
        isOpen={partsPickerOpen}
        onClose={() => setPartsPickerOpen(false)}
        onPick={addPartLine}
      />
    </Modal>
  );
}
