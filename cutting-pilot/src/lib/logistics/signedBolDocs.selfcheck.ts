// src/lib/logistics/signedBolDocs.selfcheck.ts
// Guarded dev self-check for signedBolDocs.ts pickLoadDocs (carrier-09). Mirrors
// latePickup.selfcheck.ts's shape: a check()/results table, one exported run*SelfCheck()
// function. Not part of the production build path.
import { pickLoadDocs, type SignedBolDoc, type SignedBolRow } from "./signedBolDocs";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const bol = (id: string, load_number: number | null, created_at: string, photo: string | null = null): SignedBolRow => ({
  id,
  bol_number: id.toUpperCase(),
  load_number,
  load_count: 2,
  signed_bol_photo_key: photo,
  created_at,
});
const doc = (id: string, bol_id: string, doc_type: string, created_at: string): SignedBolDoc => ({
  id,
  bol_id,
  doc_type,
  created_at,
  r2_key: `k/${id}`,
});

export function runSignedBolDocsSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

  // original_signed beats a NEWER driver_signed.
  {
    const loads = pickLoadDocs(
      [bol("b1", 1, "2026-10-01")],
      [doc("d-drv", "b1", "driver_signed", "2026-10-03"), doc("d-orig", "b1", "original_signed", "2026-10-02")]
    );
    eq("original_signed beats driver_signed", loads[0]?.signed?.id, "d-orig");
  }
  // driver/customer_signed is the fallback, newest wins.
  {
    const loads = pickLoadDocs(
      [bol("b1", 1, "2026-10-01")],
      [doc("d-old", "b1", "customer_signed", "2026-10-01"), doc("d-new", "b1", "driver_signed", "2026-10-02")]
    );
    eq("legacy signed fallback newest", loads[0]?.signed?.id, "d-new");
  }
  // A signature on an OLDER BOL row of the same load is still found after a regenerate.
  {
    const loads = pickLoadDocs(
      [bol("b-old", 2, "2026-10-01"), bol("b-new", 2, "2026-10-05")],
      [doc("d-sig", "b-old", "original_signed", "2026-10-02")]
    );
    eq("older BOL row signature found", loads[0]?.signed?.id, "d-sig");
    eq("rows newest first", loads[0]?.rows.map((r) => r.id), ["b-new", "b-old"]);
  }
  // NULL load_number groups as load 0, separate from load 1.
  {
    const loads = pickLoadDocs(
      [bol("b-null", null, "2026-10-01"), bol("b-one", 1, "2026-10-01")],
      [doc("d0", "b-null", "original_signed", "2026-10-02")]
    );
    eq("NULL load_number → 0", loads.map((l) => l.load_number), [0, 1]);
    eq("load 0 has its doc", loads[0]?.signed?.id, "d0");
    eq("load 1 unsigned", loads[1]?.signed, null);
  }
  // Photo: newest BOL row WITH a photo key wins, even when the newest row has none.
  {
    const loads = pickLoadDocs(
      [
        bol("b-a", 1, "2026-10-01", "p/a"),
        bol("b-b", 1, "2026-10-03", "p/b"),
        bol("b-c", 1, "2026-10-05", null),
      ],
      []
    );
    eq("photo precedence", loads[0]?.photo?.id, "b-b");
  }
  // carrier_upload is independent of the signed pick; docs from other loads don't leak.
  {
    const loads = pickLoadDocs(
      [bol("b1", 1, "2026-10-01"), bol("b2", 2, "2026-10-01")],
      [doc("c1", "b1", "carrier_upload", "2026-10-02"), doc("s2", "b2", "original_signed", "2026-10-02")]
    );
    eq("carrier copy on load 1", loads[0]?.carrier?.id, "c1");
    eq("no signed leak into load 1", loads[0]?.signed, null);
    eq("no carrier leak into load 2", loads[1]?.carrier, null);
  }

  return { pass: results.every((r) => r.pass), results };
}
