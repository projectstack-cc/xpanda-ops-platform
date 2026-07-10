// Time-tracking helpers for the cutting board. Single source — do not inline these elsewhere.

// D1 datetime strings are UTC 'YYYY-MM-DD HH:MM:SS'. Convert to epoch ms.
function parseUtc(ts: string): number {
  return Date.parse(ts.replace(" ", "T") + "Z");
}

// Total tracked seconds for a line = accumulated closed-session time (from the server)
// plus the currently-running session's elapsed (if any), measured against `nowMs`.
export function lineLiveSeconds(
  line: { tracked_seconds: number; open_started_at: string | null },
  nowMs: number
): number {
  let s = line.tracked_seconds || 0;
  if (line.open_started_at) {
    const startMs = parseUtc(line.open_started_at);
    if (!Number.isNaN(startMs)) s += Math.max(0, (nowMs - startMs) / 1000);
  }
  return s;
}

// Wall-clock seconds for a line = first clock-in → (completion, if complete) else now.
// Live-ticks while the line is not complete; frozen at last session end once complete.
export function lineWallSeconds(
  line: {
    line_status: "not_started" | "in_progress" | "complete";
    first_started_at: string | null;
    done_at: string | null;
  },
  nowMs: number
): number {
  if (!line.first_started_at) return 0;
  const startMs = parseUtc(line.first_started_at);
  if (Number.isNaN(startMs)) return 0;
  let endMs = nowMs;
  if (line.line_status === "complete" && line.done_at) {
    const d = parseUtc(line.done_at);
    if (!Number.isNaN(d)) endMs = d;
  }
  return Math.max(0, (endMs - startMs) / 1000);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
