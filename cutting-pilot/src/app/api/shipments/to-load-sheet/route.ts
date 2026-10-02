// src/app/api/shipments/to-load-sheet/route.ts  ->  GET /v2/api/shipments/to-load-sheet?shift=1|2&date=YYYY-MM-DD
// tls-01. Read-only data feed for the 1st / 2nd shift To-Load sheets (lib/logistics/toLoadSheetPdf.ts,
// built client-side by components/logistics/ToLoadSheetButton.tsx). One row per LOAD: each non-archived
// loading_assignment, or max(1, load_count) unassigned placeholders for a job with none. Selection +
// ordering live in lib/logistics/toLoadSheet.ts; this route only fetches and computes labels. Suggested
// pickup reuses the Carrier View math (deliveryTime.ts) + its bounded ORS warm (resolveGeo, warm=true).
// The static `to-load-sheet` segment takes precedence over the sibling `[id]` (same as `loading-sheet/`).
// Gate is inherited from middleware's `/v2/api/shipments` -> `logistics.dashboard` rule.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { addressKeyOf, resolveGeo } from "@/lib/carrier/rows";
import { parseAppointment, suggestedPickup } from "@/lib/deliveryTime";
import { etNowWallClock, formatClockMinutes, weekdayShort } from "@/lib/etDateTime";
import { buildToLoadSheet, shipDayLabel, toLoadWindow, type Shift, type ToLoadRow } from "@/lib/logistics/toLoadSheet";

const IN_CHUNK = 90;
const DELIVERY_MAX_CHARS = 40;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const shiftRaw = (url.searchParams.get("shift") || "").trim();
  const date = (url.searchParams.get("date") || "").trim();

  if (shiftRaw !== "1" && shiftRaw !== "2") {
    return NextResponse.json(
      { ok: false, error: "shift must be 1 or 2.", detail: `Got "${shiftRaw}"` },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { ok: false, error: "date must be YYYY-MM-DD.", detail: `Got "${date}"` },
      { status: 400 }
    );
  }
  const shift = Number(shiftRaw) as Shift;

  const { DB } = await getEnv();

  try {
    const shipDays = toLoadWindow(date);
    const res = await DB.prepare(
      `SELECT s.job_id, substr(s.ship_date, 1, 10) AS ship_day, s.delivery_time AS s_delivery_time,
              j.invoice_number, j.customer, j.load_count, j.delivery_time AS j_delivery_time,
              j.ship_to_street, j.ship_to_street2, j.ship_to_city, j.ship_to_state, j.ship_to_zip
         FROM shipments s JOIN jobs j ON j.id = s.job_id
        WHERE s.direction = 'outbound' AND s.status <> 'cancelled'
          AND s.ship_date IN (${shipDays.map(() => "?").join(",")})
        ORDER BY s.ship_date ASC, CAST(j.invoice_number AS INTEGER) ASC, j.invoice_number ASC`
    )
      .bind(...shipDays)
      .all<any>();

    // Keep the first row per job_id (same dedupe as loading-sheet).
    const seen = new Set<string>();
    const jobs = (res.results ?? []).filter((r: any) => {
      if (!r.job_id || seen.has(r.job_id)) return false;
      seen.add(r.job_id);
      return true;
    });

    // One batched assignments query (chunked IN), never N+1.
    const assignmentsByJob = new Map<string, any[]>();
    const jobIds = jobs.map((j: any) => j.job_id as string);
    for (let i = 0; i < jobIds.length; i += IN_CHUNK) {
      const chunk = jobIds.slice(i, i + IN_CHUNK);
      const ar = await DB.prepare(
        `SELECT la.id AS assignment_id, la.job_id, la.load_number, la.location, la.loading_status, lb.bay_number
           FROM loading_assignments la
           LEFT JOIN loading_bays lb ON lb.id = la.bay_id AND lb.is_active = 1
          WHERE la.job_id IN (${chunk.map(() => "?").join(",")})
            AND la.loading_status <> 'archived'
          ORDER BY la.load_number ASC`
      )
        .bind(...chunk)
        .all<any>();
      for (const a of ar.results ?? []) {
        const list = assignmentsByJob.get(a.job_id) ?? [];
        list.push(a);
        assignmentsByJob.set(a.job_id, list);
      }
    }

    const geo = await resolveGeo(DB, jobs, true);

    const rows: ToLoadRow[] = [];
    for (const j of jobs) {
      const shipDay: string = j.ship_day;
      const key = addressKeyOf(j);
      const g = key ? geo.get(key) : undefined;
      const durationSec = g?.info?.ok ? g.info.duration_sec : null;

      const deliveryText: string = String(j.s_delivery_time || j.j_delivery_time || "").trim();
      const appt = parseAppointment(deliveryText, shipDay);
      let deliveryLabel: string;
      if (appt) {
        const clock = formatClockMinutes(appt.minutes);
        deliveryLabel = appt.date === shipDay ? clock : `${weekdayShort(appt.date)} ${clock}`;
      } else if (deliveryText) {
        deliveryLabel = deliveryText.length > DELIVERY_MAX_CHARS ? deliveryText.slice(0, DELIVERY_MAX_CHARS) : deliveryText;
      } else {
        deliveryLabel = "—";
      }

      const pickup = suggestedPickup(appt, durationSec);
      const pickupEarly = !!pickup && pickup.date !== shipDay;
      const pickupLabel = pickup
        ? pickupEarly
          ? `${weekdayShort(pickup.date)} ${formatClockMinutes(pickup.minutes)}*`
          : formatClockMinutes(pickup.minutes)
        : null;

      const city = String(j.ship_to_city ?? "").trim();
      const state = String(j.ship_to_state ?? "").trim();
      const cityLabel = city && state ? `${city}, ${state}` : city || state;

      const base = {
        job_id: j.job_id as string,
        ship_day: shipDay,
        invoice_number: j.invoice_number != null ? String(j.invoice_number) : null,
        customer: j.customer ?? null,
        load_count: j.load_count != null ? Number(j.load_count) : null,
        city_label: cityLabel,
        delivery_label: deliveryLabel,
        pickup_label: pickupLabel,
        pickup_early: pickupEarly,
      };

      const assignments = assignmentsByJob.get(j.job_id) ?? [];
      if (assignments.length) {
        for (const a of assignments) {
          rows.push({
            ...base,
            assignment_id: a.assignment_id ?? null,
            bay_number: a.bay_number != null ? Number(a.bay_number) : null,
            location: a.location === "yard" ? "yard" : a.location === "bay" ? "bay" : null,
            load_number: Number(a.load_number) || 1,
            loading_status: a.loading_status ?? null,
          });
        }
      } else {
        const n = Math.max(1, Number(j.load_count) || 0);
        for (let k = 1; k <= n; k++) {
          rows.push({ ...base, assignment_id: null, bay_number: null, location: null, load_number: k, loading_status: null });
        }
      }
    }

    const now = etNowWallClock();
    const printedAtEt = `${shipDayLabel(now.date)} ${formatClockMinutes(now.minutes)}`;

    return NextResponse.json({ ok: true, sheet: buildToLoadSheet(rows, shift, date), printed_at_et: printedAtEt });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
