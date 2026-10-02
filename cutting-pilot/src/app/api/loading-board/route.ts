// src/app/api/loading-board/route.ts  →  GET/PUT /v2/api/loading-board
// GET: all active loading bays (every active bay present even when empty), each with its
// currently-active load(s) (statuses not_started/loading/loaded — matches logistics/loading.html's
// bay-card logic), the yard loads for the bottom Yard banner, and the board-wide note. Suggested
// pickup + `late` come from the shared lib/logistics/latePickup.ts helper (late-pickup-01) and are
// decided here at request time, so the TV's own clock never matters. PUT: upserts the singleton
// note only — middleware already gates PUT on logistics.loading.tv's edit action, not re-checked here.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { fetchDockLoads, wallClockOrdinal, type DockLoad } from "@/lib/logistics/latePickup";

interface LoadingBoardLoad {
  customer: string | null;
  invoice_number: string | null;
  trailer_number: string | null;
  loading_status: string;
  load_number: number;
  load_count: number | null;
  assignment_id: string;
  suggested_pickup: string | null;
  late: boolean;
}

interface LoadingBoardBay {
  bay_id: string;
  bay_number: number;
  label: string;
  earliest_pickup: string | null;
  late: boolean;
  loads: LoadingBoardLoad[];
}

interface LoadingBoardYardLoad {
  assignment_id: string;
  invoice_number: string | null;
  trailer_number: string | null;
  load_number: number;
  load_count: number | null;
  late: boolean;
}

const NOTES_MAX_LEN = 2000;

const cmpStr = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "");

export async function GET() {
  const { DB } = await getEnv();
  try {
    const [{ results: bayRows }, dockLoads, noteRow] = await Promise.all([
      DB.prepare(
        `SELECT id AS bay_id, bay_number, label FROM loading_bays WHERE is_active = 1 ORDER BY bay_number DESC`
      ).all<{ bay_id: string; bay_number: number; label: string }>(),
      fetchDockLoads(DB),
      DB.prepare(`SELECT notes FROM loading_board_notes WHERE id = 'singleton'`).first<{
        notes: string;
      }>(),
    ]);

    const byBay = new Map<string, DockLoad[]>();
    const yardLoads: DockLoad[] = [];
    for (const l of dockLoads) {
      if (l.location === "yard") yardLoads.push(l);
      else if (l.bay_id) {
        const list = byBay.get(l.bay_id) ?? [];
        list.push(l);
        byBay.set(l.bay_id, list);
      }
    }

    const bays: LoadingBoardBay[] = (bayRows ?? []).map((b) => {
      const loads = (byBay.get(b.bay_id) ?? []).sort(
        (x, y) => x.load_number - y.load_number || cmpStr(x.invoice_number, y.invoice_number)
      );
      let earliest: DockLoad["pickup"] = null;
      for (const l of loads) {
        if (l.pickup && (!earliest || wallClockOrdinal(l.pickup) < wallClockOrdinal(earliest))) {
          earliest = l.pickup;
        }
      }
      return {
        bay_id: b.bay_id,
        bay_number: b.bay_number,
        label: b.label,
        earliest_pickup: earliest?.label ?? null,
        late: loads.some((l) => l.pickup?.late === true),
        loads: loads.map((l) => ({
          customer: l.customer,
          invoice_number: l.invoice_number,
          trailer_number: l.trailer_number,
          loading_status: l.loading_status,
          load_number: l.load_number,
          load_count: l.load_count,
          assignment_id: l.assignment_id,
          suggested_pickup: l.pickup?.label ?? null,
          late: l.pickup?.late === true,
        })),
      };
    });

    const yard: LoadingBoardYardLoad[] = yardLoads
      .sort(
        (x, y) =>
          cmpStr(x.ship_day, y.ship_day) ||
          cmpStr(x.invoice_number, y.invoice_number) ||
          x.load_number - y.load_number
      )
      .map((l) => ({
        assignment_id: l.assignment_id,
        invoice_number: l.invoice_number,
        trailer_number: l.trailer_number,
        load_number: l.load_number,
        load_count: l.load_count,
        late: l.pickup?.late === true,
      }));

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      board_note: noteRow?.notes ?? "",
      bays,
      yard,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const { DB } = await getEnv();
  try {
    const body = await request.json().catch(() => null);
    const notes = typeof body?.notes === "string" ? body.notes : null;
    if (notes === null) {
      return NextResponse.json({ error: "notes must be a string." }, { status: 400 });
    }
    if (notes.length > NOTES_MAX_LEN) {
      return NextResponse.json(
        { error: `notes must be ${NOTES_MAX_LEN} characters or fewer.` },
        { status: 400 }
      );
    }

    const updatedBy = request.headers.get("X-User-Name") || request.headers.get("X-User-Id");

    await DB.prepare(
      `INSERT INTO loading_board_notes (id, notes, updated_at, updated_by)
       VALUES ('singleton', ?, datetime('now'), ?)
       ON CONFLICT(id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    )
      .bind(notes, updatedBy)
      .run();

    return NextResponse.json({ ok: true, notes });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
