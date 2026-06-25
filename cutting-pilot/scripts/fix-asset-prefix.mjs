// Post-build: relocate .open-next/assets/_next → .open-next/assets/v2/_next so the
// physical path matches the basePath URL (/v2/_next/...) that the HTML references.
// Cloudflare's Workers asset binding maps request paths literally against files, so
// this relocation is required whenever basePath: "/v2" is set in next.config.mjs.
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const assets = ".open-next/assets";
const from = join(assets, "_next");
const toDir = join(assets, "v2");
const to = join(toDir, "_next");

if (existsSync(from) && !existsSync(to)) {
  mkdirSync(toDir, { recursive: true });
  renameSync(from, to);
  console.log("Relocated _next → v2/_next");
} else {
  console.log("Skip relocate: from missing or target exists");
}
