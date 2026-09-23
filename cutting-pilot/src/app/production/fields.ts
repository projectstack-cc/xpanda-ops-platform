// Shared row field definitions for Molding blocks / Expansion batches — one definition consumed
// by both the append row and the row edit modal (ProductionBoard.tsx / EditRowModal.tsx), in
// exact paper column order. Do not duplicate this list at either call site.
//
// `carry` drives carry-down after append; `auto` marks a field the server computes (block_no,
// time) or that comes from the session identity (operator) rather than being a normal input;
// `editable` gates whether the row edit modal offers the field at all.

export interface OptionsData {
  block_types: string[];
  block_sizes: string[];
  suppliers: string[];
  bead_types: Record<string, string[]>;
}

export interface RowFieldDef {
  key: string;
  labelKey: string;
  input: "text" | "number" | "select";
  optionsKey?: "block_sizes";
  carry: boolean;
  auto?: "block_no" | "time" | "operator";
  editable: boolean;
  placeholder?: string;
}

export const MOLDING_FIELDS: RowFieldDef[] = [
  { key: "block_no", labelKey: "production.field.blockNo", input: "text", carry: false, auto: "block_no", editable: true },
  { key: "block_size", labelKey: "production.field.blockSize", input: "select", optionsKey: "block_sizes", carry: true, editable: true },
  { key: "silo", labelKey: "production.field.silo", input: "number", carry: true, editable: true },
  { key: "lot_no", labelKey: "production.field.lotNo", input: "text", carry: true, editable: true },
  { key: "rc_pct_open", labelKey: "production.field.rcPctOpen", input: "number", carry: true, editable: true },
  { key: "rc_speed", labelKey: "production.field.rcSpeed", input: "number", carry: true, editable: true },
  { key: "virgin_pct_open", labelKey: "production.field.virginPctOpen", input: "number", carry: true, editable: true },
  { key: "virgin_speed", labelKey: "production.field.virginSpeed", input: "number", carry: true, editable: true },
  { key: "mold_time", labelKey: "production.field.time", input: "text", carry: false, auto: "time", editable: true, placeholder: "9:30 AM" },
  { key: "block_weight_lbs", labelKey: "production.field.weightLbs", input: "number", carry: false, editable: true },
  { key: "operator_name", labelKey: "production.field.operator", input: "text", carry: false, auto: "operator", editable: false },
];

export const EXPANSION_FIELDS: RowFieldDef[] = [
  { key: "lot_no", labelKey: "production.field.lotNo", input: "text", carry: true, editable: true },
  { key: "silo", labelKey: "production.field.silo", input: "number", carry: true, editable: true },
  { key: "weight_kg", labelKey: "production.field.weightKg", input: "number", carry: false, editable: true },
  { key: "heating_time_s", labelKey: "production.field.heatingTimeS", input: "number", carry: false, editable: true },
  { key: "bucket_weight_g", labelKey: "production.field.bucketWeightG", input: "number", carry: false, editable: true },
  { key: "operator_name", labelKey: "production.field.operator", input: "text", carry: false, auto: "operator", editable: false },
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

// Rebuilds an append-row value set from a saved/loaded row: carry:true fields keep that row's
// value, everything else resets blank. `row` is null when the sheet has no rows yet.
export function carryRow(fields: RowFieldDef[], row: Record<string, any> | null): Record<string, string> {
  const base = emptyRow(fields);
  if (!row) return base;
  for (const f of fields) {
    if (!f.carry) continue;
    const v = row[f.key];
    base[f.key] = v === null || v === undefined ? "" : String(v);
  }
  return base;
}
