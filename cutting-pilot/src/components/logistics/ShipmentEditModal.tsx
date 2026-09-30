"use client";
// src/components/logistics/ShipmentEditModal.tsx
// New Shipment Edit Modal (Task 3, xpanda-ops-agents.md §9b). Built on the shared Modal
// primitive. Triggered by clicking a row in ShipmentRow.tsx / ShipmentDashboard.tsx.
//
// Field rules mirror the PUT /v2/api/shipments/:id contract in
// src/app/api/shipments/[id]/route.ts EXACTLY -- these are hard server-side rejects, not soft
// defaults:
//   - customer, carrier, ship_date, total_bdft, load_count are owned by the linked job
//     (lgx-editmodal-01). They're always editable: on a job-linked shipment the PUT WRITES THROUGH
//     to the job (source of truth) and mirrors onto the shipment in one atomic batch, exactly like a
//     Job Board edit, so the change sticks on every surface. Job-linked saves send ONLY the fields
//     that changed versus the seeded values, so an untouched field never writes to the job;
//     unlinked shipments send all of them (written to the shipment row directly).
//   - Ship To (company, attention, street, street 2, city, state, zip) lives on the job and is
//     editable only when job-linked -- seeded from GET /v2/api/shipments/:id (lgx-slip-01), changed
//     fields only.
//   - An order that already has a BOL gets an informational notice when customer / carrier / ship
//     date / ship-to change: existing BOLs are stored documents and keep the old details.
//   - Trailer # (lgx-rows-01): the single source of truth is loading_assignments.trailer_number, per
//     load. Job-linked shipments fetch GET /v2/api/shipments/:id (loads carry assignment_id +
//     trailer_number) and render one input per load; on Save, after the shipment PUT succeeds, each
//     CHANGED load is sent sequentially to PUT /v2/api/loading-assignments { id, trailer_number } (that
//     route owns the manager gate, the in-transit lock, and BOL propagation). trailer_number is never
//     sent in the shipments PUT for a job-linked shipment. Loads that have left the dock
//     (in_transit/delivered/archived) render read-only, mirroring the server lock. Unlinked shipments
//     keep the single field, which still writes shipments.trailer_number.
//     Editing is gated behind X-User-Can-Manage-Loading. The `canManageLoading` prop is
//     computed by the caller (ShipmentDashboard.tsx) the same way DockBoard.tsx already does
//     (`isAdmin || permissions["logistics.loading.manage"]?.edit`) -- reusing that existing
//     client-side pattern rather than inventing a new one. When false, trailer # renders
//     read-only and is never sent.
//   - scrap_pickup is a TEXT "YES"/"NO" enum -- rendered as a <select>, never a checkbox.
//   - load_count / total_bdft are validated client-side whenever they're sent -- never sent as
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
// Ship-to seed values, per-load trailers, and the packing-slip flag for job-linked shipments all
// come from ONE GET /v2/api/shipments/:id fetch (lgx-slip-01) -- same `logistics.dashboard` gate as
// the dashboard itself. The modal makes no request to the v2 jobs API (gated on jobs /
// logistics.loading, which a dashboard-only user may lack -> "Address unavailable."). NOT the
// already-loaded list row -- attachDistanceEta() in shipments/route.ts deletes ship_to_street from
// every list row before it goes out, so the street would always seed blank otherwise (and a blank
// seed would look like a change).
//
// Kill switch: if V2_LOGISTICS_WRITES_ENABLED is flipped back off, the PUT returns 501 -- same
// fenced-banner UX as BolGenerateModal.tsx: banner shown, modal stays open, no typed data lost.
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import Modal from "@/components/Modal";
import PackingSlipViewer from "@/components/PackingSlipViewer";
import { STATUS_VARIANTS } from "./ShipmentRow";
import type { ShipmentListItem, ShipmentDetail, ShipmentLoad } from "./types";

// Mirrors loading-assignments/route.ts's trailer lock -- the server remains the authority.
const TRAILER_LOCKED_STATUSES = ["in_transit", "delivered", "archived"];
const MANAGER_TOOLTIP = "Manager access required to edit the trailer #.";
const LOCKED_TOOLTIP = "Locked — trailer has left the dock.";

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

// lgx-editmodal-01: job-owned ship-to (job-linked shipments only). Keys are the jobs columns.
const SHIP_TO_FIELDS = [
  { key: "ship_to_company", label: "Company" },
  { key: "ship_to_attention", label: "Attention" },
  { key: "ship_to_street", label: "Street" },
  { key: "ship_to_street2", label: "Street 2" },
  { key: "ship_to_city", label: "City" },
  { key: "ship_to_state", label: "State" },
  { key: "ship_to_zip", label: "Zip" },
] as const;
type ShipToKey = (typeof SHIP_TO_FIELDS)[number]["key"];
type ShipToForm = Record<ShipToKey, string>;

function shipToFromDetail(detail: Pick<ShipmentDetail, ShipToKey>): ShipToForm {
  const out = {} as ShipToForm;
  for (const { key } of SHIP_TO_FIELDS) out[key] = detail[key] || "";
  return out;
}

export default function ShipmentEditModal({ shipment, canManageLoading, onClose }: ShipmentEditModalProps) {
  const [form, setForm] = useState<EditForm>(emptyForm());
  // Seeded values -- job-linked saves send only fields that differ from these.
  const [seed, setSeed] = useState<EditForm>(emptyForm());
  // lgx-slip-01: the single GET /v2/api/shipments/:id response (ship-to, loads, packing-slip flag).
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [shipTo, setShipTo] = useState<ShipToForm | null>(null);
  const [shipToSeed, setShipToSeed] = useState<ShipToForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fenced, setFenced] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // lgx-rows-01: per-load trailer # (job-linked only), keyed by loading_assignments.id.
  const [loads, setLoads] = useState<ShipmentLoad[] | null>(null);
  const [loadTrailers, setLoadTrailers] = useState<Record<string, string>>({});
  const [loadTrailerSeed, setLoadTrailerSeed] = useState<Record<string, string>>({});
  // True once any write has landed (e.g. shipment PUT ok but a load trailer PUT failed) so a later
  // Cancel still tells the dashboard to refetch.
  const [partialSaved, setPartialSaved] = useState(false);

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
    setPartialSaved(false);
    if (!shipment) {
      setForm(emptyForm());
      setSeed(emptyForm());
      return;
    }
    const seeded: EditForm = {
      // Seeded with the REAL current value even when it's outside EDITABLE_STATUS_VALUES
      // (board-driven "awaiting"/"scheduled") -- handleSave only sends `status` when it actually
      // differs from shipment.status, so leaving an out-of-set value untouched never round-trips
      // it through the server's stricter validator and never 400s an otherwise-unrelated save.
      status: shipment.status || "not_started",
      customer: shipment.customer || "",
      carrier: shipment.carrier || "",
      shipDate: shipment.ship_date || "",
      totalBdft: shipment.total_bdft != null && shipment.total_bdft !== "" ? String(shipment.total_bdft) : "",
      loadCount: shipment.load_count != null ? String(shipment.load_count) : "",
      trailerNumber: shipment.trailer_number || "",
      notes: shipment.notes || "",
      deliveryTime: shipment.delivery_time || "",
      scrapPickup: shipment.scrap_pickup === "YES" ? "YES" : "NO",
      deliveryIncident: !!shipment.delivery_incident,
      deliveryIncidentNotes: shipment.delivery_incident_notes || "",
    };
    setForm(seeded);
    setSeed(seeded);
  }, [shipment]);

  // lgx-slip-01: ONE detail fetch (job-linked only) seeds the Ship To panel, the per-load trailer #
  // inputs (lgx-rows-01), and the packing-slip viewer. See the file header for why the list row
  // can't be trusted for ship_to_street, and why this never calls the v2 jobs API.
  useEffect(() => {
    setDetail(null);
    setShipTo(null);
    setShipToSeed(null);
    setLoads(null);
    setLoadTrailers({});
    setLoadTrailerSeed({});
    if (!shipment?.job_id) return;
    let cancelled = false;
    setDetailLoading(true);
    fetch(`/v2/api/shipments/${encodeURIComponent(shipment.id)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.ok || !json.data) return;
        const d: ShipmentDetail = json.data;
        setDetail(d);
        const seededShipTo = shipToFromDetail(d);
        setShipTo(seededShipTo);
        setShipToSeed(seededShipTo);
        const list: ShipmentLoad[] = Array.isArray(d.loads) ? d.loads : [];
        const seeded: Record<string, string> = {};
        for (const ld of list) seeded[ld.assignment_id] = ld.trailer_number || "";
        setLoads(list);
        setLoadTrailers(seeded);
        setLoadTrailerSeed(seeded);
      })
      .catch(() => {
        // Best-effort -- Ship To shows "Address unavailable." and Trailer # shows "Trailer #
        // unavailable." if this fails.
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shipment?.id, shipment?.job_id]);

  function set<K extends keyof EditForm>(field: K, value: EditForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  // Job-linked: a job-owned field is sent only when it changed. Unlinked: always sent (as before).
  const sendOwned = (k: "customer" | "carrier" | "shipDate" | "totalBdft" | "loadCount") =>
    !jobLinked || form[k] !== seed[k];
  const bdftValid =
    !sendOwned("totalBdft") || (form.totalBdft.trim() !== "" && Number.isFinite(Number(form.totalBdft)));
  const loadCountValid =
    !sendOwned("loadCount") || (form.loadCount.trim() !== "" && Number.isFinite(parseInt(form.loadCount, 10)));
  const canSave = bdftValid && loadCountValid && !saving;

  const changedShipTo: ShipToKey[] =
    jobLinked && shipTo && shipToSeed ? SHIP_TO_FIELDS.map((f) => f.key).filter((k) => shipTo[k] !== shipToSeed[k]) : [];
  const shipDateChanged = form.shipDate !== seed.shipDate;
  const bolDetailsChanged =
    form.customer !== seed.customer || form.carrier !== seed.carrier || shipDateChanged || changedShipTo.length > 0;
  const showBolNotice = Number(shipment?.bol_count || 0) > 0 && bolDetailsChanged;

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
    // lgx-rows-01: unlinked only -- job-linked trailer # goes to loading_assignments below.
    if (canManageLoading && !jobLinked) {
      payload.trailer_number = form.trailerNumber;
    }

    // Job-owned fields: job-linked -> only what changed (writes through to the job server-side);
    // unlinked -> all of them, written to the shipment row.
    if (sendOwned("customer")) payload.customer = form.customer;
    if (sendOwned("carrier")) payload.carrier = form.carrier;
    if (sendOwned("shipDate")) payload.ship_date = form.shipDate;
    if (sendOwned("totalBdft")) payload.total_bdft = Number(form.totalBdft);
    if (sendOwned("loadCount")) payload.load_count = parseInt(form.loadCount, 10);
    if (shipTo) {
      for (const k of changedShipTo) payload[k] = shipTo[k];
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
      setPartialSaved(true);

      // lgx-rows-01: per-load trailer # -> PUT /v2/api/loading-assignments, changed loads only,
      // sequentially. A failure names the load and keeps the modal open; loads that saved are
      // re-seeded so a retry only resends what's still outstanding.
      if (jobLinked && canManageLoading && loads) {
        const errors: string[] = [];
        for (const ld of loads) {
          const next = loadTrailers[ld.assignment_id] ?? "";
          if (next === (loadTrailerSeed[ld.assignment_id] ?? "")) continue;
          const name = loads.length > 1 ? `Load ${ld.load_number ?? "?"}` : "Trailer #";
          try {
            const r = await fetch("/v2/api/loading-assignments", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: ld.assignment_id, trailer_number: next }),
            });
            const d = await r.json().catch(() => null);
            if (!r.ok || !d?.ok) {
              errors.push(`${name}: ${d?.detail || d?.error || `HTTP ${r.status}`}`);
              continue;
            }
            setLoadTrailerSeed((prev) => ({ ...prev, [ld.assignment_id]: next }));
          } catch {
            errors.push(`${name}: network error`);
          }
        }
        if (errors.length) {
          setSaveError(`Shipment saved, but the trailer # didn't save — ${errors.join("; ")}`);
          return;
        }
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
    <Modal isOpen={isOpen} onClose={() => onClose(partialSaved)} title="Edit Shipment" size="lg">
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
              Editing is temporarily disabled. Use the legacy Logistics dashboard for now.
            </div>
          )}

          {saveError && (
            <div className="rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-sm px-4 py-3 font-medium">
              {saveError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer">
              <input
                type="text"
                className={inputClass}
                value={form.customer}
                onChange={(e) => set("customer", e.target.value)}
              />
            </Field>
            <Field label="Carrier">
              <input
                type="text"
                className={inputClass}
                value={form.carrier}
                onChange={(e) => set("carrier", e.target.value)}
              />
            </Field>
            <Field label="Ship Date">
              <input
                type="date"
                className={inputClass}
                value={form.shipDate}
                onChange={(e) => set("shipDate", e.target.value)}
              />
              {jobLinked && shipDateChanged && (
                <p className="text-xs text-muted">Also moves the order on the production schedule.</p>
              )}
            </Field>
            <Field label="Total BDFT">
              <input
                type="number"
                className={inputClass}
                value={form.totalBdft}
                onChange={(e) => set("totalBdft", e.target.value)}
              />
            </Field>
            <Field label="Load Count">
              <input
                type="number"
                className={inputClass}
                value={form.loadCount}
                onChange={(e) => set("loadCount", e.target.value)}
              />
            </Field>
            {!jobLinked && (
              <Field label="Trailer #">
                {canManageLoading ? (
                  <input
                    type="text"
                    className={inputClass}
                    value={form.trailerNumber}
                    onChange={(e) => set("trailerNumber", e.target.value)}
                  />
                ) : (
                  <div className={readOnlyClass} title={MANAGER_TOOLTIP}>
                    {form.trailerNumber || "—"}
                  </div>
                )}
              </Field>
            )}
            {jobLinked && (detailLoading || !loads || loads.length === 0) && (
              <Field label="Trailer #">
                <div className={readOnlyClass}>
                  {detailLoading ? "Loading…" : loads ? "No loads yet." : "Trailer # unavailable."}
                </div>
              </Field>
            )}
            {jobLinked &&
              !detailLoading &&
              loads?.map((ld) => {
                const locked = TRAILER_LOCKED_STATUSES.includes(ld.loading_status);
                const value = loadTrailers[ld.assignment_id] ?? "";
                const label = loads.length > 1 ? `Load ${ld.load_number ?? "?"} trailer #` : "Trailer #";
                return (
                  <Field key={ld.assignment_id} label={label}>
                    {canManageLoading && !locked ? (
                      <input
                        type="text"
                        className={inputClass}
                        value={value}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLoadTrailers((prev) => ({ ...prev, [ld.assignment_id]: v }));
                        }}
                      />
                    ) : (
                      <div className={readOnlyClass} title={locked ? LOCKED_TOOLTIP : MANAGER_TOOLTIP}>
                        {value || "—"}
                      </div>
                    )}
                  </Field>
                );
              })}
          </div>

          {jobLinked && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--ghost-bg)] p-3 space-y-2">
              <div className="text-xs font-semibold text-muted uppercase tracking-wider">Ship To</div>
              {detailLoading && <div className="text-xs text-muted">Loading address…</div>}
              {!detailLoading && detail && shipTo && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SHIP_TO_FIELDS.map(({ key, label }) => (
                    <Field key={key} label={label}>
                      <input
                        type="text"
                        className={inputClass}
                        value={shipTo[key]}
                        disabled={detailLoading}
                        onChange={(e) => {
                          const v = e.target.value;
                          setShipTo((prev) => (prev ? { ...prev, [key]: v } : prev));
                        }}
                      />
                    </Field>
                  ))}
                </div>
              )}
              {!detailLoading && !detail && <div className="text-xs text-muted">Address unavailable.</div>}
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

          {shipment?.job_id && (
            <PackingSlipViewer
              key={shipment.id}
              src={detail?.has_packing_slip ? `/v2/api/shipments/${encodeURIComponent(shipment.id)}/packing-slip` : null}
              filename={detail?.packing_slip_filename || `packing-slip-${shipment.job_id}.pdf`}
            />
          )}

          {showBolNotice && (
            <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
              This order already has a BOL. Existing BOLs keep the old details — regenerate the BOL to update it.
            </div>
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
                onClick={() => onClose(partialSaved)}
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
