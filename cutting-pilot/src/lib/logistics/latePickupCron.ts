// src/lib/logistics/latePickupCron.ts
// Late Pickup notifications (late-pickup-02). Runs from custom-worker.ts's scheduled() on the
// "*/5 * * * *" cron. Every load fetchDockLoads() reports as late (bay + yard; unassigned queued
// orders are never in that set) gets exactly ONE `loading.late_pickup` notification over the
// assignment's lifetime, via an atomic claim on loading_assignments.late_pickup_notified_at —
// dispatch only when this run won the claim (race-safe if runs overlap; a bay→yard move keeps the
// same assignment id, so it never re-alerts). Cron context: no session, no X-User-*, no cookies,
// and never getCloudflareContext() — the env comes from scheduled().
import type { D1Database } from "@cloudflare/workers-types";
import { dispatchNotification, type PushEnv } from "@/lib/push";
import { fetchDockLoads } from "./latePickup";

export interface LatePickupEnv extends PushEnv {
  DB: D1Database;
}

export async function runLatePickupCheck(env: LatePickupEnv): Promise<void> {
  const loads = await fetchDockLoads(env.DB);
  const late = loads.filter((l) => l.pickup?.late === true);
  let claimed = 0;
  let notified = 0;

  for (const l of late) {
    try {
      const claim = await env.DB.prepare(
        `UPDATE loading_assignments SET late_pickup_notified_at = ?
          WHERE id = ? AND late_pickup_notified_at IS NULL`
      )
        .bind(new Date().toISOString(), l.assignment_id)
        .run();
      if (claim.meta.changes !== 1) continue; // already notified (or another run won the claim)
      claimed++;

      const where = l.location === "yard" ? "Yard" : `Bay ${l.bay_number}`;
      const loadPart = (l.load_count ?? 1) > 1 ? ` (Load ${l.load_number} of ${l.load_count})` : "";
      const message = `${where} · ${l.customer || "—"} · INV# ${l.invoice_number || "—"}${loadPart} · suggested ${l.pickup!.label}`;
      await dispatchNotification(
        env.DB,
        env,
        "loading.late_pickup",
        "Late pickup",
        message,
        "loading_assignment",
        l.assignment_id
      );
      notified++;
    } catch (e) {
      console.error("late-pickup: failed for assignment", l.assignment_id, e);
    }
  }

  if (claimed > 0) console.log(`late-pickup: ${claimed} newly late, ${notified} notified`);
}
