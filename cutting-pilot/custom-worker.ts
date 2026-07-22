// custom-worker.ts
// wrangler.toml `main` points here instead of the raw OpenNext output, because
// @opennextjs/cloudflare regenerates .open-next/worker.js on every build and its default
// export only has `fetch` — there's nowhere in the generated file to hang a cron handler.
// This re-exports that generated fetch handler unchanged and adds `scheduled()` alongside it.
// A cron handler has no path — do not add any public route here.
import type { ExecutionContext, ExportedHandler, ScheduledController } from "@cloudflare/workers-types";
import openNextHandler from "./.open-next/worker.js";
import { runSchedulePoll, type ScheduleEnv } from "./src/lib/schedule-ingest";

export default {
  fetch: openNextHandler.fetch,

  async scheduled(_controller: ScheduledController, env: ScheduleEnv, ctx: ExecutionContext) {
    // Scheduled context has no user session — the poller never injects X-User-*, never sets cookies.
    ctx.waitUntil(
      runSchedulePoll(env).catch((err) => {
        console.error("schedule-ingest: scheduled run failed", err);
      })
    );
  },
} satisfies ExportedHandler<ScheduleEnv>;
