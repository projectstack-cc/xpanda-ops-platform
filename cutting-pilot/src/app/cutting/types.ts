export interface CuttingLine {
  line: string;
  line_status: "not_started" | "in_progress" | "complete";
  sort_order: number;
  open_session_id: string | null;
  open_operator_name: string | null;
  last_handoff_note: string;
  tracked_seconds: number;
  open_started_at: string | null;
}

export interface CuttingLineItem {
  part_number: string;
  description: string;
  quantity: number | null;
  dimensions: string;
}

export interface CuttingJob {
  id: string;
  customer: string;
  invoice_number: string;
  po_number: string | null;
  ship_date: string | null;
  status: string;
  priority: string;
  requiredLines: string[];
  lines: CuttingLine[];
  line_items: CuttingLineItem[];
}
