// src/types/schedule.ts
// Mirrors the GET /v2/api/schedule-board response contract exactly (built in 3/5 —
// src/app/api/schedule-board/route.ts + src/lib/schedule-status.ts). Keep in sync: a field
// change on either side must change both. Flag it here if you find drift.

export type ScheduleStatus = "Shipped" | "Loaded" | "Loading" | "Ready" | "Cutting" | "Not Started";

export interface ScheduleBoardRow {
  invoice_number: string;
  customer: string | null;
  load_count: number | null;
  method: string | null;
  location: string | null;
  delivery_time: string | null;
  carrier: string | null;
  total_bdft: number | null;
  scrap_pickup: string | null;
  status: ScheduleStatus | null;
  unmatched: boolean;
  sheet_status: string | null;
  job_id: string | null;
  trailer_group_id: string | null;
}

export interface ScheduleDayGroup {
  ship_week: string | null;
  day_of_week: string;
  ship_date: string | null;
  rows: ScheduleBoardRow[];
}

export interface ScheduleBoardResponse {
  generated_at: string;
  weeks: string[];
  days: ScheduleDayGroup[];
}
