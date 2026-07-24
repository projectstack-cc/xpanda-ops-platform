"use client";
import { LineStatusPill } from "@/components/StatusPill";
import type { CuttingLine } from "./types";
import { formatDuration, lineLiveSeconds, lineWallSeconds } from "@/lib/time";

interface Props {
  lineObj: CuttingLine;
  jobId: string;
  userId: string;
  userName: string;
  acting: boolean;
  clockedInElsewhere: boolean;
  onClockIn: (jobId: string, line: string) => void;
  onClockOut: (sessionId: string, line: string) => void;
  onComplete: (jobId: string, line: string) => void;
  now: number;
}

export default function LineRow({
  lineObj,
  jobId,
  userId,
  userName,
  acting,
  clockedInElsewhere,
  onClockIn,
  onClockOut,
  onComplete,
  now,
}: Props) {
  const mySession =
    lineObj.open_session_id && !!userId && lineObj.open_operator_id === userId
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

      {(() => {
        const qd = lineObj.qty_done ?? 0;
        if (qd <= 0) return null;
        const wall = lineWallSeconds(lineObj, now);
        const active = lineLiveSeconds(lineObj, now);
        return (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-xs font-mono tabular-nums text-muted">
            <span title="Units completed on this line">
              {qd}
              {lineObj.qty_target != null ? `/${lineObj.qty_target}` : ""} {lineObj.unit}
            </span>
            {wall >= 1 && (
              <span title="Wall-clock: first clock-in to done">
                wall {formatDuration(wall)}
              </span>
            )}
            <span title="Active tracked cutting time">
              active {formatDuration(active)}
            </span>
          </div>
        );
      })()}

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
              title={
                clockedInElsewhere
                  ? "You're clocked in elsewhere — tap to clock out of your current line."
                  : undefined
              }
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
