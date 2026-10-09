// src/lib/partsLibrary.ts
// lb-ui-10 Part A. Pure validation over /api/parts's own field/shape rules (_worker.js/routes/
// production.js, handleApiParts), so PartsLibraryPanel.tsx can reject bad input client-side before
// round-tripping to the server. Deliberately mirrors handleApiParts's checks line-for-line rather
// than inventing stricter or looser rules -- client and server must agree, or a client-accepted
// submission could still 400 at the server, or vice versa.
//
// Endpoint choice (Step 0 finding, see CHANGELOG): legacy's own SKU-tab CRUD (load-builder.html:
// 1629-1807) does NOT call this endpoint -- it calls /api/load-builder-skus
// (handleApiLoadBuilderSkus, _worker.js/routes/bols.js), a camelCase-shaped wrapper over the SAME
// `parts` D1 table. This prompt is scoped to /api/parts (handleApiParts) per its own locked
// instruction ("this is the ONLY backend this prompt talks to"), which already supports full CRUD
// with the fields below -- so /api/load-builder-skus's translation layer is never used here.

export interface PartRecord {
  id: string;
  part_number: string;
  name: string;
  customer: string;
  density_material: string;
  length_in: number;
  width_in: number;
  height_in: number;
  weight: number;
  notes: string;
  color: string;
  allow_rotation: number;
  sort_order: number;
  category: string;
  parent_group: string;
  bundle_qty: number;
  created_at?: string;
  updated_at?: string;
}

/** Fields POST persists (handleApiParts, lines 23-37). */
export interface PartCreateForm {
  part_number: string;
  name: string;
  customer: string;
  density_material: string;
  length_in: string;
  width_in: string;
  height_in: string;
  weight: string;
  notes: string;
  color: string;
  allow_rotation: boolean;
  category: string;
  parent_group: string;
  bundle_qty: string;
}

/**
 * Edit form for PUT /api/parts (buildPartUpdate, quickwin-01): the core 7 (part_number, customer,
 * density_material, length_in, width_in, height_in, notes) are always written; each optional column
 * (name, weight, color, allow_rotation, sort_order, category, parent_group, bundle_qty) is written
 * only when its key is present. admin-06 widened the form to the optional fields the edit UI exposes.
 */
export interface PartUpdateForm {
  id: string;
  part_number: string;
  customer: string;
  density_material: string;
  length_in: string;
  width_in: string;
  height_in: string;
  notes: string;
  bundle_qty: string;
  name: string;
  category: string;
  parent_group: string;
  weight: string;
  color: string;
  allow_rotation: boolean;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function checkDims(length_in: string, width_in: string, height_in: string): string[] {
  const errors: string[] = [];
  const l = Number(length_in);
  const w = Number(width_in);
  const h = Number(height_in);
  if (!Number.isFinite(l) || l <= 0) errors.push("Length must be greater than 0.");
  if (!Number.isFinite(w) || w <= 0) errors.push("Width must be greater than 0.");
  if (!Number.isFinite(h) || h <= 0) errors.push("Height must be greater than 0.");
  return errors;
}

export function validatePartCreate(form: PartCreateForm): ValidationResult {
  const errors: string[] = [];
  if (!form.part_number.trim()) errors.push("Part number is required.");
  errors.push(...checkDims(form.length_in, form.width_in, form.height_in));
  return { ok: errors.length === 0, errors };
}

export function validatePartUpdate(form: PartUpdateForm): ValidationResult {
  const errors: string[] = [];
  if (!form.id.trim()) errors.push("id is required.");
  if (!form.part_number.trim()) errors.push("Part number is required.");
  errors.push(...checkDims(form.length_in, form.width_in, form.height_in));
  if (form.weight.trim()) {
    const w = Number(form.weight);
    if (!Number.isFinite(w) || w < 0) errors.push("Weight must be a number ≥ 0.");
  }
  return { ok: errors.length === 0, errors };
}

/**
 * handleApiParts's POST defaults sort_order to 0 when the payload omits it -- every new part would
 * otherwise land at the top of its category (GET's own ORDER BY category ASC, sort_order ASC,
 * part_number ASC), unlike /api/load-builder-skus's POST, which appends via COUNT(*). This computes
 * an explicit append value from the currently loaded list so new parts sort after existing ones,
 * matching the append behavior a planner would expect -- purely a list-order nicety (sort_order
 * doesn't feed pack()/matching, both confirmed to key off height_in/name, not this field).
 */
export function nextSortOrder(existing: PartRecord[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing.map((p) => p.sort_order || 0)) + 1;
}

export function buildCreatePayload(form: PartCreateForm, sortOrder: number) {
  return {
    part_number: form.part_number.trim(),
    name: form.name.trim() || form.part_number.trim(),
    customer: form.customer.trim(),
    density_material: form.density_material.trim(),
    length_in: Number(form.length_in),
    width_in: Number(form.width_in),
    height_in: Number(form.height_in),
    weight: Number(form.weight) || 1,
    notes: form.notes.trim(),
    color: form.color.trim() || "#D97706",
    allow_rotation: form.allow_rotation,
    sort_order: sortOrder,
    category: form.category.trim(),
    parent_group: form.parent_group.trim(),
    bundle_qty: parseInt(form.bundle_qty, 10) || 0,
  };
}

/**
 * Core 7 + id + bundle_qty always (as before admin-06). Optional columns only when the user changed
 * them versus `original` — the server writes an optional column whenever its key is present, so
 * sending only real changes means a save never rewrites an untouched column through the server's
 * normalisation (quickwin-01's "only when sent" contract). A cleared weight is never sent, so the
 * server's NaN → 1 default can't fire by accident.
 */
export function buildUpdatePayload(form: PartUpdateForm, original: PartRecord) {
  const before = partToUpdateForm(original);
  const payload: {
    id: string;
    part_number: string;
    customer: string;
    density_material: string;
    length_in: number;
    width_in: number;
    height_in: number;
    notes: string;
    bundle_qty: number;
    name?: string;
    category?: string;
    parent_group?: string;
    weight?: number;
    color?: string;
    allow_rotation?: boolean;
  } = {
    id: form.id,
    part_number: form.part_number.trim(),
    customer: form.customer.trim(),
    density_material: form.density_material.trim(),
    length_in: Number(form.length_in),
    width_in: Number(form.width_in),
    height_in: Number(form.height_in),
    notes: form.notes.trim(),
    bundle_qty: parseInt(form.bundle_qty, 10) || 0,
  };
  for (const k of ["name", "category", "parent_group"] as const) {
    if (form[k].trim() !== before[k].trim()) payload[k] = form[k].trim();
  }
  if (form.weight.trim() !== before.weight.trim() && form.weight.trim() !== "") payload.weight = Number(form.weight);
  if (form.color !== before.color) payload.color = form.color;
  if (form.allow_rotation !== before.allow_rotation) payload.allow_rotation = form.allow_rotation;
  return payload;
}

export function partToCreateForm(p: PartRecord): PartCreateForm {
  return {
    part_number: p.part_number || "",
    name: p.name || "",
    customer: p.customer || "",
    density_material: p.density_material || "",
    length_in: String(p.length_in ?? ""),
    width_in: String(p.width_in ?? ""),
    height_in: String(p.height_in ?? ""),
    weight: String(p.weight ?? ""),
    notes: p.notes || "",
    color: p.color || "#D97706",
    allow_rotation: !!p.allow_rotation,
    category: p.category || "",
    parent_group: p.parent_group || "",
    bundle_qty: String(p.bundle_qty ?? 0),
  };
}

export function partToUpdateForm(p: PartRecord): PartUpdateForm {
  return {
    id: p.id,
    part_number: p.part_number || "",
    customer: p.customer || "",
    density_material: p.density_material || "",
    length_in: String(p.length_in ?? ""),
    width_in: String(p.width_in ?? ""),
    height_in: String(p.height_in ?? ""),
    notes: p.notes || "",
    bundle_qty: String(p.bundle_qty ?? 0),
    name: p.name || "",
    category: p.category || "",
    parent_group: p.parent_group || "",
    weight: String(p.weight ?? ""),
    color: p.color || "#D97706",
    allow_rotation: !!p.allow_rotation,
  };
}

export function emptyCreateForm(): PartCreateForm {
  return {
    part_number: "",
    name: "",
    customer: "",
    density_material: "",
    length_in: "",
    width_in: "",
    height_in: "",
    weight: "1",
    notes: "",
    color: "#D97706",
    allow_rotation: false,
    category: "",
    parent_group: "",
    bundle_qty: "0",
  };
}

export function groupByCategory(parts: PartRecord[]): { groups: Record<string, PartRecord[]>; keys: string[] } {
  const groups: Record<string, PartRecord[]> = {};
  for (const p of parts) {
    const key = p.category || "Uncategorized";
    (groups[key] ||= []).push(p);
  }
  const keys = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  return { groups, keys };
}
