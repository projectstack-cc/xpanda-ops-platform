// saf-01 selfcheck: `npx tsx src/lib/safety/trainingBlocks.selfcheck.ts` (from cutting-pilot/).
import { TRAINING_BLOCKS, mediaUrls, readyBlocks, getBlock } from "./trainingBlocks";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); }
};

const ids = TRAINING_BLOCKS.map((b) => b.id);
check("9 blocks", ids.length === 9, String(ids.length));
check("ids unique", new Set(ids).size === ids.length);
check("ids in order", ids.every((id, i) => id === `block-0${i + 1}`), ids.join(","));
check("n matches id", TRAINING_BLOCKS.every((b) => b.id === `block-${b.n}`));

const expectVideos: Record<string, number> = { "block-01": 4, "block-02": 4, "block-03": 3, "block-04": 2 };
for (const [id, n] of Object.entries(expectVideos)) {
  const b = getBlock(id)!;
  check(`${id} ready`, b.ready === true);
  check(`${id} ${n} videos`, b.videos.length === n, String(b.videos.length));
  check(`${id} has folder`, b.folder.startsWith(`${id}-`), b.folder);
  check(`${id} file = key.mp4`, b.videos.every((v) => v.file === `${v.key}.mp4`));
}
for (const id of ["block-05", "block-06", "block-07", "block-08", "block-09"]) {
  const b = getBlock(id)!;
  check(`${id} not ready`, b.ready === false);
  check(`${id} no videos`, b.videos.length === 0);
}
check("readyBlocks = 01..04", readyBlocks().map((b) => b.id).join(",") === "block-01,block-02,block-03,block-04");
check("getBlock unknown → undefined", getBlock("block-99") === undefined);
check("minutes 47/47/43/26/47/41/47/29/26", TRAINING_BLOCKS.map((b) => b.minutes).join("/") === "47/47/43/26/47/41/47/29/26");

// Hard-coded legacy URLs (one per ready block), as legacy setMedia builds them.
const R2 = "https://pub-6fa76f0673dd4d7190bb9f79bb59b77d.r2.dev/training-media";
const legacy: Array<[string, number, string]> = [
  ["block-01", 0, `${R2}/block-01-new-hire-core/general-safety-orientation`],
  ["block-02", 0, `${R2}/block-02-walking-lockout/lockout-tagout`],
  ["block-03", 2, `${R2}/block-03-physical-injury/eyewash-and-safety-shower`],
  ["block-04", 0, `${R2}/block-04-fall-heat-exposure/fall_protection`],
];
for (const [id, i, base] of legacy) {
  const b = getBlock(id)!;
  const u = mediaUrls(b, b.videos[i]);
  check(`${id} mp4 url`, u.mp4 === `${base}.mp4`, u.mp4);
  check(`${id} es vtt url`, u.vttEs === `${base}-es.vtt`, u.vttEs);
  check(`${id} ht vtt url`, u.vttHt === `${base}-ht.vtt`, u.vttHt);
}
// Legacy setMedia order per page.
check("block-02 order (setMedia)", getBlock("block-02")!.videos.map((v) => v.key).join(",") === "lockout-tagout,machine-guarding,walking-working-surfaces,slips-trips-falls");

console.log(`trainingBlocks selfcheck: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
