// Post-build: relocate .open-next/assets/_next → .open-next/assets/v2/_next so the
// physical path matches the basePath URL (/v2/_next/...) that the HTML references.
// Cloudflare's Workers asset binding maps request paths literally against files, so
// this relocation is required whenever basePath: "/v2" is set in next.config.mjs.
// Always remove the stale target first — skipping when target exists would silently
// serve old chunks on every build after the first.
//
// Windows note: opennextjs-cloudflare's own build step transiently spawns a workerd
// process (middleware validation) that doesn't always release its file handles on
// _next/static/** before this script runs, making renameSync fail EPERM even after the
// process exits. renameSync is still tried first (fast, atomic); on EPERM, fall back to
// copy+delete, which succeeds because it doesn't require an exclusive handle on the
// source directory's own metadata.
import { existsSync, mkdirSync, rmSync, renameSync, cpSync } from "node:fs";
import { join } from "node:path";

const assets = ".open-next/assets";
const from = join(assets, "_next");
const toDir = join(assets, "v2");
const to = join(toDir, "_next");

if (!existsSync(from)) {
  console.log("Skip relocate: _next not found in assets");
  process.exit(0);
}

mkdirSync(toDir, { recursive: true });

if (existsSync(to)) {
  rmSync(to, { recursive: true, force: true });
  console.log("Removed stale v2/_next");
}

try {
  renameSync(from, to);
  console.log("Relocated _next → v2/_next");
} catch (err) {
  if (err.code !== "EPERM") throw err;
  console.log("renameSync EPERM (stale file lock) — falling back to copy+delete");
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true });
  console.log("Relocated _next → v2/_next (copy+delete)");
}
