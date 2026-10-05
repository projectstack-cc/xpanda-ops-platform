// custom-worker.ts
// wrangler.toml `main` points here instead of the raw OpenNext output, because
// @opennextjs/cloudflare regenerates .open-next/worker.js on every build and its default
// export only has `fetch` — there's nowhere in the generated file to hang a cron handler.
// This re-exports that generated fetch handler unchanged and adds `scheduled()` alongside it.
// ONE cron, "*/5 * * * *": every run = late-pickup check (late-pickup-02); runs whose scheduled
// UTC minute is a multiple of 10 also run the schedule ingest (keeps its 10-min cadence).
// Every run also does the cutting shift-risk check (shift-alert-01; no-op outside its checkpoint windows).
// late-pickup-03: do NOT go back to two crons branched on controller.cron — with "*/10" + "*/5"
// on one Worker, Cloudflare delivered two events every 10 min, BOTH labeled "*/10 * * * *", and
// none at :05/:15, so the "*/5" branch never ran.
// A cron handler has no path — do not add any public route here.
import type { ExecutionContext, ExportedHandler, ScheduledController } from "@cloudflare/workers-types";
import openNextHandler from "./.open-next/worker.js";
import { runSchedulePoll, type ScheduleEnv } from "./src/lib/schedule-ingest";
import { runLatePickupCheck, type LatePickupEnv } from "./src/lib/logistics/latePickupCron";
import { runShiftRiskCheck, type ShiftRiskEnv } from "./src/lib/cutting/shiftRiskCron";

export default {
  fetch: openNextHandler.fetch,

  async scheduled(
    controller: ScheduledController,
    env: ScheduleEnv & LatePickupEnv & ShiftRiskEnv,
    ctx: ExecutionContext
  ) {
    // Scheduled context has no user session — the poller never injects X-User-*, never sets cookies.
    ctx.waitUntil(
      runLatePickupCheck(env).catch((err) => console.error("late-pickup: scheduled run failed", err))
    );
    ctx.waitUntil(
      runShiftRiskCheck(env).catch((err) => console.error("shift-risk: scheduled run failed", err))
    );
    if (new Date(controller.scheduledTime).getUTCMinutes() % 10 !== 0) return;
    ctx.waitUntil(
      runSchedulePoll(env).catch((err) => {
        console.error("schedule-ingest: scheduled run failed", err);
      })
    );
  },
} satisfies ExportedHandler<ScheduleEnv & LatePickupEnv & ShiftRiskEnv>;
