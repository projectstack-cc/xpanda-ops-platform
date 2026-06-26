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

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
