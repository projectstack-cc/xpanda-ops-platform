// custom-worker.ts
// wrangler.toml `main` points here instead of the raw OpenNext output, because
// @opennextjs/cloudflare regenerates .open-next/worker.js on every build and its default
// export only has `fetch` — there's nowhere in the generated file to hang a cron handler.
// This re-exports that generated fetch handler unchanged and adds `scheduled()` alongside it.
// Two crons, branched on controller.cron: "*/5 * * * *" = late-pickup check (late-pickup-02),
// anything else ("*/10 * * * *") = schedule ingest.
// A cron handler has no path — do not add any public route here.
import type { ExecutionContext, ExportedHandler, ScheduledController } from "@cloudflare/workers-types";
import openNextHandler from "./.open-next/worker.js";
import { runSchedulePoll, type ScheduleEnv } from "./src/lib/schedule-ingest";
import { runLatePickupCheck, type LatePickupEnv } from "./src/lib/logistics/latePickupCron";

export default {
  fetch: openNextHandler.fetch,

  async scheduled(controller: ScheduledController, env: ScheduleEnv & LatePickupEnv, ctx: ExecutionContext) {
    // Scheduled context has no user session — the poller never injects X-User-*, never sets cookies.
    if (controller.cron === "*/5 * * * *") {
      ctx.waitUntil(
        runLatePickupCheck(env).catch((err) => console.error("late-pickup: scheduled run failed", err))
      );
      return;
    }
    ctx.waitUntil(
      runSchedulePoll(env).catch((err) => {
        console.error("schedule-ingest: scheduled run failed", err);
      })
    );
  },
} satisfies ExportedHandler<ScheduleEnv & LatePickupEnv>;
