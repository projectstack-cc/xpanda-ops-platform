"use client";
// src/app/carrier/CarrierMiniMap.tsx
// Non-interactive ~120px destination minimap for a carrier load tile (carrier-03). Leaflet touches
// `window` at import, so CarrierBoard loads this ONLY via next/dynamic with ssr:false. The map
// itself is lazy-mounted (IntersectionObserver) so a 10-load day doesn't init 10 maps up front.
// circleMarker (SVG) instead of L.marker avoids the bundler default-icon-image bug. Tapping the
// map opens Google Maps for the address in a new tab.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Props {
  lat: number;
  lng: number;
  address: string;
}

// SVG path attributes can't resolve var(--token) — resolve the token to a concrete color at runtime.
function tokenColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function CarrierMiniMap({ lat, lng, address }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !mapElRef.current) return;
    const map = L.map(mapElRef.current, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      attributionControl: true,
    }).setView([lat, lng], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    const brand = tokenColor("--brand", "currentColor");
    L.circleMarker([lat, lng], {
      radius: 7,
      color: brand,
      weight: 2,
      fillColor: brand,
      fillOpacity: 0.85,
      interactive: false,
    }).addTo(map);
    return () => {
      map.remove();
    };
  }, [visible, lat, lng]);

  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

  return (
    <div
      ref={boxRef}
      className="relative mt-3 h-[120px] rounded-md overflow-hidden border border-[var(--border)] bg-[var(--ghost-bg)]"
    >
      <div ref={mapElRef} className="absolute inset-0" aria-hidden="true" />
      {/* Full-size tap target above Leaflet's panes (z-index 400+). */}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${address} in Google Maps`}
        className="absolute inset-0 z-[1000]"
      />
    </div>
  );
}
