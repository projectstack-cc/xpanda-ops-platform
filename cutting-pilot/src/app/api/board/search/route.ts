// src/app/api/board/search/route.ts  →  GET /v2/api/board/search?q=<text>
// board-search-01: server-side search for the jobs the board feed does NOT carry — archived
// and shipped (any job outside `archived_at IS NULL AND status IN (active four)`). The client
// already holds the active jobs, so returning only the rest avoids duplicates. Same row shape as
// GET /v2/api/board (shared loadBoardRows). Read-only; gated on `jobs` (view) by the existing
// /v2/api/board PERMISSION_MAP prefix. Capped at 100 rows (`truncated: true` when more match).
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { loadBoardRows } from "@/lib/boardRows";

const MAX_RESULTS = 100;

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ ok: true, jobs: [] });

  try {
    const { DB } = await getEnv();
    // Escape LIKE wildcards so `%` / `_` in the query match literally. SQLite LIKE is
    // case-insensitive for ASCII.
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const cols = [
      "j.customer",
      "j.invoice_number",
      "j.po_number",
      "j.ship_to_company",
      "j.ship_to_city",
      "j.ship_to_state",
    ];
    const where = `NOT (j.archived_at IS NULL AND j.status IN ('not_started','in_production','done','loading'))
       AND (
         ${cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join("\n         OR ")}
         OR EXISTS (SELECT 1 FROM job_assignments ja JOIN users u ON u.id = ja.user_id
                     WHERE ja.job_id = j.id AND u.display_name LIKE ? ESCAPE '\\')
       )`;
    const binds = [...cols.map(() => like), like];

    // Fetch one extra row to know whether the cap was hit.
    const rows = await loadBoardRows(DB, where, binds, "j.ship_date DESC", MAX_RESULTS + 1);
    const truncated = rows.length > MAX_RESULTS;
    return NextResponse.json({
      ok: true,
      jobs: truncated ? rows.slice(0, MAX_RESULTS) : rows,
      ...(truncated ? { truncated: true } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Search failed.", detail: String(e?.message || e) }, { status: 500 });
  }
}
