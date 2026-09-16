// src/lib/savedLoad.ts
// lb-ui-04 Part D. Pure snapshot build/serialize/deserialize for saved loads -- no React, no
// network. New module per Part D's own "or a new small module" authorization, read as covering
// this (not a silent fence expansion): LoadPlanView.tsx never actually holds a `loadEditor.ts`
// `EditorState` instance -- that type is CustomizeEditor.tsx's own transient, mid-edit-session
// shape (plan/dims/options/cart/skus/holding/history), only instantiated while edit mode is open,
// and it is never round-tripped through Apply back into a value LoadPlanView keeps. What actually
// needs to persist is LoadPlanView's own page-level state, which is a different shape entirely: the
// load *source* (a bundled fixture id, or a frozen `PulledLoadSource` from a job pull -- re-fetching
// live on restore isn't attempted, since the job's line items or the parts library could have
// changed since save; the source is round-tripped exactly as it was), the two engine options
// (`trailerTypeKey`/`runnerHeight`), and the materialized `editedPlan` (nullable). Persisting the
// materialized plan rather than replaying edit descriptors (legacy's `manualRowsByTrailer` model)
// is correct for v2: `pack()` is a pure, deterministic function of (cart, skus, dims, options), so
// `editedPlan: null` regenerates the identical auto-pack plan on restore without needing to store
// it; a non-null `editedPlan` (hand-customized) can't be regenerated that way, so it's stored as the
// actual PackPlan object legacy's descriptor-replay model has no equivalent of.
// Deliberately excluded: `multiplier` (LoadPlanView's own dev/demo-only quantity aid, gated out of
// production runtime behavior -- persisting it would be persisting a debug knob), and CustomizeEditor's
// `holding`/`history` (transient mid-session state -- legacy's own `state_json` persists neither an
// equivalent undo stack nor an equivalent "columns pulled out but not yet placed" set).
//
// Cross-compatibility: `saved_loads` (DB_Migrations/saved-loads.sql) already exists and is shared,
// unfenced, with legacy (`_worker.js/routes/bols.js`'s `handleApiSavedLoads`) -- the SAME table,
// SAME `state_json` TEXT column, holding whichever app wrote the row. Legacy's own `state_json`
// shape (`trailerType`, `manualRowsByTrailer`, `committedTrailers`, `variant`, ...) is structurally
// unrelated to this module's shape -- a legacy-authored row and a v2-authored row sit side by side
// in one list. `deserializeSnapshot` below returns a typed ok/reason result rather than throwing, so
// the picker UI can show "not loadable here" for a legacy row instead of crashing on Load.
import type { PackPlan } from "./packEngine";
import type { PulledLoadSource } from "@/components/logistics/JobPullModal";

export const SAVED_LOAD_SNAPSHOT_VERSION = 1 as const;

export interface SavedLoadFixtureSource {
  kind: "fixture";
  fixtureId: string;
}

export interface SavedLoadPulledSource {
  kind: "pulled";
  pulledSource: PulledLoadSource;
}

export type SavedLoadSource = SavedLoadFixtureSource | SavedLoadPulledSource;

export interface SavedLoadSnapshot {
  version: typeof SAVED_LOAD_SNAPSHOT_VERSION;
  source: SavedLoadSource;
  trailerTypeKey: string;
  runnerHeight: number;
  editedPlan: PackPlan | null;
}

export function buildSnapshot(args: {
  fixtureId: string;
  pulledSource: PulledLoadSource | null;
  trailerTypeKey: string;
  runnerHeight: number;
  editedPlan: PackPlan | null;
}): SavedLoadSnapshot {
  const source: SavedLoadSource = args.pulledSource
    ? { kind: "pulled", pulledSource: args.pulledSource }
    : { kind: "fixture", fixtureId: args.fixtureId };
  return {
    version: SAVED_LOAD_SNAPSHOT_VERSION,
    source,
    trailerTypeKey: args.trailerTypeKey,
    runnerHeight: args.runnerHeight,
    editedPlan: args.editedPlan,
  };
}

export function serializeSnapshot(snapshot: SavedLoadSnapshot): string {
  return JSON.stringify(snapshot);
}

export type DeserializeResult = { ok: true; snapshot: SavedLoadSnapshot } | { ok: false; reason: string };

const INCOMPATIBLE_REASON =
  "This saved load isn't compatible with the v2 Load Builder — it may have been saved from the legacy Load Builder.";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Light duck-typing, not a deep field-by-field check against every CartLine/PackSku -- proportionate
 * to what this needs to catch (a foreign/legacy/corrupt row), not a second type-checker. */
function isValidPulledSource(v: unknown): v is PulledLoadSource {
  if (!isPlainObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.jobId === "string" &&
    typeof v.invoiceNumber === "string" &&
    typeof v.customer === "string" &&
    typeof v.label === "string" &&
    Array.isArray(v.cart) &&
    Array.isArray(v.skus) &&
    typeof v.unmatchedCount === "number" &&
    Array.isArray(v.unmatchedDescriptions)
  );
}

function isValidSource(v: unknown): v is SavedLoadSource {
  if (!isPlainObject(v)) return false;
  if (v.kind === "fixture") return typeof v.fixtureId === "string";
  if (v.kind === "pulled") return isValidPulledSource(v.pulledSource);
  return false;
}

function isValidPlan(v: unknown): v is PackPlan {
  return (
    isPlainObject(v) &&
    Array.isArray(v.trailers) &&
    Array.isArray(v.balance) &&
    Array.isArray(v.warnings) &&
    typeof v.totalWeight === "number" &&
    typeof v.totalUnits === "number"
  );
}

export function deserializeSnapshot(raw: string): DeserializeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Corrupt save data." };
  }
  if (!isPlainObject(parsed)) return { ok: false, reason: INCOMPATIBLE_REASON };
  if (parsed.version !== SAVED_LOAD_SNAPSHOT_VERSION) return { ok: false, reason: INCOMPATIBLE_REASON };
  if (!isValidSource(parsed.source)) return { ok: false, reason: INCOMPATIBLE_REASON };
  if (typeof parsed.trailerTypeKey !== "string") return { ok: false, reason: INCOMPATIBLE_REASON };
  if (typeof parsed.runnerHeight !== "number") return { ok: false, reason: INCOMPATIBLE_REASON };
  if (parsed.editedPlan !== null && !isValidPlan(parsed.editedPlan)) return { ok: false, reason: INCOMPATIBLE_REASON };

  return {
    ok: true,
    snapshot: {
      version: SAVED_LOAD_SNAPSHOT_VERSION,
      source: parsed.source as SavedLoadSource,
      trailerTypeKey: parsed.trailerTypeKey as string,
      runnerHeight: parsed.runnerHeight as number,
      editedPlan: (parsed.editedPlan ?? null) as PackPlan | null,
    },
  };
}

/** Default save name, matching legacy's own `${customer} — ${date}` / bare-date fallback
 * (load-builder.html:2806-2807). */
export function defaultSaveName(customer: string): string {
  const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return customer ? `${customer} — ${dateStr}` : dateStr;
}

export interface SaveLoadPayload {
  name: string;
  job_id: string | null;
  customer: string;
  trailer_type: string;
  state_json: string;
}

export function buildSavePayload(name: string, customer: string, snapshot: SavedLoadSnapshot): SaveLoadPayload {
  const jobId = snapshot.source.kind === "pulled" ? snapshot.source.pulledSource.jobId : null;
  return {
    name: name.trim() || defaultSaveName(customer),
    job_id: jobId,
    customer,
    trailer_type: snapshot.trailerTypeKey,
    state_json: serializeSnapshot(snapshot),
  };
}

/** Row shape as the API returns it (list GET omits state_json; single-GET includes it). */
export interface SavedLoadListItem {
  id: string;
  name: string;
  job_id: string | null;
  customer: string;
  trailer_type: string;
  created_at: string;
  updated_at: string;
}

export interface SavedLoadRecord extends SavedLoadListItem {
  state_json: string;
  expires_at: string;
}
