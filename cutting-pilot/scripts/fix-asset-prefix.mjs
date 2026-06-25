// Post-build: relocate .open-next/assets/_next → .open-next/assets/v2/_next so the
// physical path matches the basePath URL (/v2/_next/...) that the HTML references.
// Cloudflare's Workers asset binding maps request paths literally against files, so
// this relocation is required whenever basePath: "/v2" is set in next.config.mjs.
// Always remove the stale target first — skipping when target exists would silently
// serve old chunks on every build after the first.
import { existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
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

renameSync(from, to);
console.log("Relocated _next → v2/_next");
