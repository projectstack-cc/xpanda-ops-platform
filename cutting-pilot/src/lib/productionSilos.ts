// src/lib/productionSilos.ts
// Single source for Production Log v2 Group B silo + bead-lot rules (prod-b-02), imported by every
// silo / bead-lot / sheet-row route so the rules live in one place. No React, no DOM.
//
// Silo model: 12 silos, ONE lot per silo, lifecycle empty -> filling -> full -> in_use -> empty.
// Expansion may add only to an `empty` silo (-> filling with that lot) or a `filling` silo holding
// the same lot. Molding may use only `full` / `in_use` silos (first block from `full` -> in_use).
//
// CONCURRENCY PATTERN (every write that depends on silo state):
//   1. Read the silo and validate it with canExpandInto / canMoldFrom (or the transition rules).
//   2. Write everything in ONE `DB.batch([...])` (D1 runs a batch as a single transaction):
//        a. the guarded transitionUpdate (only when a transition applies) —
//           `UPDATE production_silos ... WHERE silo_no = ? AND state = ? AND COALESCE(lot_id,'') = ?`
//           i.e. it only fires if the silo is still exactly what step 1 validated against;
//        b. the row insert as `INSERT ... SELECT ... WHERE EXISTS (silo is in the EXPECTED
//           POST-TRANSITION state + lot)` (siloIsGate);
//        c. the event insert (only when a transition applies), gated on the row existing AND on
//           this request's own transition stamp (updated_at/updated_by) being on the silo.
//   3. If the row insert's `meta.changes === 0` -> 409 `silo_state_changed`; the UI refetches.
//      Nothing inconsistent was written: the gated inserts no-op when the guard missed.
//   State endpoints (silos/[no]/state, manage/silos/[no]) use the same idea without a row: the
//   guarded UPDATE plus an event gated on the silo now being in the target state with the event's
//   lot and this request's stamp; UPDATE `meta.changes === 0` -> 409 `silo_state_changed`.
// INVARIANT: a row or event is never written against a silo whose state disagrees with it.
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

export type SiloState = "empty" | "filling" | "full" | "in_use";

export const SILO_STATES: SiloState[] = ["empty", "filling", "full", "in_use"];

export interface SiloRow {
  silo_no: number;
  label: string;
  active: number;
  state: SiloState;
  lot_id: string | null;
  lot_no: string | null;
  bead_supplier: string | null;
  bead_type: string | null;
  density: number | null;
  fill_started_at: string | null;
  full_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
  kg_added: number;
}

export interface BeadLotRow {
  id: string;
  bead_supplier: string;
  bead_type: string;
  lot_no: string;
  label_weight: number;
  label_unit: "kg" | "lb";
  po_no: string | null;
  received_date: string;
  notes: string | null;
  active: number;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  bags_received: number;
  bags_opened: number;
  on_hand: number;
  opened_in_session?: number;
}

export type SiloCheck =
  | { ok: true }
  | { ok: false; error: "silo_lot_mismatch" | "silo_not_fillable" | "silo_not_moldable" | "silo_inactive" };

export const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

// Manage capability: production.manage (middleware header) or Administrator.
export function canManageProduction(headers: { get(name: string): string | null }): boolean {
  return headers.get("X-User-Can-Manage-Production") === "1" || headers.get("X-User-Is-Admin") === "1";
}

// Integer silo number in 1..12, else null.
export function siloNoOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

// All production_silos columns + derived kg_added (expanded kg of the current lot since the fill
// started; 0 when empty). Derived on every read — never cached — so row edits/deletes reflect.
// Callers append `WHERE production_silos.silo_no = ?` or `ORDER BY production_silos.silo_no`.
export const SILO_SELECT_SQL = `SELECT production_silos.*,
  CASE WHEN production_silos.state = 'empty' THEN 0 ELSE
    COALESCE((SELECT SUM(b.weight_kg) FROM production_expansion_batches b
      JOIN production_expansion_sessions s ON s.id = b.session_id AND s.deleted_at IS NULL
      WHERE b.silo = production_silos.silo_no AND b.lot_no = production_silos.lot_no
        AND b.created_at >= production_silos.fill_started_at), 0)
  END AS kg_added
FROM production_silos`;

const LOT_COLUMNS = `l.*,
  COALESCE((SELECT SUM(g.bags) FROM production_bead_ledger g
    WHERE g.lot_id = l.id AND g.kind = 'receive'), 0) AS bags_received,
  -COALESCE((SELECT SUM(g.bags) FROM production_bead_ledger g
    WHERE g.lot_id = l.id AND g.kind IN ('open','undo_open')), 0) AS bags_opened,
  COALESCE((SELECT SUM(g.bags) FROM production_bead_ledger g WHERE g.lot_id = l.id), 0) AS on_hand`;

// Lot columns + bags_received / bags_opened / on_hand. Callers append WHERE / ORDER BY on `l`.
export const LOT_SELECT_SQL = `SELECT ${LOT_COLUMNS}
FROM production_bead_lots l`;

// Same, plus opened_in_session for ONE expansion session. Bind the session_id FIRST.
export const LOT_SELECT_WITH_SESSION_SQL = `SELECT ${LOT_COLUMNS},
  -COALESCE((SELECT SUM(g.bags) FROM production_bead_ledger g
    WHERE g.lot_id = l.id AND g.session_id = ?1 AND g.kind IN ('open','undo_open')), 0) AS opened_in_session
FROM production_bead_lots l`;

export function canExpandInto(silo: Pick<SiloRow, "active" | "state" | "lot_id">, lotId: string): SiloCheck {
  if (!silo.active) return { ok: false, error: "silo_inactive" };
  if (silo.state === "empty") return { ok: true };
  if (silo.state === "filling") {
    return silo.lot_id === lotId ? { ok: true } : { ok: false, error: "silo_lot_mismatch" };
  }
  return { ok: false, error: "silo_not_fillable" };
}

export function canMoldFrom(silo: Pick<SiloRow, "active" | "state">): SiloCheck {
  if (!silo.active) return { ok: false, error: "silo_inactive" };
  if (silo.state === "full" || silo.state === "in_use") return { ok: true };
  return { ok: false, error: "silo_not_moldable" };
}

export interface SiloPatch {
  label?: string;
  active?: number;
  lot_id?: string | null;
  lot_no?: string | null;
  bead_supplier?: string | null;
  bead_type?: string | null;
  density?: number | null;
  fill_started_at?: string | null;
  full_at?: string | null;
}

const LOT_FIELDS = ["lot_id", "lot_no", "bead_supplier", "bead_type", "density", "fill_started_at", "full_at"] as const;

// Guarded silo UPDATE (not executed — returned for DB.batch). Only matches while the silo is still
// in `from` holding `fromLotId` (null/"" = no lot). A transition to `empty` clears every lot field.
// Always stamps updated_by / updated_at (pass `ts` so gated event inserts can match the stamp).
export function transitionUpdate(
  DB: D1Database,
  args: {
    siloNo: number;
    from: SiloState;
    fromLotId: string | null;
    to: SiloState;
    patch?: SiloPatch;
    operatorId: string;
    ts: string;
  }
): D1PreparedStatement {
  const patch: SiloPatch = { ...(args.patch ?? {}) };
  if (args.to === "empty") for (const f of LOT_FIELDS) patch[f] = null;
  const sets = ["state = ?"];
  const binds: unknown[] = [args.to];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    binds.push(v);
  }
  sets.push("updated_by = ?", "updated_at = ?");
  binds.push(args.operatorId, args.ts);
  return DB.prepare(
    `UPDATE production_silos SET ${sets.join(", ")}
      WHERE silo_no = ? AND state = ? AND COALESCE(lot_id,'') = ?`
  ).bind(...binds, args.siloNo, args.from, args.fromLotId ?? "");
}

// SQL fragment + binds: "silo is in `state` holding `lotId`". Use inside INSERT ... SELECT ... WHERE.
export function siloIsGate(siloNo: number, state: SiloState, lotId: string | null): { sql: string; binds: unknown[] } {
  return {
    sql: `EXISTS (SELECT 1 FROM production_silos WHERE silo_no = ? AND state = ? AND COALESCE(lot_id,'') = ?)`,
    binds: [siloNo, state, lotId ?? ""],
  };
}

// SQL fragment + binds: "this request's transitionUpdate stamp is on the silo".
export function siloStampGate(siloNo: number, operatorId: string, ts: string): { sql: string; binds: unknown[] } {
  return {
    sql: `EXISTS (SELECT 1 FROM production_silos WHERE silo_no = ? AND updated_by = ? AND updated_at = ?)`,
    binds: [siloNo, operatorId, ts],
  };
}

// Append-only silo event insert (not executed — returned for DB.batch), gated on every `gates`
// fragment holding at write time. prod-d-02: snapshots the silo's bead key (supplier / type /
// density). Every call site batches transitionUpdate BEFORE this insert, so the subselects read the
// POST-transition silo row: `empty` events snapshot NULLs by design (the lot fields were cleared),
// and a manual correction to a new lot (density NULL) yields a `full` event that doesn't count
// toward expansion schedule progress.
export function eventInsert(
  DB: D1Database,
  args: {
    siloNo: number;
    from: SiloState;
    to: SiloState;
    lotNo: string | null;
    source: "expansion" | "molding" | "manual";
    refId?: string | null;
    note?: string | null;
    operatorId: string;
    operatorName: string;
    ts: string;
    gates: Array<{ sql: string; binds: unknown[] }>;
  }
): D1PreparedStatement {
  const where = args.gates.length ? `WHERE ${args.gates.map((g) => g.sql).join(" AND ")}` : "";
  return DB.prepare(
    `INSERT INTO production_silo_events
       (id, silo_no, from_state, to_state, lot_no, source, ref_id, note, operator_id, operator_name, created_at, bead_supplier, bead_type, density)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        (SELECT bead_supplier FROM production_silos WHERE silo_no = ?),
        (SELECT bead_type FROM production_silos WHERE silo_no = ?),
        (SELECT density FROM production_silos WHERE silo_no = ?) ${where}`
  ).bind(
    crypto.randomUUID(), args.siloNo, args.from, args.to, args.lotNo ?? null, args.source,
    args.refId ?? null, args.note ?? null, args.operatorId, args.operatorName || args.operatorId, args.ts, args.siloNo, args.siloNo, args.siloNo,
    ...args.gates.flatMap((g) => g.binds)
  );
}

export async function getSilo(DB: D1Database, siloNo: number): Promise<SiloRow | null> {
  return DB.prepare(`${SILO_SELECT_SQL} WHERE production_silos.silo_no = ?`).bind(siloNo).first<SiloRow>();
}

export async function getLot(DB: D1Database, lotId: string, sessionId?: string | null): Promise<BeadLotRow | null> {
  if (sessionId) {
    return DB.prepare(`${LOT_SELECT_WITH_SESSION_SQL} WHERE l.id = ?2`).bind(sessionId, lotId).first<BeadLotRow>();
  }
  return DB.prepare(`${LOT_SELECT_SQL} WHERE l.id = ?`).bind(lotId).first<BeadLotRow>();
}

// Shared checks for bag open / undo-open: the expansion sheet exists, isn't deleted, is open, and
// the lot is active and matches the sheet's supplier + bead type.
export async function loadBagContext(
  DB: D1Database,
  lotId: string,
  sessionId: string
): Promise<{ lot: { id: string; lot_no: string } } | { status: number; error: string }> {
  const session = sessionId
    ? await DB.prepare(
        `SELECT status, bead_supplier, bead_type FROM production_expansion_sessions WHERE id = ? AND deleted_at IS NULL`
      ).bind(sessionId).first<{ status: string; bead_supplier: string | null; bead_type: string | null }>()
    : null;
  if (!session) return { status: 404, error: "sheet_not_found" };
  if (session.status !== "open") return { status: 409, error: "sheet_closed" };
  const lot = await DB.prepare(
    `SELECT id, lot_no, bead_supplier, bead_type, active FROM production_bead_lots WHERE id = ?`
  ).bind(lotId).first<{ id: string; lot_no: string; bead_supplier: string; bead_type: string; active: number }>();
  if (!lot || !lot.active) return { status: 400, error: "lot_unknown" };
  if (lot.bead_supplier !== session.bead_supplier || lot.bead_type !== session.bead_type) {
    return { status: 400, error: "lot_sheet_mismatch" };
  }
  return { lot: { id: lot.id, lot_no: lot.lot_no } };
}
