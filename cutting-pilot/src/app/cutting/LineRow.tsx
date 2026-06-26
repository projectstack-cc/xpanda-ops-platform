"use client";
import { LineStatusPill } from "@/components/StatusPill";
import type { CuttingLine } from "./types";
import { formatDuration, lineLiveSeconds } from "@/lib/time";

interface Props {
  lineObj: CuttingLine;
  jobId: string;
  userName: string;
  acting: boolean;
  onClockIn: (jobId: string, line: string) => void;
  onClockOut: (sessionId: string, line: string) => void;
  onComplete: (jobId: string, line: string) => void;
  now: number;
}

export default function LineRow({
  lineObj,
  jobId,
  userName,
  acting,
  onClockIn,
  onClockOut,
  onComplete,
  now,
}: Props) {
  const mySession =
    lineObj.open_session_id && lineObj.open_operator_name === userName
      ? lineObj.open_session_id
      : null;
  const busyByOther = lineObj.open_session_id && !mySession;

  return (
    <div className="border-b border-border px-4 py-4 last:border-b-0">
      {/* Line name + per-line status */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="font-medium text-sm text-text">{lineObj.line}</span>
        <div className="flex items-center gap-2 shrink-0">
          {(() => {
            const secs = lineLiveSeconds(lineObj, now);
            return secs >= 1 ? (
              <span
                className={`font-mono tabular-nums text-xs ${
                  lineObj.open_started_at ? "text-[var(--info-text)]" : "text-muted"
                }`}
                title="Tracked cutting time on this line"
              >
                {formatDuration(secs)}
              </span>
            ) : null;
          })()}
          <LineStatusPill status={lineObj.line_status} />
        </div>
      </div>

      {/* Someone else's session */}
      {busyByOther && (
        <p className="text-sm bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)] rounded px-3 py-2 mb-2">
          Running — {lineObj.open_operator_name}
        </p>
      )}

      {/* My active session */}
      {mySession && lineObj.line_status !== "complete" && (
        <p className="text-sm bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)] rounded px-3 py-2 mb-2">
          Running — you
        </p>
      )}

      {/* Last handoff note as resume hint */}
      {lineObj.last_handoff_note && (
        <div className="text-sm bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded px-3 py-2 mb-3">
          <span className="font-medium text-[var(--warn-text)]">Handoff: </span>
          <span className="text-[var(--warn-text)]">{lineObj.last_handoff_note}</span>
        </div>
      )}

      {/* Actions — gated by line state */}
      {lineObj.line_status !== "complete" && (
        <div className="flex flex-wrap gap-2 mt-1">
          {!lineObj.open_session_id && (
            <button
              type="button"
              disabled={acting}
              onClick={() => onClockIn(jobId, lineObj.line)}
              className="min-h-[44px] px-4 py-2 bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Clock In
            </button>
          )}
          {mySession && (
            <>
              <button
                type="button"
                disabled={acting}
                onClick={() => onClockOut(mySession, lineObj.line)}
                className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Clock Out
              </button>
              <button
                type="button"
                disabled={acting}
                onClick={() => onComplete(jobId, lineObj.line)}
                className="min-h-[44px] px-4 py-2 bg-[var(--success-bg)] text-[var(--success-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Mark Complete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
