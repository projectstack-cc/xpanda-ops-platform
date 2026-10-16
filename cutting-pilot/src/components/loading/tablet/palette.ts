// src/components/loading/tablet/palette.ts
// dock-10: light-only page (forced in layout.tsx); single source for the tablet's neutrals.
// Values that equal an existing LIGHT token in globals.css use the token; the rest are defined
// here once. Status colours stay in ../status.ts.
export const DOCK_TABLET = {
  pageBg: "#eef1f5",
  surface: "var(--surface)", // #ffffff
  ink: "var(--text)", // #111827
  muted: "var(--muted)", // #4b5563
  faint: "var(--text-faint)", // #94a3b8
  cardBorder: "var(--line)", // #e5e7eb
  btnBorder: "var(--input-border)", // #d1d5db

  // Header bar
  headerBg: "var(--accent)", // #0f172a
  headerInk: "#f8fafc",
  headerMuted: "#cbd5e1",
  headerBtnBg: "var(--primary-bg)", // #1e293b
  headerBtnBorder: "#334155",
  brand: "var(--brand)",
  liveDot: "var(--success-bg)",
  reconnectDot: "#f59e0b",

  // Empty bay
  emptyTileBorder: "var(--input-border)", // #d1d5db
  emptyTileBg: "#f8fafc",
  emptyBandBg: "var(--accent-soft)", // #f1f5f9
  emptyInk: "#374151",
  emptyDash: "#cbd5e1",

  // Loaded "Ready for pickup" panel
  readyBg: "#ecfdf5",
  readyBorder: "#a7f3d0",
  readyInk: "var(--loaded-text)", // #065f46

  // "Load 1 of 2"
  loadOf: "#4338ca",

  // Bay picker
  pickerBackdrop: "var(--accent)", // #0f172a
  pickerSelectedBg: "var(--accent)",
  pickerSelectedInk: "var(--surface)", // white
  pickerCaption: "#cbd5e1",
  pickerTileBg: "#f8fafc",
  pickerTileInk: "#374151",
} as const;
