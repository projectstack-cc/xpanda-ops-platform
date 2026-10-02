// src/components/loading/YardBanner.tsx
// Bottom-of-board Yard strip (late-pickup-01): one chip per yard order — invoice #, trailer #,
// "Load X of Y". Renders nothing when the yard is empty. Yard orders often ship on different
// days, so the banner itself never flashes — only a late chip turns red, pulses, and reads
// "Late Pickup" (words + colour, so it stays readable for colour-blind viewers).
import type { LoadingBoardYardLoad } from "./LoadingBoard";

interface YardBannerProps {
  loads: LoadingBoardYardLoad[];
}

export default function YardBanner({ loads }: YardBannerProps) {
  if (loads.length === 0) return null;

  return (
    <div className="shrink-0 flex items-start gap-3 px-3 py-1 border-t border-[var(--line)] bg-[var(--surface-2)]">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted leading-[clamp(1.1rem,1.9vh,1.4rem)]">
        Yard
      </span>
      <div className="flex-1 min-w-0 flex flex-wrap gap-x-4 gap-y-0.5">
        {loads.map((l) => (
          <span
            key={l.assignment_id}
            className={[
              "font-mono tabular-nums whitespace-nowrap text-[clamp(0.7rem,1.2vh,0.9rem)]",
              l.late ? "late-pulse-text" : "text-text",
            ].join(" ")}
          >
            INV# {l.invoice_number || "—"} · 🚛 {l.trailer_number || "— no trailer —"} · Load{" "}
            {l.load_number} of {l.load_count ?? 1}
            {l.late && " · Late Pickup"}
          </span>
        ))}
      </div>
    </div>
  );
}
