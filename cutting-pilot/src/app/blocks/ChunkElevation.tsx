"use client";
// Per-chunk SVG side elevation (length × height), scaled to the real block face — aspect-correct,
// never forced square. Bands = paired-taper rectangles, alternating diagonal lean band-to-band.
// A band shorter than the chunk (length end) or width-trimmed shows a shaded "→ pool" region.
import type { BlockSize, NestChunk } from "@/lib/blockTypes";

const PX_WIDTH = 360;
const EPS = 1e-6;

interface Props {
  chunk: NestChunk;
  block: BlockSize;
}

export default function ChunkElevation({ chunk, block }: Props) {
  const lengthIn = Math.max(chunk.length, 1);
  const heightIn = Math.max(block.height, 1);
  const pxHeight = Math.round((PX_WIDTH * heightIn) / lengthIn);

  // Reconstruct bands from aggregated lines — each line's qty (finished pieces) implies
  // ceil(qty/2) paired-taper rectangles, since a full-height band is cut whether its second
  // piece ships or becomes the odd-qty scrap complement (the geometry doesn't change either way).
  const bands = chunk.lines.flatMap((line, lineIdx) => {
    const bandCount = Math.max(1, Math.ceil(line.qty / 2));
    return Array.from({ length: bandCount }, (_, bandIdx) => ({ line, key: `${lineIdx}-${bandIdx}` }));
  });

  let yCursor = 0;
  const drawn = bands.map(({ line, key }, i) => {
    const bandHeight = line.tlo + line.thi + 0.25;
    const y = yCursor;
    yCursor += bandHeight;
    const gap = chunk.length - line.partLength;
    const showPool = gap > EPS || !!line.trimmedFrom;
    const leanReversed = i % 2 === 1;

    // Taper cut: a single diagonal splits the band into the wedge + its inverted complement.
    // Alternates lean direction band-to-band so adjacent bands read as opposing wedges.
    const x0 = 0;
    const x1 = line.partLength;
    const yThin = y + (leanReversed ? line.thi : line.tlo);
    const yThick = y + (leanReversed ? line.tlo : line.thi);

    return (
      <g key={key}>
        <rect
          x={x0}
          y={y}
          width={line.partLength}
          height={bandHeight}
          style={{ fill: "var(--surface)", stroke: "var(--border)" }}
          strokeWidth={0.15}
        />
        <line
          x1={x0}
          y1={yThin}
          x2={x1}
          y2={yThick}
          style={{ stroke: "var(--muted)" }}
          strokeWidth={0.12}
        />
        {showPool && (
          <>
            <rect
              x={x1}
              y={y}
              width={Math.max(gap, 0)}
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
      {bands.some((b) => chunk.length - b.line.partLength > EPS || b.line.trimmedFrom) && (
        <div className="px-2 py-1 text-[10px] text-[var(--warn-text)] bg-[var(--warn-bg)] border-t border-[var(--warn-border)]">
          Shaded band(s) → pool (unused offcut)
        </div>
      )}
    </div>
  );
}
