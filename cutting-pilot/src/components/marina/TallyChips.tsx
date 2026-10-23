// src/components/marina/TallyChips.tsx — marina-04
// Piece-status chips for a Marina job or part: Parts (jobs only) · Pieces · "N good" (pass + accepted,
// split in the tooltip / aria-label) · Scrapped (only when > 0). The rework badge is rendered by the
// caller (it's more prominent than a chip).
import type { MarinaTallies } from "@/lib/marina/types";
import { CHIP_DANGER, CHIP_GOOD, CHIP_NEUTRAL } from "./ui";

interface Props {
  tallies: Omit<MarinaTallies, "parts"> & { parts?: number };
}

export default function TallyChips({ tallies }: Props) {
  const good = tallies.pass + tallies.accepted;
  const split = `${tallies.pass} passed first time, ${tallies.accepted} accepted after rework`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tallies.parts !== undefined && <span className={CHIP_NEUTRAL}>Parts {tallies.parts}</span>}
      <span className={CHIP_NEUTRAL}>Pieces {tallies.pieces}</span>
      <span className={CHIP_GOOD} title={split} aria-label={`${good} good: ${split}`}>
        {good} good
      </span>
      {tallies.scrapped > 0 && <span className={CHIP_DANGER}>Scrapped {tallies.scrapped}</span>}
    </div>
  );
}
