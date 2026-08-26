"use client";
// Per-chunk SVG side elevation (length × height), scaled to the real block face — aspect-correct,
// never forced square. Bands = paired-taper rectangles, alternating diagonal lean band-to-band.
// A band shorter than the chunk (length end), width-trimmed, or a lone wedge's complement shows a
// shaded "→ pool" region.
import type { BlockSize, NestChunk } from "@/lib/blockTypes";

const PX_WIDTH = 360;
const EPS = 1e-6;
const TAPER_KERF = 0.25;

interface Props {
  chunk: NestChunk;
  block: BlockSize;
}

interface Band {
  line: NestChunk["lines"][number];
  key: string;
  isLoneWedge: boolean;
}

export default function ChunkElevation({ chunk, block }: Props) {
  const lengthIn = Math.max(chunk.length, 1);
  const heightIn = Math.max(block.height, 1);
  const pxHeight = Math.round((PX_WIDTH * heightIn) / lengthIn);

  // Reconstruct bands from aggregated lines. qty is finished pieces for this line within this
  // chunk; a full paired band represents 2 pieces (tlo+thi+kerf tall). An ODD qty means exactly
  // one contributing placement was a lone wedge (only its thick-end height, thi) — its complement
  // (tlo+kerf tall) never got cut as a full band, so it's shown as offcut → pool.
  const bands: Band[] = chunk.lines.flatMap((line, lineIdx) => {
    const pairedCount = Math.floor(line.qty / 2);
    const hasLoneWedge = line.qty % 2 === 1;
    const out: Band[] = Array.from({ length: pairedCount }, (_, bandIdx) => ({
      line,
      key: `${lineIdx}-p${bandIdx}`,
      isLoneWedge: false,
    }));
    if (hasLoneWedge) out.push({ line, key: `${lineIdx}-lone`, isLoneWedge: true });
    return out;
  });

  // A lone wedge only reserves its thick-end height (thi) in the stack — same as the packer's
  // own ledger (Rect.height) — because its complement (tlo+kerf) is a byproduct that goes to the
  // pool, not additional stack height consumed here. It's called out with a dashed top edge
  // rather than drawn as its own box: unlike the length/width offcuts above, it has no fixed
  // location in this diagram's own length x height plane (it's routed to the general pool).
  let yCursor = 0;
  const drawn = bands.map(({ line, key, isLoneWedge }, i) => {
    const bandHeight = isLoneWedge ? line.thi : line.tlo + line.thi + TAPER_KERF;
    const y = yCursor;
    yCursor += bandHeight;
    const lengthGap = chunk.length - line.partLength;
    const showLengthPool = lengthGap > EPS || !!line.trimmedFrom;
    const leanReversed = i % 2 === 1;

    // Taper cut: a single diagonal splits a paired band into the wedge + its inverted mate.
    // Alternates lean direction band-to-band so adjacent bands read as opposing wedges. A lone
    // wedge has no mate — it draws as a single diagonal across its own thi-tall footprint.
    const x0 = 0;
    const x1 = line.partLength;
    const yThin = isLoneWedge ? y + line.thi : y + (leanReversed ? line.thi : line.tlo);
    const yThick = isLoneWedge ? y : y + (leanReversed ? line.tlo : line.thi);

    return (
      <g key={key}>
        <rect
          x={x0}
          y={y}
          width={line.partLength}
          height={bandHeight}
          style={{ fill: "var(--surface)", stroke: "var(--border)" }}
          strokeWidth={0.15}
          strokeDasharray={isLoneWedge ? "0.6,0.4" : undefined}
        />
        <line
          x1={x0}
          y1={yThin}
          x2={x1}
          y2={yThick}
          style={{ stroke: "var(--muted)" }}
          strokeWidth={0.12}
        />
        {showLengthPool && (
          <>
            <rect
              x={x1}
              y={y}
              width={Math.max(lengthGap, 0)}
              height={bandHeight}
              style={{ fill: "var(--warn-bg)", stroke: "var(--warn-border)" }}
              strokeWidth={0.1}
            />
            <line
              x1={x1}
              y1={y}
              x2={x1}
              y2={y + bandHeight}
              style={{ stroke: "var(--warn-text)" }}
              strokeWidth={0.2}
              strokeDasharray="1,0.6"
            />
          </>
        )}
      </g>
    );
  });

  const usedHeight = yCursor;
  const heightLeftover = heightIn - usedHeight;
  const hasLoneWedge = bands.some((b) => b.isLoneWedge);

  return (
    <div className="border border-border rounded overflow-hidden bg-[var(--surface-2)]">
      <svg
        viewBox={`0 0 ${lengthIn} ${heightIn}`}
        width="100%"
        height={pxHeight}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Cut diagram: chunk ${chunk.width}" wide, ${chunk.length}" long`}
      >
        <rect x={0} y={0} width={lengthIn} height={heightIn} style={{ fill: "var(--surface)" }} />
        {drawn}
        {heightLeftover > EPS && (
          <rect
            x={0}
            y={usedHeight}
            width={lengthIn}
            height={heightLeftover}
            style={{ fill: "var(--ghost-bg)" }}
          />
        )}
        <rect
          x={0}
          y={0}
          width={lengthIn}
          height={heightIn}
          style={{ fill: "none", stroke: "var(--line)" }}
          strokeWidth={0.25}
        />
      </svg>
      {(bands.some((b) => chunk.length - b.line.partLength > EPS || b.line.trimmedFrom) ||
        hasLoneWedge) && (
        <div className="px-2 py-1 text-[10px] text-[var(--warn-text)] bg-[var(--warn-bg)] border-t border-[var(--warn-border)]">
          Shaded band(s) → pool (unused offcut){hasLoneWedge && " · dashed band(s) = lone wedge, byproduct → pool"}
        </div>
      )}
    </div>
  );
}
