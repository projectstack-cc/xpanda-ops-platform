"use client";
// src/components/logistics/JobPullModal.tsx
// Design read: building this as a job-pull picker + match-preview for a logistics planner on
// desktop, dense + industrial, search-then-review — not a floor-tablet surface (Load Builder is
// desktop-first, LoadPlanView.tsx's own header comment).
//
// lb-ui-05 Part B. Search step copies PullJobModal.tsx's debounced GET /v2/api/jobs?search=
// pattern (loading/dockTypes' picker) rather than reusing that component directly — different data
// shape, different caller. GET /v2/api/jobs has no server-side status filter and this component
// applies none client-side either — every job status is pullable regardless of where it sits in
// production (Steve, 2026-09-16: a deliberate deviation from legacy's own done/loading-only
// restriction, load-builder.html:2942 — most loading diagrams are built as floor paperwork well
// before a job starts being cut).
//
// Preview step ports legacy's prefillFromJob matching (jobPull.ts) against the SKU universe legacy
// itself used — GET /api/load-builder-skus (NOT /api/parts; confirmed via legacy's fetchSkusFromApi,
// load-builder.html:1246-1250), same-origin, same cross-app-call pattern PartsPicker.tsx already
// uses for /api/parts. Every matched/unmatched line is shown before the planner commits — a
// deliberate improvement over legacy's silent on-the-fly part creation, which this sprint defers
// entirely (see jobPull.ts's header). Per-SKU color swatches (colorForSkuId) mirror what the same
// SKU will render as on the trailer diagram once pack() runs, so the preview and the diagram agree.
//
// Exports pullJobPreview() so LoadPlanView.tsx's ?job_id= deep-link effect can run the same
// fetch+match path without going through the search UI (Design Decision: deep link auto-runs the
// pull) — it still lands on this modal's review/confirm step rather than silently auto-confirming,
// so the unmatched-item safety net applies on both entry points, not just the manual one.
import { useEffect, useRef, useState } from "react";
import { Search, AlertTriangle, CheckCircle2 } from "lucide-react";
import Modal from "@/components/Modal";
import type { CartLine, PackSku } from "@/lib/packEngine";
import { matchLineItemsToSkus, buildCartFromMatches, colorForSkuId, type JobLineItem, type JobPullMatch } from "@/lib/jobPull";
import type { LoadBuilderFixture } from "@/lib/loadBuilderFixtures";

interface JobSearchResult {
  id: string;
  customer: string | null;
  invoice_number: string | null;
  po_number: string | null;
  status: string | null;
}

interface JobDetail {
  id: string;
  customer: string | null;
  invoice_number: string | null;
  po_number: string | null;
  line_items: JobLineItem[];
}

// Structurally a LoadBuilderFixture (advisor: keeps the pulled source a drop-in for the existing
// fixture -> pack() seam) plus the fields LoadPlanView's banner needs.
export interface PulledLoadSource extends LoadBuilderFixture {
  jobId: string;
  unmatchedCount: number;
  unmatchedDescriptions: string[];
}

// Steve, 2026-09-16: legacy restricted job-pull to "done"/"loading" status (load-builder.html:2942),
// but that's wrong for how the floor actually uses this — most loading diagrams are generated as
// paperwork well before a job starts being cut, against any job status. No status filter here.
function coerceSku(raw: any): PackSku | null {
  const length = Number(raw?.length);
  const width = Number(raw?.width);
  const height = Number(raw?.height);
  const weight = Number(raw?.weight);
  if (!raw?.id || !Number.isFinite(length) || length <= 0 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return {
    id: String(raw.id),
    name: String(raw.name || raw.sku || raw.id),
    sku: String(raw.sku || ""),
    length,
    width,
    height,
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    category: raw.category || undefined,
    allowRotation: !!raw.allowRotation,
    bundleQty: Number.isFinite(Number(raw.bundleQty)) && Number(raw.bundleQty) > 0 ? Number(raw.bundleQty) : undefined,
  };
}

interface PreviewState {
  job: JobDetail;
  matches: JobPullMatch[];
  skuById: Map<string, PackSku>;
}

async function fetchJobDetail(jobId: string): Promise<JobDetail> {
  const res = await fetch(`/v2/api/jobs/${encodeURIComponent(jobId)}`);
  const json = await res.json();
  if (!res.ok || !json.ok || !json.job) throw new Error(json.error || "Job not found.");
  return json.job as JobDetail;
}

async function fetchLoadBuilderSkus(): Promise<PackSku[]> {
  const res = await fetch("/api/load-builder-skus");
  const json = await res.json();
  if (!res.ok || !Array.isArray(json)) throw new Error("Couldn't load the SKU library.");
  return json.map(coerceSku).filter((s): s is PackSku => s !== null);
}

/** Fetches the job + SKU universe and runs the match — the same path the modal's own job-selection
 * handler uses, exported so LoadPlanView's ?job_id= deep link can pre-populate the preview without
 * the search step. Throws on any failure; caller decides how to surface it. */
export async function pullJobPreview(jobId: string): Promise<PreviewState> {
  const [job, skus] = await Promise.all([fetchJobDetail(jobId), fetchLoadBuilderSkus()]);
  const matches = matchLineItemsToSkus(job.line_items || [], skus);
  return { job, matches, skuById: new Map(skus.map((s) => [s.id, s])) };
}

/** Turns a computed preview into the PulledLoadSource the seam consumes — narrowed to only the
 * matched SKUs (advisor: a fixture's skus[] is exactly what its cart references; handing pack() the
 * whole library would change footprintCount/top-off behavior no fixture can produce). */
export function buildPulledSource(preview: PreviewState): PulledLoadSource {
  const cart: CartLine[] = buildCartFromMatches(preview.matches);
  const matchedIds = new Set(cart.map((c) => c.skuId));
  const skus = Array.from(matchedIds)
    .map((id) => preview.skuById.get(id))
    .filter((s): s is PackSku => !!s);
  const unmatched = preview.matches.filter((m) => !m.matchedSkuId);

  return {
    id: `job-${preview.job.id}`,
    jobId: preview.job.id,
    invoiceNumber: preview.job.invoice_number || "",
    customer: preview.job.customer || "Unknown customer",
    label: `${preview.job.invoice_number ? `INV# ${preview.job.invoice_number}` : "Pulled job"} — ${preview.job.customer || "Unknown customer"}`,
    cart,
    skus,
    unmatchedCount: unmatched.length,
    unmatchedDescriptions: unmatched.map((m) => m.lineItem.description || m.lineItem.part_number || "Unnamed item"),
  };
}

interface JobPullModalProps {
  /** When set, skips the search step and runs pullJobPreview(initialJobId) immediately — the
   * ?job_id= deep-link path. */
  initialJobId?: string;
  onClose: () => void;
  onConfirm: (source: PulledLoadSource) => void;
}

export default function JobPullModal({ initialJobId, onClose, onConfirm }: JobPullModalProps) {
  const [query, setQuery] = useState("");
  const [rawResults, setRawResults] = useState<JobSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const initialRanRef = useRef(false);

  const results = rawResults;

  async function loadPreview(jobId: string) {
    setLoadingPreview(true);
    setError(null);
    try {
      const result = await pullJobPreview(jobId);
      if (!result.job.line_items?.length) {
        setError("This job has no line items to pull.");
        setLoadingPreview(false);
        return;
      }
      setPreview(result);
    } catch (e: any) {
      setError(e?.message || "Couldn't load this job.");
    } finally {
      setLoadingPreview(false);
    }
  }

  useEffect(() => {
    if (initialJobId && !initialRanRef.current) {
      initialRanRef.current = true;
      loadPreview(initialJobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId]);

  useEffect(() => {
    if (initialJobId) return; // deep-link path skips search entirely
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setRawResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const mySeq = ++seqRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/v2/api/jobs?search=${encodeURIComponent(trimmed)}`);
        const json = await res.json();
        if (mySeq !== seqRef.current) return;
        setRawResults(json.ok ? json.jobs ?? [] : []);
      } catch {
        if (mySeq === seqRef.current) setRawResults([]);
      } finally {
        if (mySeq === seqRef.current) setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, initialJobId]);

  function handleConfirm() {
    if (!preview) return;
    onConfirm(buildPulledSource(preview));
  }

  const title = preview ? "Review pulled load" : "Pull from job";
  // advisor (pre-commit review): a job with line items where NONE match a library SKU produces an
  // empty cart — buildCartFromMatches excludes unmatched rows by design (jobPull.ts). pack([], [], …)
  // itself doesn't throw (verified directly), but confirming into an empty plan is never useful, so
  // block it here rather than let the planner land on a trailer with nothing on it.
  const matchedCount = preview ? preview.matches.filter((m) => !!m.matchedSkuId).length : 0;
  const noMatches = preview !== null && matchedCount === 0;

  return (
    <Modal isOpen onClose={onClose} title={title} size="lg">
      {!preview && !loadingPreview && !initialJobId && (
        <>
          <label className="block text-xs font-semibold text-text">
            Search jobs
            <div className="relative mt-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Customer, PO, or INV #"
                autoComplete="off"
                className="w-full min-h-[44px] pl-9 pr-3 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm"
              />
            </div>
          </label>

          <div className="max-h-64 overflow-y-auto border border-[var(--line)] rounded-md divide-y divide-[var(--line)]">
            {searching && <p className="text-xs text-muted px-3 py-2">Searching…</p>}
            {!searching && query.trim().length >= 2 && rawResults.length > 0 && results.length === 0 && (
              <p className="text-xs text-text-faint italic px-3 py-2">
                {rawResults.length} job{rawResults.length === 1 ? "" : "s"} found, but none are Done or Loading yet.
              </p>
            )}
            {!searching && query.trim().length >= 2 && rawResults.length === 0 && (
              <p className="text-xs text-text-faint italic px-3 py-2">No matches.</p>
            )}
            {!searching && query.trim().length < 2 && (
              <p className="text-xs text-text-faint italic px-3 py-2">Type at least 2 characters to search.</p>
            )}
            {results.map((j) => (
              <div
                key={j.id}
                role="button"
                tabIndex={0}
                onClick={() => loadPreview(j.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    loadPreview(j.id);
                  }
                }}
                className="px-3 py-2.5 cursor-pointer text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] hover:bg-[var(--ghost-bg)]"
              >
                <div className="font-semibold text-text">{j.customer || "Unknown customer"}</div>
                <div className="text-xs text-muted font-mono tabular-nums">
                  {[j.invoice_number ? `INV# ${j.invoice_number}` : "", j.po_number ? `PO: ${j.po_number}` : "", j.status?.replace("_", " ")]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {loadingPreview && <p className="text-sm text-muted py-6 text-center">Loading job…</p>}

      {preview && !loadingPreview && (
        <>
          <div className="rounded-lg border border-[var(--card-border)] bg-surface p-3">
            <div className="font-semibold text-text text-sm">{preview.job.customer || "Unknown customer"}</div>
            <div className="text-xs text-muted font-mono tabular-nums">
              {preview.job.invoice_number ? `INV# ${preview.job.invoice_number}` : "No invoice #"}
              {preview.job.po_number ? ` · PO: ${preview.job.po_number}` : ""}
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto border border-[var(--line)] rounded-md divide-y divide-[var(--line)]">
            {preview.matches.map((m, i) => {
              const sku = m.matchedSkuId ? preview.skuById.get(m.matchedSkuId) : null;
              return (
                <div key={m.lineItem.id || i} className="px-3 py-2 flex items-center gap-2.5 text-sm">
                  {sku ? (
                    <span
                      className="shrink-0 w-3 h-3 rounded-full border border-black/10"
                      style={{ background: colorForSkuId(sku.id) }}
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertTriangle size={14} className="shrink-0 text-[var(--warn-text)]" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-text truncate">{m.lineItem.description || m.lineItem.part_number || "Unnamed item"}</div>
                    <div className="text-xs font-mono tabular-nums text-muted">
                      qty {m.lineItem.quantity}
                      {sku ? ` · matched ${sku.sku || sku.name}` : " · no matching SKU in the parts library"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <p className="text-xs text-[var(--danger-text)] flex items-center gap-1.5">
              <AlertTriangle size={14} aria-hidden="true" /> {error}
            </p>
          )}

          {noMatches && (
            <p className="text-xs text-[var(--warn-text)] flex items-center gap-1.5">
              <AlertTriangle size={14} aria-hidden="true" /> No line items matched — add them to the parts library first, then pull again.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] text-sm font-semibold text-text cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={noMatches}
              className="min-h-[44px] px-4 rounded-md bg-[var(--primary-bg)] text-[var(--primary-text)] text-sm font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 size={16} aria-hidden="true" /> Confirm pull
            </button>
          </div>
        </>
      )}

      {error && !preview && !loadingPreview && (
        <p className="text-xs text-[var(--danger-text)] flex items-center gap-1.5">
          <AlertTriangle size={14} aria-hidden="true" /> {error}
        </p>
      )}
    </Modal>
  );
}
