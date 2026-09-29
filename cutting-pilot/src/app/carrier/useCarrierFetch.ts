"use client";
// src/app/carrier/useCarrierFetch.ts
// Shared fetch + 60s poll for every Carrier View tab (carrier-04; extracted from CarrierBoard's
// original load()). Polls only while `active`, so a hidden tab never hits the server. Keeps the
// original transient-error handling exactly: 503 (auth layer's D1 blip) and an unconfirmed 401
// never read as "logged out" — whatever's already on screen stays, and the next tick retries.
import { useCallback, useEffect, useRef, useState } from "react";

export const CARRIER_REFRESH_MS = 60_000;

export function useCarrierFetch<T extends { ok: boolean; error?: string }>(url: string, active: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasGoodDataRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(url);

      // 503 = the auth layer's D1 lookup blipped — transient, not a session verdict.
      // Never treat it as logged-out; keep whatever's already on screen and retry next tick.
      if (res.status === 503) {
        if (!hasGoodDataRef.current) setError("Reconnecting…");
        return;
      }

      // 401 from a background poll could be a genuinely dead session, or a stray one-off.
      // Confirm against the auth endpoint before showing anything scarier than "reconnecting."
      if (res.status === 401) {
        let confirmedGone = true;
        try {
          const confirmRes = await fetch("/api/auth/me");
          confirmedGone = !confirmRes.ok;
        } catch {
          confirmedGone = false;
        }
        if (!confirmedGone) {
          if (!hasGoodDataRef.current) setError("Reconnecting…");
          return;
        }
        setError("Signed out — sign back in to resume.");
        return;
      }

      const json: T = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "Failed to load.");
        return;
      }
      hasGoodDataRef.current = true;
      setData(json);
      setError(null);
    } catch {
      if (!hasGoodDataRef.current) setError("Network error — could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!active) return;
    load();
    const id = setInterval(load, CARRIER_REFRESH_MS);
    return () => clearInterval(id);
  }, [active, load]);

  return { data, error, loading, load };
}
