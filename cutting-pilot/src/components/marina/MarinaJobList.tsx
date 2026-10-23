"use client";
// src/components/marina/MarinaJobList.tsx — marina-04
// /v2/qc/marina — Marina Foam job list. Open | Complete toggle (kept in ?status= via replaceState) →
// GET /jobs?status=. Each job is a full-width card link (works at phone width) with tally chips, the
// rework-pending badge and a "No cut sheet yet" hint. New job (canEdit) → NewJobModal → job detail.
// Direct URL only until marina-07 adds the /v2/qc button.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import { formatEtDateTime } from "@/lib/etDateTime";
import type { MarinaJobSummary } from "@/lib/marina/types";
import NewJobModal from "./NewJobModal";
import TallyChips from "./TallyChips";
import { CARD, ERROR_TEXT, GHOST, HEADER_BTN, REWORK_BADGE, marinaFetch } from "./ui";

type ListStatus = "open" | "complete";

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
  canEdit: boolean;
  initialStatus: ListStatus;
}

export default function MarinaJobList({ userName, isAdmin, permissions, canEdit, initialStatus }: Props) {
  const [status, setStatus] = useState<ListStatus>(initialStatus);
  const [jobs, setJobs] = useState<MarinaJobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async (s: ListStatus) => {
    setJobs(null);
    setError(null);
    const r = await marinaFetch<{ jobs: MarinaJobSummary[] }>(`/jobs?status=${s}`);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setJobs(r.data.jobs);
  }, []);

  useEffect(() => {
    load(status);
  }, [load, status]);

  function choose(s: ListStatus) {
    if (s === status) return;
    setStatus(s);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("status", s);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Quality Control · v2" currentPath="/v2/qc" />

      <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 space-y-5">
        <a href="/v2/qc" className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] no-underline">
          <ArrowLeft size={16} aria-hidden="true" /> Final Inspection
        </a>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-text">Marina Foam</h1>
            <p className="text-xs text-muted">Inspect Marina Foam parts against their cut sheets.</p>
          </div>
          {canEdit && (
            <button type="button" className={HEADER_BTN} onClick={() => setNewOpen(true)}>
              <Plus size={14} className="text-muted" aria-hidden="true" />
              New job
            </button>
          )}
        </div>

        <div role="tablist" aria-label="Job status" className="inline-flex rounded-lg border border-[var(--border)] bg-surface p-1 gap-1">
          {(["open", "complete"] as ListStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => choose(s)}
              className={
                status === s
                  ? "min-h-[44px] min-w-[96px] px-4 rounded-md bg-[var(--primary-bg)] text-[var(--primary-text)] text-sm font-semibold cursor-pointer"
                  : "min-h-[44px] min-w-[96px] px-4 rounded-md text-muted text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
              }
            >
              {s === "open" ? "Open" : "Complete"}
            </button>
          ))}
        </div>

        {error && (
          <div role="alert" className={`${CARD} space-y-3`}>
            <p className={ERROR_TEXT}>{error}</p>
            <button type="button" className={GHOST} onClick={() => load(status)}>Retry</button>
          </div>
        )}

        {!error && jobs === null && (
          <ul className="space-y-3" aria-busy="true" aria-label="Loading jobs">
            {[0, 1, 2].map((i) => (
              <li key={i} className={`${CARD} space-y-2 animate-pulse`}>
                <div className="h-5 w-1/2 rounded bg-[var(--ghost-bg)]" />
                <div className="h-4 w-3/4 rounded bg-[var(--ghost-bg)]" />
              </li>
            ))}
          </ul>
        )}

        {!error && jobs !== null && jobs.length === 0 && (
          <p className={`${CARD} text-sm text-muted`}>
            {status === "open"
              ? canEdit ? "No open jobs. Tap New job to start." : "No open jobs."
              : "No complete jobs."}
          </p>
        )}

        {!error && jobs !== null && jobs.length > 0 && (
          <ul className="space-y-3">
            {jobs.map((j) => (
              <li key={j.id}>
                <a
                  href={`/v2/qc/marina/${encodeURIComponent(j.id)}`}
                  className={`${CARD} block no-underline text-text hover:bg-[var(--ghost-bg)] transition-colors space-y-2`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-base font-bold break-words">{j.name}</span>
                    {j.customer && <span className="text-sm text-muted break-words">{j.customer}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <TallyChips tallies={j.tallies} />
                    {j.tallies.rework_pending > 0 && (
                      <span className={REWORK_BADGE}>{j.tallies.rework_pending} rework pending</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                    {j.cut_sheets === 0 && <span>No cut sheet yet</span>}
                    <span>Created {formatEtDateTime(j.created_at) ?? "—"}</span>
                    {status === "complete" && j.completed_at && <span>Completed {formatEtDateTime(j.completed_at)}</span>}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canEdit && <NewJobModal isOpen={newOpen} onClose={() => setNewOpen(false)} />}
    </div>
  );
}
