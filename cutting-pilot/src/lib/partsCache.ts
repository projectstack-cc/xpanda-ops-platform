// src/lib/partsCache.ts
// quickwin-04: single client-side cache of the legacy unified parts library (/api/parts).
// Every v2 consumer reads through loadPartsLibrary(); any surface that writes parts calls
// invalidatePartsLibrary() so the next read refetches.
import type { Part } from "@/lib/partMatch";

let cache: Part[] | null = null;
let inflight: Promise<Part[]> | null = null;

export async function loadPartsLibrary(): Promise<Part[]> {
  if (cache) return cache;
  if (inflight) return inflight; // dedupe concurrent first loads (picker + slip match racing)
  inflight = (async () => {
    const res = await fetch("/api/parts");
    const body = await res.json();
    if (!res.ok || !body?.ok) throw new Error("parts load failed");
    cache = (body.parts as Part[]) || [];
    return cache;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function invalidatePartsLibrary(): void {
  cache = null;
}
