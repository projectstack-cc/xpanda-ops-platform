"use client";
// src/components/loading/PullJobModal.tsx
// Port of legacy logistics/loading.html's Pull Job modal (openPullJobModal/searchJobsForPull/
// selectPullRow/confirmPullJob). One selectable row per LOAD, not per job (P311) -- each matched
// job is expanded into a row per in-memory assignment (joined by job_id); a job with none (e.g.
// customer pickup, hidden from the board) falls back to a single job-level row. Composes
// @/components/Modal.
import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import type { DockAssignment, DockBay } from "./dockTypes";

interface JobResult {
  id: string;
  customer: string | null;
  invoice_number: string | null;
  po_number: string | null;
  status: string | null;
}

interface SelectableRow {
  kind: "job" | "load";
  key: string;
  jobId: string;
  assignmentId?: string;
  label: string;
  meta: string;
}

interface PullJobModalProps {
  bays: DockBay[];
  assignments: DockAssignment[];
  defaultBayId: string | null;
  onClose: () => void;
  onDone: () => void;
}

export default function PullJobModal({ bays, assignments, defaultBayId, onClose, onDone }: PullJobModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<JobResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SelectableRow | null>(null);
  const [bayId, setBayId] = useState(defaultBayId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  // Debounced search (≥2 chars), a superseded-response guard (seqRef) drops any reply that isn't
  // for the latest query -- same pattern as OrderEntryForm's holey-preview debounce.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
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
        setResults(json.ok ? json.jobs ?? [] : []);
      } catch {
        if (mySeq === seqRef.current) setResults([]);
      } finally {
        if (mySeq === seqRef.current) setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const rows: SelectableRow[] = results.flatMap((j) => {
    const loads = assignments
      .filter((a) => String(a.job_id) === String(j.id))
      .slice()
      .sort((a, b) => (a.load_number || 1) - (b.load_number || 1));
    const metaBase = [j.invoice_number ? `INV# ${j.invoice_number}` : "", j.po_number ? `PO: ${j.po_number}` : ""]
      .filter(Boolean)
      .join(" | ");

    if (!loads.length) {
      const row: SelectableRow = {
        kind: "job",
        key: `job-${j.id}`,
        jobId: j.id,
        label: j.customer || "Unknown customer",
        meta: `${metaBase}${j.status ? ` | ${j.status.replace("_", " ")}` : ""}`,
      };
      return [row];
    }

    const loadCount = loads.length;
    return loads.map((a) => {
      const badge = loadCount > 1 ? ` (${a.load_number ?? 1} of ${a.load_count ?? loadCount})` : "";
      const placement =
        a.bay_id && a.bay_number != null
          ? `Bay ${a.bay_number} — ${(a.loading_status || "").replace("_", " ")}`
          : "Awaiting";
      return {
        kind: "load" as const,
        key: `load-${a.id}`,
        jobId: j.id,
        assignmentId: a.id,
        label: `${j.customer || "Unknown customer"}${badge}`,
        meta: `${metaBase} | ${placement}`,
      };
    });
  });

  async function handleConfirm() {
    if (!selected) {
      setError("Select a job or load first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Per-load pull (P311): place THAT load's existing assignment on the chosen bay.
      // loading_status is sent as 'not_started' regardless of which bay is chosen (ported from
      // legacy's confirmPullJob). For "Awaiting Queue (no bay)" (bay_id null) the PUT handler
      // normalizes no-bay -> 'awaiting' server-side (loading-awaiting-01), so the load lands in the
      // Awaiting queue instead of vanishing. The server owns the rule; this payload stays as-is.
      const res =
        selected.kind === "load" && selected.assignmentId
          ? await fetch("/v2/api/loading-assignments", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: selected.assignmentId,
                bay_id: bayId || null,
                loading_status: "not_started",
              }),
            })
          : await fetch("/v2/api/loading-assignments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ job_id: selected.jobId, bay_id: bayId || null }),
            });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "Couldn't pull this job to loading.");
        setSaving(false);
        return;
      }
      onDone();
    } catch {
      setError("Network error — couldn't reach the server.");
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Pull job to loading" size="lg">
      <label className="block text-xs font-semibold text-text">
        Search jobs
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          placeholder="Customer, PO, or INV #"
          autoComplete="off"
          className="mt-1 w-full min-h-[44px] px-3 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm"
        />
      </label>

      <div className="max-h-64 overflow-y-auto border border-[var(--line)] rounded divide-y divide-[var(--line)]">
        {searching && <p className="text-xs text-muted px-3 py-2">Searching…</p>}
        {!searching && query.trim().length >= 2 && rows.length === 0 && (
          <p className="text-xs text-text-faint px-3 py-2">No matches.</p>
        )}
        {!searching && query.trim().length < 2 && (
          <p className="text-xs text-text-faint px-3 py-2">Type at least 2 characters to search.</p>
        )}
        {rows.map((row) => (
          <div
            key={row.key}
            role="button"
            tabIndex={0}
            onClick={() => setSelected(row)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelected(row);
              }
            }}
            className="px-3 py-2.5 cursor-pointer text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={{ background: selected?.key === row.key ? "var(--accent-soft)" : undefined }}
          >
            <div className="font-semibold text-text">{row.label}</div>
            <div className="text-xs text-muted">{row.meta}</div>
          </div>
        ))}
      </div>

      <label className="block text-xs font-semibold text-text">
        Assign to
        <select
          value={bayId}
          onChange={(e) => setBayId(e.target.value)}
          className="mt-1 w-full min-h-[44px] px-3 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm"
        >
          <option value="">Awaiting Queue (no bay)</option>
          {bays.map((b) => (
            <option key={b.id} value={b.id}>
              Bay {b.bay_number}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-xs text-[var(--danger-text)]">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] px-4 rounded border border-[var(--card-border)] bg-[var(--card-bg)] text-sm font-semibold text-text cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={saving || !selected}
          className="min-h-[44px] px-4 rounded bg-[var(--primary-bg)] text-[var(--primary-text)] text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          {saving ? "Pulling…" : "Pull to Loading"}
        </button>
      </div>
    </Modal>
  );
}
