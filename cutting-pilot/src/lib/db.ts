// src/lib/db.ts
// Cloudflare env accessor for route handlers. getCloudflareContext() is async in v0.3.x;
// it uses getPlatformProxy under next dev and reads the real context in workerd.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

export async function getEnv(): Promise<{ DB: D1Database; BOL_PHOTOS: R2Bucket }> {
  const { env } = await getCloudflareContext();
  return { DB: (env as any).DB, BOL_PHOTOS: (env as any).BOL_PHOTOS };
}
