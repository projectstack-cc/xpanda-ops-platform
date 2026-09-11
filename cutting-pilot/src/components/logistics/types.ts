// src/components/logistics/types.ts
// Shared shapes for the /v2/logistics dashboard + BOL modals — kept in one place so the
// dashboard, row, actions, and modals never drift on field names.

export interface LogisticsStats {
  outboundThisWeek: number;
  pendingOutbound: number;
  inTransit: number;
  delivered30d: number;
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
