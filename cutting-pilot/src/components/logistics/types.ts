// src/components/logistics/types.ts
// Shared shapes for the /v2/logistics dashboard + BOL modals — kept in one place so the
// dashboard, row, actions, and modals never drift on field names.

export interface LogisticsStats {
  outboundThisWeek: number;
  pendingOutbound: number;
  inTransit: number;
  delivered30d: number;
  /** lgx-widgets-01: trailers — load_count per order, linked (trailer_group_id) orders collapsed. */
  outboundThisWeekLoads: number;
  pendingOutboundLoads: number;
  inTransitLoads: number;
  delivered30dLoads: number;
}

export interface ShipmentListItem {
  id: string;
  job_id: string | null;
  customer: string | null;
  invoice_number: string | null;
  method: string | null;
  carrier: string | null;
  trailer_number: string | null;
  load_count: number | null;
  total_bdft: number | string | null;
  bol_number: string | null;
  bol_count: number;
  /** lgx-signed-01: any signed artifact (QR-signed PDF, carrier upload, or delivery photo) on any of the job's BOLs. */
  has_signed_bol?: number | boolean;
  status: string;
  ship_date: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  // Widened for the Shipment Edit Modal (Task 3) -- always present on the wire (`shipments.*`
  // is selected in full by GET /v2/api/shipments), just not previously typed.
  notes: string | null;
  delivery_time: string | null;
  scrap_pickup: string | null;
  delivery_incident: number | null;
  delivery_incident_notes: string | null;
  // Distance/ETA from the fixed facility origin, cache-only from GET /v2/api/shipments --
  // "pending" means no cache row yet (warmed client-side, list view only, see
  // ShipmentDashboard.tsx); "unavailable" means no job/ship-to address to resolve.
  miles_from_origin: number | null;
  duration_sec: number | null;
  distance_status: "ok" | "pending" | "unavailable";
  // carrier-03: always on the wire via `shipments.*`, now typed for the delivered timestamp.
  delivered_at: string | null;
  // carrier-04: carrier-entered fees across all of the job's loads (list route subqueries).
  carrier_charges_total_cents: number;
  carrier_charges_count: number;
  /** lgx-rows-01: trailer #s from loading_assignments (non-archived, load order), comma-joined; null when none. */
  trailer_numbers?: string | null;
  /** lgx-rows-01: the linked job's method is 'customer pickup' (set on the Orders form). */
  is_customer_pickup?: number | boolean;
}

// Response shape of GET /v2/api/shipments/:id -- backs ShipmentDetailPanel's inline row
// drill-down (shipping address + carrier + shipping time + loads + parts) on the
// /v2/logistics dashboard. Distinct from ShipmentListItem (the list row) because the list
// query never selects the full ship-to address or job_line_items -- both are fetched lazily,
// only when a row is expanded.
export interface ShipmentDetail {
  id: string;
  job_id: string | null;
  carrier: string | null;
  delivery_time: string | null;
  load_count: number | null;
  ship_to_company: string | null;
  ship_to_attention: string | null;
  ship_to_street: string | null;
  ship_to_street2: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  line_items: JobLineItem[];
  // carrier-03: one per non-archived loading_assignments row for the job.
  loads: ShipmentLoad[];
  /** lgx-minimap-01: destination pin for the drill-down minimap (geocode_cache); null when the address can't be geocoded. */
  dest?: { lat: number; lng: number; address: string } | null;
}

export interface ShipmentLoad {
  /** lgx-rows-01: loading_assignments.id -- the PUT /v2/api/loading-assignments key for trailer # edits. */
  assignment_id: string;
  /** lgx-rows-01: trailer # (single source of truth: loading_assignments). */
  trailer_number: string | null;
  load_number: number | null;
  loading_status: string;
  delivered_at: string | null;
  /** signed_bol_additional_info of the newest BOL for this load (driver QR sign flow). */
  qr_additional_info: string | null;
  // carrier-04
  carrier_charges: CarrierChargeEntry[];
  carrier_charges_total_cents: number;
}

export interface CarrierChargeEntry {
  fee_amount_cents: number;
  notes: string;
  created_by_name: string | null;
  created_at: string;
}

export interface JobLineItem {
  part_number: string | null;
  description: string | null;
  quantity: number | string | null;
  // Pre-formatted dimensions string, already on `job_line_items` and already returned by
  // GET /v2/api/jobs/:id's SELECT * -- was just missing from this narrower TS type. Writer
  // trims empty to "" rather than null, so check truthiness, not `!== null`.
  dimensions?: string | null;
}

export interface JobForBol {
  id: string;
  customer: string | null;
  invoice_number: string | null;
  po_number: string | null;
  ship_date: string | null;
  load_count: number | null;
  carrier: string | null;
  delivery_time: string | null;
  scrap_pickup: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  location: string | null;
  ship_to_company: string | null;
  ship_to_attention: string | null;
  ship_to_street: string | null;
  ship_to_street2: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  line_items: JobLineItem[];
}

export interface LoadingAssignmentForJob {
  id: string;
  job_id: string;
  load_number: number | null;
  trailer_number: string | null;
  load_ship_date: string | null;
}
