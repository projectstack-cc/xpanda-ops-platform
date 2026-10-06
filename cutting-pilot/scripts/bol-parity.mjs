// scripts/bol-parity.mjs
// Visual parity harness for bolShared.ts (P435, unit 1 of the logistics v2 migration).
//
// Renders ONE BOL from the same fixture data logistics/bol-test.html uses (its `DUMMY` object),
// through the same BLANK_BOL_Xpanda.pdf template + FRSCRIPT.TTF cursive font + Liberation Sans
// body fonts (bol-print-01) legacy uses, and
// writes the result to cutting-pilot/bol-v2-sample.pdf. Open that file next to a legacy-generated
// sample (render the same DUMMY fixture through logistics/bol-test.html) to confirm pixel parity.
//
// Run with: node scripts/bol-parity.mjs   (from cutting-pilot/; Node 22.6+/23.6+ strips bolShared's
// TypeScript syntax natively — no build step needed).
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePdf, isLikelyFontBytes, BODY_FONT_ASSET_PATHS } from "../src/lib/bolShared.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", ".."); // cutting-pilot/scripts -> cutting-pilot -> repo root
const assetsDir = join(repoRoot, "logistics", "assets");

// Same fixture object as logistics/bol-test.html's `DUMMY` (P435 prompt: "reuse the same fixture
// data legacy's bol-test.html uses so both render identical input").
const DUMMY = {
  delivery_time: "DELIVERY 8:00 AM",
  date: "2026-06-05",
  bol_number: "TEST-BOL-001",
  carrier_name: "ABC Carrier Co",
  trailer_no: "TRLR-9999",
  ship_to_company: "ABC Company",
  ship_to_attention: "John Tester",
  ship_to_street: "123 Test St",
  ship_to_street2: "Suite 100",
  ship_to_city: "Testville",
  ship_to_state: "FL",
  ship_to_zip: "33000",
  contact_name: "Jane Tester",
  contact_phone: "555-0100",
  po_number: "PO-TEST-456",
  commodity_description: "TEST COMMODITY — Foam Blocks 12x12x12, Qty 40",
  special_instructions: "TEST special instructions line one\nTEST line two",
  is_scrap_pickup: true,
  access_token: "TESTTOKEN123",
  shipper_name: "Sample Shipper",
};

async function main() {
  const templatePath = join(assetsDir, "BLANK_BOL_Xpanda.pdf");
  const fontPath = join(assetsDir, "FRSCRIPT.TTF");

  if (!existsSync(templatePath)) {
    console.error("bol-parity: template not found at", templatePath);
    process.exit(1);
  }

  const templateBytes = new Uint8Array(await readFile(templatePath));

  let scriptFontBytes = null;
  if (existsSync(fontPath)) {
    const fontBytes = new Uint8Array(await readFile(fontPath));
    scriptFontBytes = isLikelyFontBytes(fontBytes) ? fontBytes : null;
    if (!scriptFontBytes) {
      console.warn("bol-parity: FRSCRIPT.TTF failed the font-signature check, rendering without a signature");
    }
  } else {
    console.warn("bol-parity: FRSCRIPT.TTF not found at", fontPath, "- rendering without a signature");
  }

  // bol-print-01: the embedded Liberation Sans body faces, read from the same paths the browser
  // callers fetch (BODY_FONT_ASSET_PATHS are site-root paths under logistics/assets/fonts/).
  let bodyFontBytes = {};
  for (const [key, sitePath] of Object.entries(BODY_FONT_ASSET_PATHS)) {
    const diskPath = join(repoRoot, ...sitePath.split("/").filter(Boolean));
    const bytes = existsSync(diskPath) ? new Uint8Array(await readFile(diskPath)) : null;
    if (!bytes || !isLikelyFontBytes(bytes)) {
      console.warn("bol-parity: body font missing or invalid at", diskPath, "- rendering with unembedded Helvetica");
      bodyFontBytes = null;
      break;
    }
    bodyFontBytes[key] = bytes;
  }

  const pdfBytes = await generatePdf([DUMMY], {
    templateBytes,
    scriptFontBytes,
    bodyFontBytes,
    trackingBaseUrl: "https://www.xpandaops.com",
  });

  const outPath = join(here, "..", "bol-v2-sample.pdf");
  await writeFile(outPath, pdfBytes);
  console.log(`bol-parity: wrote ${pdfBytes.length} bytes to ${outPath}`);
}

main().catch((err) => {
  console.error("bol-parity: failed", err);
  process.exit(1);
});
