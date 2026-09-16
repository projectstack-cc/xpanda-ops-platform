// src/lib/partsLibrary.selfcheck.ts
// Guarded dev self-check for partsLibrary.ts (lb-ui-10 Part C). Mirrors jobPull.selfcheck.ts's
// shape: hand-built fixtures, a check()/results table, one exported run*SelfCheck() function. Pure
// -- no network calls, no live /api/parts write (per this prompt's own verification step 7).
import {
  validatePartCreate,
  validatePartUpdate,
  nextSortOrder,
  buildCreatePayload,
  buildUpdatePayload,
  groupByCategory,
  emptyCreateForm,
  type PartCreateForm,
  type PartUpdateForm,
  type PartRecord,
} from "./partsLibrary";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function makeCreateForm(overrides: Partial<PartCreateForm> = {}): PartCreateForm {
  return { ...emptyCreateForm(), part_number: "HB-04", length_in: "48", width_in: "24", height_in: "8", ...overrides };
}

function makeUpdateForm(overrides: Partial<PartUpdateForm> = {}): PartUpdateForm {
  return {
    id: "p1",
    part_number: "HB-04",
    customer: "",
    density_material: "",
    length_in: "48",
    width_in: "24",
    height_in: "8",
    notes: "",
    bundle_qty: "0",
    ...overrides,
  };
}

function makePart(overrides: Partial<PartRecord> = {}): PartRecord {
  return {
    id: "p1",
    part_number: "HB-04",
    name: "4in block",
    customer: "",
    density_material: "",
    length_in: 48,
    width_in: 24,
    height_in: 8,
    weight: 10,
    notes: "",
    color: "#D97706",
    allow_rotation: 0,
    sort_order: 0,
    category: "Blocks",
    parent_group: "",
    bundle_qty: 0,
    ...overrides,
  };
}

export function runPartsLibrarySelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // 1. Validation accepts a well-formed part (all required fields, positive dimensions).
  {
    const r = validatePartCreate(makeCreateForm());
    check("validatePartCreate: well-formed part accepted", r.ok === true && r.errors.length === 0, JSON.stringify(r));
  }

  // 2. Validation rejects a part missing part_number.
  {
    const r = validatePartCreate(makeCreateForm({ part_number: "" }));
    check(
      "validatePartCreate: missing part_number rejected",
      r.ok === false && r.errors.includes("Part number is required."),
      JSON.stringify(r)
    );
  }
  {
    const r = validatePartCreate(makeCreateForm({ part_number: "   " }));
    check("validatePartCreate: whitespace-only part_number rejected", r.ok === false, JSON.stringify(r));
  }

  // 3. Validation rejects non-positive length/width/height, each checked independently.
  {
    const rLen = validatePartCreate(makeCreateForm({ length_in: "0" }));
    check(
      "validatePartCreate: length_in = 0 rejected independently",
      rLen.ok === false && rLen.errors.includes("Length must be greater than 0."),
      JSON.stringify(rLen)
    );
  }
  {
    const rWid = validatePartCreate(makeCreateForm({ width_in: "-5" }));
    check(
      "validatePartCreate: negative width_in rejected independently",
      rWid.ok === false && rWid.errors.includes("Width must be greater than 0."),
      JSON.stringify(rWid)
    );
  }
  {
    const rHt = validatePartCreate(makeCreateForm({ height_in: "abc" }));
    check(
      "validatePartCreate: non-numeric height_in rejected independently",
      rHt.ok === false && rHt.errors.includes("Height must be greater than 0."),
      JSON.stringify(rHt)
    );
  }
  {
    const rAll = validatePartCreate(makeCreateForm({ length_in: "0", width_in: "0", height_in: "0" }));
    check(
      "validatePartCreate: all three dims invalid -> three distinct errors",
      rAll.ok === false && rAll.errors.length === 3,
      JSON.stringify(rAll)
    );
  }

  // 4. validatePartUpdate mirrors the same dimension/part_number rules, plus id required.
  {
    const r = validatePartUpdate(makeUpdateForm());
    check("validatePartUpdate: well-formed update accepted", r.ok === true, JSON.stringify(r));
  }
  {
    const r = validatePartUpdate(makeUpdateForm({ id: "" }));
    check("validatePartUpdate: missing id rejected", r.ok === false && r.errors.includes("id is required."), JSON.stringify(r));
  }
  {
    const r = validatePartUpdate(makeUpdateForm({ height_in: "-1" }));
    check("validatePartUpdate: non-positive height_in rejected", r.ok === false, JSON.stringify(r));
  }

  // 5. nextSortOrder: empty list -> 0; appends after the current max, not the count (handles gaps).
  {
    const zero = nextSortOrder([]);
    check("nextSortOrder: empty list -> 0", zero === 0, String(zero));
  }
  {
    const appended = nextSortOrder([makePart({ sort_order: 0 }), makePart({ sort_order: 5 }), makePart({ sort_order: 2 })]);
    check("nextSortOrder: appends after current max (5 -> 6), not count (3)", appended === 6, String(appended));
  }

  // 6. buildCreatePayload / buildUpdatePayload: trims strings, coerces numbers, matches
  //    handleApiParts's own field names exactly.
  {
    const payload = buildCreatePayload(makeCreateForm({ part_number: "  HB-04  ", weight: "" }), 3);
    check(
      "buildCreatePayload: trims part_number, defaults weight to 1 when blank",
      payload.part_number === "HB-04" && payload.weight === 1 && payload.sort_order === 3,
      JSON.stringify(payload)
    );
  }
  {
    const payload = buildUpdatePayload(makeUpdateForm({ bundle_qty: "" }));
    check(
      "buildUpdatePayload: blank bundle_qty coerces to 0, id passed through untrimmed-safe",
      payload.bundle_qty === 0 && payload.id === "p1",
      JSON.stringify(payload)
    );
  }

  // 7. groupByCategory: groups present categories, buckets blank category as "Uncategorized",
  //    keys sorted alphabetically.
  {
    const parts = [
      makePart({ id: "a", category: "Sheets" }),
      makePart({ id: "b", category: "Blocks" }),
      makePart({ id: "c", category: "" }),
    ];
    const { groups, keys } = groupByCategory(parts);
    check(
      "groupByCategory: buckets and sorts categories, blanks -> Uncategorized",
      keys.join(",") === "Blocks,Sheets,Uncategorized" &&
        groups["Blocks"]?.length === 1 &&
        groups["Sheets"]?.length === 1 &&
        groups["Uncategorized"]?.length === 1,
      JSON.stringify({ keys, counts: keys.map((k) => groups[k].length) })
    );
  }

  return { pass: results.every((r) => r.pass), results };
}
