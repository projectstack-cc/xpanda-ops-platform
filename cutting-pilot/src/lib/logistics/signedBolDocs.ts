// src/lib/logistics/signedBolDocs.ts
// Per-load signed-BOL artifact selection (carrier-09; extracted verbatim from lgx-signed-01's
// api/shipments/signed-bol/route.ts so the logistics board and the Carrier View can never disagree).
// Grouping mirrors legacy's dashboard modal (logistics/index.html loadBolDocuments): load_number,
// NULL -> 0. Docs are collected from EVERY BOL row in a load (a regenerate can leave the signature on
// an older row). Precedence within a load: signed = newest original_signed, else newest
// driver_signed/customer_signed; carrier = newest carrier_upload; photo = newest BOL row with
// signed_bol_photo_key. r2_key is carried for server-side streaming only — callers must never send it
// to a client.
import type { D1Database } from "@cloudflare/workers-types";

export type SignedBolRow = {
  id: string;
  job_id?: string | null;
  bol_number: string | null;
  load_number: number | null;
  load_count: number | null;
  signed_bol_photo_key: string | null;
  created_at: string | null;
};
export type SignedBolDoc = { id: string; bol_id: string; doc_type: string; created_at: string; r2_key?: string | null };

export interface LoadDocs<B extends SignedBolRow = SignedBolRow, D extends SignedBolDoc = SignedBolDoc> {
  load_number: number;
  /** This load's BOL rows, newest first. */
  rows: B[];
  signed: D | null;
  carrier: D | null;
  photo: B | null;
}

const CHUNK = 50;

/** NULL / non-numeric load_number groups as load 0. */
export function loadKey(loadNumber: number | null | undefined): number {
  return Number(loadNumber ?? 0) || 0;
}

/**
 * Pure: group BOL rows by load and pick each load's signed / carrier / photo artifact.
 * `docs` may be in any order (sorted newest-first here). Loads come back ascending by load_number;
 * loads with no artifact at all are still returned (callers filter).
 */
export function pickLoadDocs<B extends SignedBolRow, D extends SignedBolDoc>(bolRows: B[], docs: D[]): LoadDocs<B, D>[] {
  const sortedDocs = [...docs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const byLoad = new Map<number, B[]>();
  for (const b of bolRows) {
    const n = loadKey(b.load_number);
    if (!byLoad.has(n)) byLoad.set(n, []);
    byLoad.get(n)!.push(b);
  }

  const out: LoadDocs<B, D>[] = [];
  for (const [loadNumber, rows] of Array.from(byLoad.entries()).sort((a, b) => a[0] - b[0])) {
    rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    const bolIds = new Set(rows.map((r) => r.id));
    const loadDocs = sortedDocs.filter((d) => bolIds.has(d.bol_id));

    const signed =
      loadDocs.find((d) => d.doc_type === "original_signed") ||
      loadDocs.find((d) => d.doc_type === "driver_signed" || d.doc_type === "customer_signed") ||
      null;
    const carrier = loadDocs.find((d) => d.doc_type === "carrier_upload") || null;
    const photo = rows.find((r) => r.signed_bol_photo_key) || null;

    out.push({ load_number: loadNumber, rows, signed, carrier, photo });
  }
  return out;
}

/** bol_documents for the given BOL ids, newest first (50-bind chunks). */
export async function fetchBolDocs(DB: D1Database, bolIds: string[]): Promise<SignedBolDoc[]> {
  const docs: SignedBolDoc[] = [];
  for (let i = 0; i < bolIds.length; i += CHUNK) {
    const chunk = bolIds.slice(i, i + CHUNK);
    const r = await DB.prepare(
      `SELECT id, bol_id, doc_type, created_at, r2_key FROM bol_documents WHERE bol_id IN (${chunk.map(() => "?").join(",")}) ORDER BY created_at DESC`
    )
      .bind(...chunk)
      .all<SignedBolDoc>();
    docs.push(...(r.results ?? []));
  }
  // Newest-first across chunks too.
  docs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return docs;
}

/** BOL rows for the given job ids (50-bind chunks). */
export async function fetchBolRowsForJobs(DB: D1Database, jobIds: string[]): Promise<SignedBolRow[]> {
  const rows: SignedBolRow[] = [];
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const chunk = jobIds.slice(i, i + CHUNK);
    const r = await DB.prepare(
      `SELECT id, job_id, bol_number, load_number, load_count, signed_bol_photo_key, created_at FROM bols WHERE job_id IN (${chunk.map(() => "?").join(",")})`
    )
      .bind(...chunk)
      .all<SignedBolRow>();
    rows.push(...(r.results ?? []));
  }
  return rows;
}

/** The two queries for one job: its BOL rows + their documents. */
export async function loadBolDocsForJob(
  DB: D1Database,
  jobId: string
): Promise<{ bols: SignedBolRow[]; docs: SignedBolDoc[] }> {
  const bols = await fetchBolRowsForJobs(DB, [jobId]);
  const docs = await fetchBolDocs(DB, bols.map((b) => b.id));
  return { bols, docs };
}
