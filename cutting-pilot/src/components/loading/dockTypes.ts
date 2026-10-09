// src/components/loading/dockTypes.ts
// Row shape for the interactive dock dashboard (unit 3b) -- distinct from LoadingBoard.tsx's
// minimal wall-display shape. Mirrors the field set GET /v2/api/loading-assignments (no job_id)
// returns, which mirrors legacy's handleApiLoadingAssignments GET query exactly, including its
// column-name collision: `ship_date` ends up as the JOB's ship_date (job.ship_date is selected
// after la.ship_date in the same query, so it wins the key) while `load_ship_date` carries the
// per-LOAD value. Not a bug introduced here -- preserved 1:1 from legacy's own query shape.
export interface DockAssignment {
  id: string;
  job_id: string;
  bay_id: string | null;
  trailer_number: string | null;
  loading_status: string;
  notes: string | null;
  load_number: number | null;
  location: string | null;
  ready_checklist: string | null;
  started_at: string | null;
  loaded_at: string | null;
  in_transit_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  load_ship_date: string | null;
  customer: string | null;
  invoice_number: string | null;
  po_number: string | null;
  ship_date: string | null;
  ship_to_company: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  carrier: string | null;
  method: string | null;
  load_count: number | null;
  bay_number: number | null;
  bay_label: string | null;
  photo_count: number;
  bol_count: number;
}

export interface DockBay {
  id: string;
  bay_number: number;
  label: string;
  is_active: number;
  trailer_number: string | null;
}

// Shared action-handler contract for DockAssignmentCard -- lets both DockBoard's Overview
// rendering and TeamView.tsx (PXXX-a) pass the same handler set without redeclaring the shape
// in two places.
export interface CardActionHandlers {
  canManage: boolean;
  onAdvance: (a: DockAssignment, next: string) => void;
  onAssignBay: (a: DockAssignment) => void;
  onMoveToYard: (a: DockAssignment) => void;
  onRevertToBay: (a: DockAssignment) => void;
  onRevertYardToBay: (a: DockAssignment) => void;
  onSendBackToQueue: (a: DockAssignment) => void;
  onArchive: (a: DockAssignment) => void;
  onTrailerChange: (a: DockAssignment, value: string) => void;
  onViewBol: (a: DockAssignment) => void;
  onShowShippingInfo: (a: DockAssignment) => void;
  onShowPhotos: (a: DockAssignment) => void;
  /** dock-05: user may add photos (logistics.loading edit); gates the add flow on Loaded cards. */
  canAddPhotos: boolean;
}

export const LOADING_FLOW = ["awaiting", "not_started", "loading", "loaded", "in_transit", "delivered"];

export function nextLoadingStatus(current: string): string | null {
  const i = LOADING_FLOW.indexOf(current);
  return i >= 0 && i < LOADING_FLOW.length - 1 ? LOADING_FLOW[i + 1] : null;
}

const ADVANCE_LABELS: Record<string, string> = {
  not_started: "Assign to bay",
  loading: "Start loading",
  loaded: "Mark loaded",
  in_transit: "Mark in transit",
  delivered: "Mark delivered",
};

export function advanceLabel(nextStatus: string): string {
  return ADVANCE_LABELS[nextStatus] ?? "Advance";
}

// Current week, Monday 00:00 -> Sunday 23:59:59 local. Ported from loading.html's
// ldCurrentWeekRange/ldInCurrentWeek -- bounds the Awaiting/Delivered sections so they don't
// grow unbounded with every load ever handled.
export function inCurrentWeek(shipDate: string | null | undefined): boolean {
  if (!shipDate) return true;
  const d = new Date(shipDate);
  if (isNaN(d.getTime())) return true;
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(mon.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return d >= mon && d <= sun;
}
