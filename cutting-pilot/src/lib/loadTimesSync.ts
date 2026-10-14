// src/lib/loadTimesSync.ts
// dlv-02: schedule sheet → per-load delivery times (job_load_times). Reads only `schedule_rows`
// (already in D1 from the 10-min ingest) — no Google calls. Locked decisions (Steve, 2026-10-14):
// the sheet wins over manual times; every change to an EXISTING value alerts (a first fill never
// does); unshipped BOLs are patched in place and logistics is told to reprint.
// Runs from runSchedulePoll (cron context: no session, no X-User-*, system actor) and from
// createJob (match at job creation). Each job is isolated in its own try/catch.
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { dispatchNotification, type PushEnv } from "@/lib/push";
import { logActivity } from "@/lib/activityLog";
import { assignSheetLoads, isDittoCell, summarizeLoadTimes, type LoadTime, type SheetRowInput } from "@/lib/loadTimes";

export interface LoadTimesSyncEnv extends PushEnv {
  DB: D1Database;
}

const CHUNK = 90; // D1 100-bound-param ceiling
const SHIPPED_LOAD_STATUSES = ["in_transit", "delivered"];
const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

// ── Pure decision helpers (asserted by loadTimesSync.selfcheck.ts) ──────────────────────────

export interface StoredLoadTime {
  job_id: string;
  load_number: number;
  delivery_date: string | null;
  delivery_minutes: number | null;
  display: string;
  source: "sheet" | "manual";
  sheet_raw: string | null;
}

export interface IncomingLoadTime {
  load_number: number;
  date: string | null;
  minutes: number;
  display: string;
  sheet_raw: string;
}

/**
 * insert  — no row yet: first fill, no alert.
 * noop    — same display, already sheet-sourced, same date/raw: nothing to write.
 * refresh — same display but manual (flip source → sheet) or a silent date/raw refresh: no alert.
 * change  — different display: overwrite, record prev_display + changed_at, alert.
 */
export type LoadTimeDecision =
  | { kind: "insert" }
  | { kind: "noop" }
  | { kind: "refresh"; flippedSource: boolean }
  | { kind: "change"; prevDisplay: string };

export function decideLoadTime(existing: StoredLoadTime | null | undefined, incoming: IncomingLoadTime): LoadTimeDecision {
  if (!existing) return { kind: "insert" };
  if (existing.display !== incoming.display) return { kind: "change", prevDisplay: existing.display };
  if (existing.source === "manual") return { kind: "refresh", flippedSource: true };
  if (
    existing.delivery_date !== incoming.date ||
    existing.delivery_minutes !== incoming.minutes ||
    (existing.sheet_raw ?? "") !== incoming.sheet_raw
  ) {
    return { kind: "refresh", flippedSource: false };
  }
  return { kind: "noop" };
}

/**
 * bolShared.ts prefers render_overrides.deliveryTime over bols.delivery_time, so a stale override
 * would keep printing the old time after the sheet sync patches the column. Removes that key.
 * null/empty → untouched. Malformed JSON or a non-object → untouched, `malformed` set (caller logs).
 */
export function stripDeliveryTimeOverride(raw: string | null | undefined): {
  value: string | null;
  changed: boolean;
  malformed: boolean;
} {
  if (raw == null || raw === "") return { value: raw ?? null, changed: false, malformed: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: raw, changed: false, malformed: true };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { value: raw, changed: false, malformed: true };
  if (!Object.prototype.hasOwnProperty.call(parsed, "deliveryTime")) return { value: raw, changed: false, malformed: false };
  const copy = { ...(parsed as Record<string, unknown>) };
  delete copy.deliveryTime;
  return { value: JSON.stringify(copy), changed: true, malformed: false };
}

/** For each `^^^` row: the cell of the nearest earlier non-ditto row in the same (ship_week, ship_date) section. */
export function resolveDittoSources<T extends { ship_week: string; ship_date: string | null; sort_order: number; delivery_time: string | null }>(
  rows: T[],
  sectionRows: { ship_week: string; ship_date: string | null; sort_order: number; delivery_time: string | null }[]
): (T & { ditto_source?: string | null })[] {
  return rows.map((r) => {
    if (!isDittoCell(r.delivery_time)) return r;
    const prev = sectionRows
      .filter((s) => s.ship_week === r.ship_week && s.ship_date === r.ship_date && s.sort_order < r.sort_order && !isDittoCell(s.delivery_time))
      .sort((a, b) => b.sort_order - a.sort_order)[0];
    return { ...r, ditto_source: prev ? prev.delivery_time : null };
  });
}

// ── D1 helpers ──────────────────────────────────────────────────────────────────────────────

async function allChunked<T>(db: D1Database, ids: string[], sqlFor: (ph: string) => string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { results } = await db.prepare(sqlFor(chunk.map(() => "?").join(","))).bind(...chunk).all<T>();
    out.push(...(results ?? []));
  }
  return out;
}

interface CandidateJob {
  id: string;
  invoice_number: string;
  load_count: number | null;
  status: string;
}

interface ScheduleRowRec {
  match_job_id: string;
  ship_week: string;
  ship_date: string | null;
  day_of_week: string;
  sort_order: number;
  load_count: number | null;
  delivery_time: string | null;
}

const CANDIDATE_WHERE = `archived_at IS NULL AND invoice_number <> ''
  AND EXISTS (SELECT 1 FROM schedule_rows s WHERE s.match_job_id = jobs.id)`;

// ── Sync ────────────────────────────────────────────────────────────────────────────────────

export async function syncLoadTimesForJobs(env: LoadTimesSyncEnv, jobIds?: string[]): Promise<void> {
  const db = env.DB;

  // 1. Candidate jobs.
  let jobs: CandidateJob[];
  if (jobIds) {
    const ids = Array.from(new Set(jobIds.filter(Boolean)));
    if (!ids.length) return;
    jobs = await allChunked<CandidateJob>(db, ids, (ph) =>
      `SELECT id, invoice_number, load_count, status FROM jobs WHERE id IN (${ph}) AND ${CANDIDATE_WHERE}`
    );
  } else {
    const { results } = await db
      .prepare(`SELECT id, invoice_number, load_count, status FROM jobs WHERE ${CANDIDATE_WHERE}`)
      .all<CandidateJob>();
    jobs = results ?? [];
  }
  if (!jobs.length) return;
  const candidateIds = jobs.map((j) => j.id);

  // 2. Every schedule row for those jobs, plus the day sections any ditto row needs.
  const rows = await allChunked<ScheduleRowRec>(db, candidateIds, (ph) =>
    `SELECT match_job_id, ship_week, ship_date, day_of_week, sort_order, load_count, delivery_time
       FROM schedule_rows WHERE match_job_id IN (${ph}) ORDER BY ship_date, sort_order`
  );
  const dittoWeeks = Array.from(new Set(rows.filter((r) => isDittoCell(r.delivery_time)).map((r) => r.ship_week)));
  const sectionRows = dittoWeeks.length
    ? await allChunked<ScheduleRowRec>(db, dittoWeeks, (ph) =>
        `SELECT match_job_id, ship_week, ship_date, day_of_week, sort_order, load_count, delivery_time
           FROM schedule_rows WHERE ship_week IN (${ph})`
      )
    : [];
  const resolved = resolveDittoSources(rows, sectionRows);
  const rowsByJob = new Map<string, SheetRowInput[]>();
  for (const r of resolved) {
    const list = rowsByJob.get(r.match_job_id) ?? [];
    list.push(r);
    rowsByJob.set(r.match_job_id, list);
  }

  // 3. Existing per-load rows.
  const stored = await allChunked<StoredLoadTime>(db, candidateIds, (ph) =>
    `SELECT job_id, load_number, delivery_date, delivery_minutes, display, source, sheet_raw
       FROM job_load_times WHERE job_id IN (${ph})`
  );
  const storedByJob = new Map<string, Map<number, StoredLoadTime>>();
  for (const s of stored) {
    const m = storedByJob.get(s.job_id) ?? new Map<number, StoredLoadTime>();
    m.set(Number(s.load_number), s);
    storedByJob.set(s.job_id, m);
  }

  for (const job of jobs) {
    try {
      await syncOneJob(env, job, rowsByJob.get(job.id) ?? [], storedByJob.get(job.id) ?? new Map());
    } catch (err) {
      console.error(`load-times: sync failed for job ${job.id}`, err);
    }
  }
}

async function syncOneJob(
  env: LoadTimesSyncEnv,
  job: CandidateJob,
  rows: SheetRowInput[],
  existing: Map<number, StoredLoadTime>
): Promise<void> {
  const db = env.DB;
  if (!rows.length) return;
  const { times, warning } = assignSheetLoads(rows, Number(job.load_count) || 1);
  if (warning) console.warn(`load-times: INV ${job.invoice_number}: ${warning}`);
  // Never delete or blank an existing row because the sheet lacks a time.
  const incoming: IncomingLoadTime[] = times
    .filter((t) => t.minutes != null)
    .map((t) => ({ load_number: t.load_number, date: t.date, minutes: t.minutes as number, display: t.display, sheet_raw: t.sheet_raw }));
  if (!incoming.length) return;

  const stmts: D1PreparedStatement[] = [];
  const changes: { load_number: number; from: string; to: string }[] = [];
  let inserted = false;
  const merged = new Map<number, LoadTime>();
  for (const [n, s] of Array.from(existing.entries())) {
    merged.set(n, { load_number: n, date: s.delivery_date, minutes: s.delivery_minutes, display: s.display });
  }

  for (const inc of incoming) {
    const d = decideLoadTime(existing.get(inc.load_number), inc);
    if (d.kind === "noop") continue;
    merged.set(inc.load_number, { load_number: inc.load_number, date: inc.date, minutes: inc.minutes, display: inc.display });
    if (d.kind === "insert") {
      inserted = true;
      stmts.push(
        db.prepare(
          `INSERT INTO job_load_times (job_id, load_number, delivery_date, delivery_minutes, display, source, sheet_raw, updated_at)
           VALUES (?, ?, ?, ?, ?, 'sheet', ?, datetime('now'))
           ON CONFLICT(job_id, load_number) DO NOTHING`
        ).bind(job.id, inc.load_number, inc.date, inc.minutes, inc.display, inc.sheet_raw)
      );
    } else if (d.kind === "refresh") {
      stmts.push(
        db.prepare(
          `UPDATE job_load_times SET delivery_date = ?, delivery_minutes = ?, display = ?, source = 'sheet', sheet_raw = ?,
                  updated_at = datetime('now')
            WHERE job_id = ? AND load_number = ?`
        ).bind(inc.date, inc.minutes, inc.display, inc.sheet_raw, job.id, inc.load_number)
      );
    } else {
      changes.push({ load_number: inc.load_number, from: d.prevDisplay, to: inc.display });
      stmts.push(
        db.prepare(
          `UPDATE job_load_times SET delivery_date = ?, delivery_minutes = ?, display = ?, source = 'sheet', sheet_raw = ?,
                  prev_display = ?, changed_at = datetime('now'), change_acked_at = NULL, change_acked_by = NULL,
                  updated_at = datetime('now')
            WHERE job_id = ? AND load_number = ?`
        ).bind(inc.date, inc.minutes, inc.display, inc.sheet_raw, d.prevDisplay, job.id, inc.load_number)
      );
    }
  }
  if (!stmts.length) return;

  // Mirror the summary onto the single-field surfaces. Direct UPDATE (never the order-edit
  // handlers — they'd log activity as a user). Only written when the text actually differs.
  if (inserted || changes.length) {
    const summary = summarizeLoadTimes(Array.from(merged.values()));
    if (summary) {
      stmts.push(
        db.prepare(`UPDATE jobs SET delivery_time = ?, updated_at = ? WHERE id = ? AND COALESCE(delivery_time, '') <> ?`)
          .bind(summary, now(), job.id, summary),
        db.prepare(`UPDATE shipments SET delivery_time = ? WHERE job_id = ? AND direction = 'outbound' AND COALESCE(delivery_time, '') <> ?`)
          .bind(summary, job.id, summary)
      );
    }
  }
  await db.batch(stmts);

  if (!changes.length) return;

  // Stale BOLs — newest BOL per load (same rule as api/shipments/[id] + loading-sheet routes); a
  // single null-load_number BOL counts as load 1 on a one-load job. Shipped loads are left alone.
  const bols =
    (await db
      .prepare(`SELECT id, load_number, render_overrides FROM bols WHERE job_id = ? ORDER BY created_at DESC`)
      .bind(job.id)
      .all<{ id: string; load_number: number | null; render_overrides: string | null }>()).results ?? [];
  const assignments =
    (await db
      .prepare(`SELECT load_number, loading_status FROM loading_assignments WHERE job_id = ?`)
      .bind(job.id)
      .all<{ load_number: number | null; loading_status: string | null }>()).results ?? [];
  const oneLoadJob = (Number(job.load_count) || 1) <= 1;

  const bolStmts: D1PreparedStatement[] = [];
  const lines: string[] = [];
  for (const c of changes) {
    const shipped =
      job.status === "shipped" ||
      assignments.some((a) => Number(a.load_number) === c.load_number && SHIPPED_LOAD_STATUSES.includes(String(a.loading_status)));
    const bol =
      bols.find((b) => b.load_number != null && Number(b.load_number) === c.load_number) ??
      (oneLoadJob && c.load_number === 1 && bols.length === 1 && bols[0].load_number == null ? bols[0] : undefined);
    let note = "";
    if (shipped) {
      note = " (already shipped)";
    } else if (bol) {
      const ov = stripDeliveryTimeOverride(bol.render_overrides);
      if (ov.malformed) console.error(`load-times: bol ${bol.id} render_overrides is malformed JSON — left as-is`);
      bolStmts.push(
        ov.changed
          ? db.prepare(`UPDATE bols SET delivery_time = ?, render_overrides = ? WHERE id = ?`).bind(c.to, ov.value, bol.id)
          : db.prepare(`UPDATE bols SET delivery_time = ? WHERE id = ?`).bind(c.to, bol.id)
      );
      note = " (BOL updated — reprint)";
    }
    lines.push(`Load ${c.load_number}: ${c.from || "—"} → ${c.to}${note}`);
  }
  if (bolStmts.length) await db.batch(bolStmts);

  const message = lines.join("; ");
  await dispatchNotification(db, env, "logistics.delivery_time_changed", `Delivery time changed — INV ${job.invoice_number}`, message, "job", job.id);
  await logActivity(
    db, "delivery_time.sheet_sync", "job", job.id,
    `Schedule sheet changed delivery time — INV ${job.invoice_number}: ${message}`,
    { invoice_number: job.invoice_number, changes, bols_patched: bolStmts.length, source: "schedule_sheet" },
    null,
  );
}

/**
 * Match at job creation: claim this invoice's schedule rows for the new job (the ingest only sets
 * match_job_id on its 10-min poll, and would set this same value then), then sync it.
 */
export async function syncLoadTimesForInvoice(env: LoadTimesSyncEnv, invoiceNumber: string): Promise<void> {
  const inv = String(invoiceNumber ?? "").trim();
  if (!inv) return;
  const { results } = await env.DB
    .prepare(`SELECT id FROM jobs WHERE trim(invoice_number) = ? AND archived_at IS NULL`)
    .bind(inv)
    .all<{ id: string }>();
  const ids = (results ?? []).map((r) => r.id);
  if (!ids.length) return;
  if (ids.length === 1) {
    await env.DB
      .prepare(
        `UPDATE schedule_rows SET match_job_id = ?
          WHERE invoice_number = ?
            AND (match_job_id IS NULL OR match_job_id NOT IN (SELECT id FROM jobs))`
      )
      .bind(ids[0], inv)
      .run();
  }
  await syncLoadTimesForJobs(env, ids);
}
