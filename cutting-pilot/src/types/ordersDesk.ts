// src/types/ordersDesk.ts — ord-dash-01
// Response contract for GET /v2/api/orders/desk (Orders intake desk). Shared with ord-dash-02 (UI).

export type AttentionRule =
  | "schedule_gap"        // on the schedule sheet, no job
  | "no_ship_date"
  | "no_processes"
  | "blank_dims"
  | "address_unverified";

export interface AttentionItem {
  rule: AttentionRule;
  job_id: string | null;          // null for schedule_gap
  invoice_number: string | null;
  customer: string | null;
  ship_date: string | null;       // YYYY-MM-DD
  detail: string | null;          // e.g. "Lines 2, 5" for blank_dims; ship_to_verified value; schedule sheet_status
}

export interface DeskRecentRow {
  id: string;
  invoice_number: string | null;
  customer: string | null;
  ship_date: string | null;
  status: string;
  source: string | null;
  total_bdft: number | null;
  load_count: number | null;
  line_count: number;
  created_at: string;             // raw stored value
  created_et_date: string;        // YYYY-MM-DD in America/New_York
  archived: boolean;
  attention: AttentionRule[];     // this job's open rules (empty if none / out of scope)
}

export interface DeskKpis {
  entered_today: number;          // jobs whose created_et_date === today (ET), archived included
  entered_week: number;           // current ET week Mon–Sun, independent of from/to
  bdft_week: number;              // Σ total_bdft (null → 0) over entered_week jobs, rounded to whole bdft
  attention_jobs: number;         // distinct job_ids across attention[] (excl. schedule gaps)
  schedule_gaps: number;
}

export interface DeskResponse {
  ok: true;
  today: string;                  // ET YYYY-MM-DD
  range: { from: string; to: string };
  kpis: DeskKpis;
  recent: DeskRecentRow[];        // newest first by created_at
  attention: AttentionItem[];
}
