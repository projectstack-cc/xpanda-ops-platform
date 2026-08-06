// Post-build: copy pdfjs-dist's worker file straight from node_modules into
// .open-next/assets/v2/pdf.worker.min.mjs, bypassing webpack/Terser entirely.
// Next's Terser pass minifies emitted `.mjs` chunks as non-module scripts and chokes on the
// worker's own `import`/`export` statements when it's routed through webpack's `new URL(...,
// import.meta.url)` asset-module handling — so this file is deliberately never bundled.
// The physical path here must match the literal `workerSrc` string set in
// src/lib/packingSlip.ts ("/v2/pdf.worker.min.mjs") — same "asset PATH must match the asset
// URL" discipline as fix-asset-prefix.mjs's `_next` relocation (P205 lesson).
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const destDir = join(here, "..", ".open-next", "assets", "v2");
const dest = join(destDir, "pdf.worker.min.mjs");

if (!existsSync(src)) {
  console.error("copy-pdf-worker: source not found at", src);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("Copied pdf.worker.min.mjs → .open-next/assets/v2/pdf.worker.min.mjs");
