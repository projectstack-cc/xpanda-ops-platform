// src/lib/cutting/blockIds.ts — cc-blocks-01
// Molded-block IDs for the Cross Cutter: "MM/DD-XX" (date the block was molded, then its sequence on
// that molding sheet). Shared by the client (BlockIdInput) and the server (chunk-session stop/complete),
// and by the Cross Cutter report search (cc-blocks-02). Pure — no DB, no React.
// Exercised by blockIds.selfcheck.ts (`npx tsx cutting-pilot/src/lib/cutting/blockIds.selfcheck.ts`).

export const BLOCK_ID_HINT = "MM/DD-XX";

const BLOCK_ID_RE = /^(\d{1,2})\s*\/\s*(\d{1,2})\s*-\s*(\d{1,3})$/;

// Loose M/D-X → zero-padded "MM/DD-XX" (sequence padded to ≥ 2 digits: 7 → 07, 123 stays 123).
// Month 1–12, day 1–31, sequence ≥ 1. Returns null when the input isn't a block ID.
export function normalizeBlockId(raw: string): string | null {
  const m = BLOCK_ID_RE.exec(String(raw ?? "").trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const seq = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || seq < 1) return null;
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}-${String(seq).padStart(2, "0")}`;
}

// Split a typed/pasted list on commas, whitespace, newlines and semicolons. Spaces around "/" and "-"
// are collapsed first so "11/20 - 7" stays one piece. Valid IDs are normalized and de-duped in order;
// anything else lands in `invalid` (as typed, de-duped).
export function parseBlockIdList(raw: string): { ids: string[]; invalid: string[] } {
  const ids: string[] = [];
  const invalid: string[] = [];
  const pieces = String(raw ?? "")
    .replace(/\s*([/-])\s*/g, "$1")
    .split(/[\s,;]+/)
    .filter(Boolean);
  for (const piece of pieces) {
    const id = normalizeBlockId(piece);
    if (id) {
      if (!ids.includes(id)) ids.push(id);
    } else if (!invalid.includes(piece)) {
      invalid.push(piece);
    }
  }
  return { ids, invalid };
}

// Server-side check of a request body's `block_ids` (cc stop/complete). Missing/null → []. Every entry
// must normalize (else `invalid`, as sent); two entries normalizing to the same ID → `duplicates`.
export type BlockIdBodyCheck =
  | { ok: true; ids: string[] }
  | { ok: false; error: "invalid_block_id"; invalid: string[] }
  | { ok: false; error: "duplicate_in_request"; duplicates: string[] };

export function checkBlockIdsBody(raw: unknown): BlockIdBodyCheck {
  if (raw == null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "invalid_block_id", invalid: [String(raw)] };
  const ids: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  for (const entry of raw) {
    const id = typeof entry === "string" ? normalizeBlockId(entry) : null;
    if (!id) invalid.push(String(entry));
    else if (ids.includes(id)) {
      if (!duplicates.includes(id)) duplicates.push(id);
    } else ids.push(id);
  }
  if (invalid.length) return { ok: false, error: "invalid_block_id", invalid };
  if (duplicates.length) return { ok: false, error: "duplicate_in_request", duplicates };
  return { ok: true, ids };
}
