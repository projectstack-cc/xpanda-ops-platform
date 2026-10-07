// src/app/api/carrier/signed-bol/route.ts  →  GET /v2/api/carrier/signed-bol?token=…&kind=digital|photo
// carrier-09: streams a load's signed BOL to the carrier — `digital` = the digitally signed PDF
// (bol_documents original_signed, else driver_signed/customer_signed), `photo` = the signed-BOL photo
// (bols.signed_bol_photo_key). Per-load selection via lib/logistics/signedBolDocs.ts — the same rules
// as the logistics board's /v2/api/shipments/signed-bol. Carrier-scoped via resolveCarrierBol (other
// carriers' BOLs 404); gate inherited from the /v2/api/carrier → logistics.carrier_view prefix.
// R2 keys are resolved server-side only — never accepted from, or returned to, the client.
import { getEnv } from "@/lib/db";
import { resolveCarrierBol } from "@/lib/carrier/scope";
import { loadBolDocsForJob, loadKey, pickLoadDocs } from "@/lib/logistics/signedBolDocs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (kind !== "digital" && kind !== "photo") return new Response("Bad kind", { status: 400 });
  try {
    const { DB, BOL_PHOTOS } = await getEnv();
    const bol = await resolveCarrierBol(DB, params.get("token"));
    if (!bol) return new Response("Not found", { status: 404 });

    const { bols, docs } = await loadBolDocsForJob(DB, bol.job_id);
    const load = pickLoadDocs(bols, docs).find((l) => l.load_number === loadKey(bol.load_number));
    const key = kind === "digital" ? load?.signed?.r2_key : load?.photo?.signed_bol_photo_key;
    if (!key) return new Response("Not found", { status: 404 });

    const obj = await BOL_PHOTOS.get(key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body as unknown as ReadableStream, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || (kind === "digital" ? "application/pdf" : "image/jpeg"),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e: any) {
    return new Response(`Server error: ${String(e?.message || e)}`, { status: 500 });
  }
}
