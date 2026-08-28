// Shared row field definitions for Molding blocks / Expansion batches — one definition consumed
// by both the append row and the row edit modal (ProductionBoard.tsx / EditRowModal.tsx), in
// exact paper column order. Do not duplicate this list at either call site.

export interface RowFieldDef {
  key: string;
  label: string;
  type: "text" | "number";
  placeholder?: string;
}

export const MOLDING_FIELDS: RowFieldDef[] = [
  { key: "block_no", label: "# Block", type: "text" },
  { key: "block_type", label: "Block Type", type: "text" },
  { key: "block_size", label: "Block Size", type: "text" },
  { key: "rc_pct_open", label: "RC % Open", type: "number" },
  { key: "rc_speed", label: "RC Speed", type: "number" },
  { key: "virgin_pct_open", label: "Virgin % Open", type: "number" },
  { key: "virgin_speed", label: "Virgin Speed", type: "number" },
  { key: "mold_time", label: "Time", type: "text", placeholder: "9:30 AM" },
  { key: "block_weight_lbs", label: "Block Weight (lbs)", type: "number" },
  { key: "init_oper", label: "Init. Oper", type: "text" },
];

export const EXPANSION_FIELDS: RowFieldDef[] = [
  { key: "batch_no", label: "Batch", type: "text" },
  { key: "weight_kg", label: "Weight (KG)", type: "number" },
  { key: "heating_time_s", label: "Heating Time (s)", type: "number" },
  { key: "bucket_weight_g", label: "Bucket Weight (g)", type: "number" },
];

export function fieldsFor(board: "molding" | "expansion"): RowFieldDef[] {
  return board === "molding" ? MOLDING_FIELDS : EXPANSION_FIELDS;
}

export function emptyRow(fields: RowFieldDef[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, ""]));
}

export function rowToValues(fields: RowFieldDef[], row: Record<string, any>): Record<string, string> {
  return Object.fromEntries(
    fields.map((f) => [f.key, row[f.key] === null || row[f.key] === undefined ? "" : String(row[f.key])])
  );
}
