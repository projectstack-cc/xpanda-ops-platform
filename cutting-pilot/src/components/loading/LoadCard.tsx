// src/components/loading/LoadCard.tsx
// One active load within a bay tile: customer, invoice #, trailer #, status pill (own status
// color), and "Load N of M" when the job has more than one load. Never blank-crashes on a
// missing trailer #.
import type { LoadingBoardLoad } from "./LoadingBoard";
import { statusVariant } from "./status";

interface LoadCardProps {
  load: LoadingBoardLoad;
}

export default function LoadCard({ load }: LoadCardProps) {
  const variant = statusVariant(load.loading_status);
  const showLoadCount = (load.load_count ?? 1) > 1;

  return (
    <div
      className="rounded-md px-2 py-1.5 border"
      style={{ background: variant.bg, borderColor: variant.border }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-[clamp(0.8rem,1.4vh,1.05rem)] truncate" style={{ color: variant.text }}>
          {load.customer || "—"}
        </span>
        <span
          className="shrink-0 font-mono tabular-nums text-[clamp(0.6rem,1vh,0.75rem)] font-semibold px-1.5 py-[1px] rounded"
          style={{ background: variant.border, color: "var(--primary-text)" }}
        >
          {variant.label}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <span
          className="font-mono tabular-nums text-[clamp(0.7rem,1.2vh,0.9rem)]"
          style={{ color: variant.text }}
        >
          INV# {load.invoice_number || "—"}
        </span>
        <span
          className="font-mono tabular-nums text-[clamp(0.7rem,1.2vh,0.9rem)]"
          style={{ color: variant.text }}
        >
          {load.trailer_number ? `🚛 ${load.trailer_number}` : "— no trailer —"}
        </span>
      </div>
      {showLoadCount && (
        <div
          className="mt-0.5 text-[clamp(0.6rem,1vh,0.75rem)] font-medium"
          style={{ color: variant.text }}
        >
          Load {load.load_number} of {load.load_count}
        </div>
      )}
    </div>
  );
}
