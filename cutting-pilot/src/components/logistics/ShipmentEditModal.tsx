"use client";
// src/components/logistics/ShipmentEditModal.tsx
// New Shipment Edit Modal (Task 3, xpanda-ops-agents.md §9b). Built on the shared Modal
// primitive. Triggered by clicking a row in ShipmentRow.tsx / ShipmentDashboard.tsx.
//
// Field rules mirror the PUT /v2/api/shipments/:id contract in
// src/app/api/shipments/[id]/route.ts EXACTLY -- these are hard server-side rejects, not soft
// defaults:
//   - customer, carrier, method, ship_date, total_bdft, load_count are one-way synced from the
//     linked job in legacy -- editable ONLY when shipment.job_id is null. When job-linked they
//     render as plain read-only text and are OMITTED from the PUT payload entirely (their mere
//     presence on a job-linked shipment 400s the whole request).
//   - trailer_number is gated behind X-User-Can-Manage-Loading. The `canManageLoading` prop is
//     computed by the caller (ShipmentDashboard.tsx) the same way DockBoard.tsx already does
//     (`isAdmin || permissions["logistics.loading.manage"]?.edit`) -- reusing that existing
//     client-side pattern rather than inventing a new one. When false, trailer # renders
//     read-only and is omitted from the payload.
//   - method is a behavior-bearing enum ("" | "customer pickup") -- rendered as a <select>,
//     never free text.
//   - scrap_pickup is a TEXT "YES"/"NO" enum -- rendered as a <select>, never a checkbox.
//   - load_count / total_bdft are validated client-side before Save is enabled -- never sent as
//     "" or whitespace.
//   - notes, delivery_time, scrap_pickup, delivery_incident, delivery_incident_notes are never
//     job-synced and stay editable regardless of job_id.
//   - delivery_time is deliberately free text (see src/lib/deliveryTime.ts's own doc comment) --
//     never reformatted here.
//   - status is ALWAYS editable (flows shipment -> job, never job -> shipment) but restricted to
//     the 8-value set legacy's own manual edit form offers -- rendered as a <select> using
//     ShipmentRow.tsx's own STATUS_VARIANTS labels, not hand-written copy. A change cascades
//     server-side onto jobs/loading_assignments/cutting_lines; this modal has no special-case UI
//     for that, it just surfaces whatever the PUT returns (success, or the LOCKED_STATUSES 409)
//     through the existing generic error banner.
//
// Delete is a two-step arm/confirm inline control (PartsLibraryPanel.tsx's own pattern) -- not
// window.confirm(), same constraint as every other destructive action in this codebase. Gated by
// the same canEditDashboard() as Save server-side; no client-side permission gate on the button.
//
// Ship-to address display for job-linked shipments comes from a dedicated GET /v2/api/jobs/:id
// fetch, NOT the already-loaded list row -- attachDistanceEta() in shipments/route.ts deletes
// ship_to_street from every list row before it goes out, so the street would always show blank
// otherwise.
//
// Save is FENCED (PUT returns 501 while V2_LOGISTICS_WRITES_ENABLED is false) -- same
// fenced-banner UX as BolGenerateModal.tsx: banner shown, modal stays open, no typed data lost.
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import Modal from "@/components/Modal";
import { STATUS_VARIANTS } from "./ShipmentRow";
import type { ShipmentListItem, JobForBol } from "./types";

// The exact 8-option set the server (shipments/[id]/route.ts) accepts -- deliberately excludes
// "awaiting"/"scheduled" (board-driven-only in legacy, never hand-set from this form).
const EDITABLE_STATUS_VALUES = [
  "not_started",
  "in_production",
  "ready_to_ship",
  "loading",
  "loaded",
  "in_transit",
  "delivered",
  "cancelled",
] as const;

interface ShipmentEditModalProps {
  shipment: ShipmentListItem | null;
  canManageLoading: boolean;
  /** Called on close. `saved=true` only when the PUT actually succeeded (never happens while
   * the fence is on) so the dashboard knows to refetch. */
  onClose: (saved: boolean) => void;
}

const inputClass =
  "w-full min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
const readOnlyClass = "min-h-[44px] flex items-center text-sm text-text px-3 py-2 rounded-md bg-[var(--ghost-bg)] border border-[var(--border)]";

interface EditForm {
  status: string;
  customer: string;
  carrier: string;
  method: string;
  shipDate: string;
  totalBdft: string;
  loadCount: string;
  trailerNumber: string;
  notes: string;
  deliveryTime: string;
  scrapPickup: "YES" | "NO";
  deliveryIncident: boolean;
  deliveryIncidentNotes: string;
}

function emptyForm(): EditForm {
  return {
    status: "not_started",
    customer: "",
    carrier: "",
    method: "",
    shipDate: "",
    totalBdft: "",
    loadCount: "",
    trailerNumber: "",
    notes: "",
    deliveryTime: "",
    scrapPickup: "NO",
    deliveryIncident: false,
    deliveryIncidentNotes: "",
  };
}

function fmtNum(n: number | string | null): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!v && v !== 0) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export default function ShipmentEditModal({ shipment, canManageLoading, onClose }: ShipmentEditModalProps) {
  const [form, setForm] = useState<EditForm>(emptyForm());
  const [job, setJob] = useState<JobForBol | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fenced, setFenced] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isOpen = !!shipment;
  const jobLinked = !!shipment?.job_id;

  // Seed the form whenever a different shipment is opened.
  useEffect(() => {
    setSaveError(null);
    setFenced(false);
    setSaving(false);
    setDeleteArmed(false);
    setDeleting(false);
    setDeleteError(null);
    if (!shipment) {
      setForm(emptyForm());
      setJob(null);
      return;
    }
    setForm({
      // Seeded with the REAL current value even when it's outside EDITABLE_STATUS_VALUES
      // (board-driven "awaiting"/"scheduled") -- handleSave only sends `status` when it actually
      // differs from shipment.status, so leaving an out-of-set value untouched never round-trips
      // it through the server's stricter validator and never 400s an otherwise-unrelated save.
      status: shipment.status || "not_started",
      customer: shipment.customer || "",
      carrier: shipment.carrier || "",
      method: shipment.method === "customer pickup" ? "customer pickup" : "",
      shipDate: shipment.ship_date || "",
      totalBdft: shipment.total_bdft != null && shipment.total_bdft !== "" ? String(shipment.total_bdft) : "",
      loadCount: shipment.load_count != null ? String(shipment.load_count) : "",
      trailerNumber: shipment.trailer_number || "",
      notes: shipment.notes || "",
      deliveryTime: shipment.delivery_time || "",
      scrapPickup: shipment.scrap_pickup === "YES" ? "YES" : "NO",
      deliveryIncident: !!shipment.delivery_incident,
      deliveryIncidentNotes: shipment.delivery_incident_notes || "",
    });
  }, [shipment]);

  // Job-linked ship-to display -- dedicated fetch, see file header for why the list row can't
  // be trusted for ship_to_street.
  useEffect(() => {
    setJob(null);
    if (!shipment?.job_id) return;
    let cancelled = false;
    setJobLoading(true);
    fetch(`/v2/api/jobs/${encodeURIComponent(shipment.job_id)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.ok && json.job) setJob(json.job);
      })
      .catch(() => {
        // Best-effort -- the address block just stays blank if this fails.
      })
      .finally(() => {
        if (!cancelled) setJobLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shipment?.job_id]);

  function set<K extends keyof EditForm>(field: K, value: EditForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const bdftValid = jobLinked || (form.totalBdft.trim() !== "" && Number.isFinite(Number(form.totalBdft)));
  const loadCountValid =
    jobLinked || (form.loadCount.trim() !== "" && Number.isFinite(parseInt(form.loadCount, 10)));
  const canSave = bdftValid && loadCountValid && !saving;

  async function handleSave() {
    if (!shipment) return;
    setSaveError(null);
    setFenced(false);

    if (!bdftValid) {
      setSaveError("Total BDFT must be a number.");
      return;
    }
    if (!loadCountValid) {
      setSaveError("Load count must be a whole number.");
      return;
    }

    const payload: Record<string, unknown> = {
      notes: form.notes,
      delivery_time: form.deliveryTime,
      scrap_pickup: form.scrapPickup,
      delivery_incident: form.deliveryIncident,
      delivery_incident_notes: form.deliveryIncidentNotes,
    };

    // Only sent when actually changed -- see the seed effect's comment on why an untouched
    // out-of-set value (board-driven "awaiting"/"scheduled") must never round-trip unchanged.
    if (form.status !== shipment.status) {
      payload.status = form.status;
    }

    // trailer_number omitted entirely unless the user can manage loading -- its mere presence
    // in the payload is checked server-side too, but never send it if the control was read-only.
    if (canManageLoading) {
      payload.trailer_number = form.trailerNumber;
    }

    // Job-gated fields omitted entirely when job-linked -- their mere presence 400s the whole
    // request server-side.
    if (!jobLinked) {
      payload.customer = form.customer;
      payload.carrier = form.carrier;
      payload.method = form.method;
      payload.ship_date = form.shipDate;
      payload.total_bdft = Number(form.totalBdft);
      payload.load_count = parseInt(form.loadCount, 10);
    }

    setSaving(true);
    try {
      const res = await fetch(`/v2/api/shipments/${encodeURIComponent(shipment.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 501) {
        setFenced(true);
        return;
      }
      if (!res.ok || !data.ok) {
        setSaveError(data.detail || data.error || `HTTP ${res.status}`);
        return;
      }

      onClose(true);
    } catch {
      setSaveError("Network error — could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!shipment) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/v2/api/shipments/${encodeURIComponent(shipment.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (res.status === 501) {
        setFenced(true);
        return;
      }
      if (!res.ok || !data.ok) {
        setDeleteError(data.detail || data.error || `HTTP ${res.status}`);
        return;
      }

      onClose(true);
    } catch {
      setDeleteError("Network error — could not delete.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={() => onClose(false)} title="Edit Shipment" size="lg">
      {shipment && (
        <div className="space-y-4">
          <Field label="Status">
            <select
              className={inputClass}
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {!(EDITABLE_STATUS_VALUES as readonly string[]).includes(form.status) && (
                <option value={form.status}>{STATUS_VARIANTS[form.status]?.label ?? form.status}</option>
              )}
              {EDITABLE_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_VARIANTS[s]?.label ?? s}
                </option>
              ))}
            </select>
          </Field>

          {fenced && (
            <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
              Editing and deleting are disabled in the v2 preview phase. Use the legacy Logistics dashboard for this shipment for now.
            </div>
          )}

          {saveError && (
            <div className="rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-sm px-4 py-3 font-medium">
              {saveError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer">
              {jobLinked ? (
                <div className={readOnlyClass}>{form.customer || "—"}</div>
              ) : (
                <input
                  type="text"
                  className={inputClass}
                  value={form.customer}
                  onChange={(e) => set("customer", e.target.value)}
                />
              )}
            </Field>
            <Field label="Carrier">
              {jobLinked ? (
                <div className={readOnlyClass}>{form.carrier || "—"}</div>
              ) : (
                <input
                  type="text"
                  className={inputClass}
                  value={form.carrier}
                  onChange={(e) => set("carrier", e.target.value)}
                />
              )}
            </Field>
            <Field label="Method">
              {jobLinked ? (
                <div className={readOnlyClass}>{shipment.method || "—"}</div>
              ) : (
                <select
                  className={inputClass}
                  value={form.method}
                  onChange={(e) => set("method", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="customer pickup">Customer pickup</option>
                </select>
              )}
            </Field>
            <Field label="Ship Date">
              {jobLinked ? (
                <div className={readOnlyClass}>{form.shipDate || "—"}</div>
              ) : (
                <input
                  type="date"
                  className={inputClass}
                  value={form.shipDate}
                  onChange={(e) => set("shipDate", e.target.value)}
                />
              )}
            </Field>
            <Field label="Total BDFT">
              {jobLinked ? (
                <div className={readOnlyClass}>{fmtNum(shipment.total_bdft)}</div>
              ) : (
                <input
                  type="number"
                  className={inputClass}
                  value={form.totalBdft}
                  onChange={(e) => set("totalBdft", e.target.value)}
                />
              )}
            </Field>
            <Field label="Load Count">
              {jobLinked ? (
                <div className={readOnlyClass}>{shipment.load_count ?? "—"}</div>
              ) : (
                <input
                  type="number"
                  className={inputClass}
                  value={form.loadCount}
                  onChange={(e) => set("loadCount", e.target.value)}
                />
              )}
            </Field>
            <Field label="Trailer #">
              {canManageLoading ? (
                <input
                  type="text"
                  className={inputClass}
                  value={form.trailerNumber}
                  onChange={(e) => set("trailerNumber", e.target.value)}
                />
              ) : (
                <div className={readOnlyClass} title="Manager access required to edit the trailer #.">
                  {form.trailerNumber || "—"}
                </div>
              )}
            </Field>
          </div>

          {jobLinked && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--ghost-bg)] p-3 space-y-0.5">
              <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Ship To</div>
              {jobLoading && <div className="text-xs text-muted">Loading address…</div>}
              {!jobLoading && job && (
                <div className="text-sm text-text space-y-0.5">
                  {job.ship_to_company && <div>{job.ship_to_company}</div>}
                  {job.ship_to_attention && <div>{job.ship_to_attention}</div>}
                  {job.ship_to_street && <div>{job.ship_to_street}</div>}
                  {job.ship_to_street2 && <div>{job.ship_to_street2}</div>}
                  {(job.ship_to_city || job.ship_to_state || job.ship_to_zip) && (
                    <div>{[job.ship_to_city, job.ship_to_state, job.ship_to_zip].filter(Boolean).join(", ")}</div>
                  )}
                </div>
              )}
              {!jobLoading && !job && <div className="text-xs text-muted">Address unavailable.</div>}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Delivery Time">
              <input
                type="text"
                className={inputClass}
                value={form.deliveryTime}
                onChange={(e) => set("deliveryTime", e.target.value)}
                placeholder="Free text — e.g. Delivery @ 10:00 am"
              />
            </Field>
            <Field label="Scrap Pickup">
              <select
                className={inputClass}
                value={form.scrapPickup}
                onChange={(e) => set("scrapPickup", e.target.value === "YES" ? "YES" : "NO")}
              >
                <option value="NO">No</option>
                <option value="YES">Yes</option>
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              className={`${inputClass} min-h-[70px] resize-y`}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={form.deliveryIncident}
              onChange={(e) => set("deliveryIncident", e.target.checked)}
            />
            Delivery incident
          </label>

          {form.deliveryIncident && (
            <Field label="Delivery Incident Notes">
              <textarea
                className={`${inputClass} min-h-[70px] resize-y`}
                value={form.deliveryIncidentNotes}
                onChange={(e) => set("deliveryIncidentNotes", e.target.value)}
              />
            </Field>
          )}

          {deleteError && (
            <div className="rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-sm px-4 py-3 font-medium">
              {deleteError}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--line)]">
            {deleteArmed ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-[var(--danger-text)]">
                  Delete this shipment permanently?
                </span>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[var(--danger-bg)] text-white cursor-pointer disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Confirm delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteArmed(false)}
                  disabled={deleting}
                  className="px-2.5 py-1.5 rounded-md text-xs font-semibold border border-[var(--border)] text-text cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setDeleteArmed(true)}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-md text-sm font-semibold text-[var(--danger-text)] hover:bg-[color-mix(in_srgb,var(--danger-bg)_10%,transparent)] cursor-pointer"
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete shipment
              </button>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onClose(false)}
                className="min-h-[44px] px-4 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold text-text cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSave}
                onClick={handleSave}
                className="min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold disabled:opacity-50 cursor-pointer hover:opacity-90"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-muted">{label}</label>
      {children}
    </div>
  );
}
