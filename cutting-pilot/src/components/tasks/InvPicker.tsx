"use client";
// src/components/tasks/InvPicker.tsx  (tasks-02)
// Link 0–5 orders (INV #s). Chips "INV 4601 · CUSTOMER · ships Wed 11/18" (+ archived tag) with remove ×.
// Search hits GET /v2/api/tasks/manage/jobs?q= with a 250 ms debounce; blank (after trim) → no request. `%` is sent
// as typed (tasks-05 patched OpenNext's query double-decode; the route escapes LIKE wildcards).
// Results are a listbox: ↑/↓ move, Enter picks, Escape closes the list only (never the modal).
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { MAX_JOBS } from "@/lib/tasks/board";
import { api, CHIP_MUTED, CHIP_NEUTRAL, FOCUS, INPUT, LABEL, shortDate, isYmd, type JobHit, type JobRef } from "./tasksUi";

export function jobLabel(j: JobRef): string {
  const parts = [`INV ${j.invoice_number ?? "?"}`];
  if (j.customer) parts.push(j.customer);
  if (j.ship_date && isYmd(j.ship_date)) parts.push(`ships ${shortDate(j.ship_date)}`);
  return parts.join(" · ");
}

export const cleanQuery = (q: string) => q.trim();

export default function InvPicker({ value, onChange }: { value: JobRef[]; onChange: (jobs: JobRef[]) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<JobHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const seq = useRef(0);
  const full = value.length >= MAX_JOBS;

  useEffect(() => {
    const clean = cleanQuery(q);
    if (!clean) { setHits([]); setState("idle"); return; }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setState("loading");
      const r = await api<{ jobs: JobHit[] }>(`/manage/jobs?q=${encodeURIComponent(clean)}`);
      if (my !== seq.current) return;
      if (!r.ok) { setState("error"); setHits([]); return; }
      setHits(r.json.jobs ?? []);
      setActive(0);
      setOpen(true);
      setState("idle");
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (j: JobHit) => {
    if (full || value.some((v) => v.job_id === j.job_id)) return;
    onChange([...value, j]);
    setQ("");
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (!open || !hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(hits[active]); }
  };

  return (
    <div className="min-w-0">
      <span className={LABEL}>Link to order <span className="normal-case font-normal">(optional, up to {MAX_JOBS})</span></span>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2" data-testid="inv-selected">
          {value.map((j) => (
            <span key={j.job_id} className={`${CHIP_NEUTRAL} pr-0.5 max-w-full`}>
              <span className="font-mono tabular-nums truncate">{jobLabel(j)}</span>
              {j.archived && <span className={`${CHIP_MUTED} px-1.5`}>archived</span>}
              <button type="button" onClick={() => onChange(value.filter((v) => v.job_id !== j.job_id))} aria-label={`Remove INV ${j.invoice_number ?? ""}`}
                className={`min-w-[28px] min-h-[28px] inline-flex items-center justify-center rounded-full hover:bg-[var(--surface)] cursor-pointer ${FOCUS}`}>
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      {full ? (
        <p className="m-0 text-xs text-muted">Max {MAX_JOBS} orders per task.</p>
      ) : (
        <div className="relative">
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search INV # or customer…" aria-label="Search INV # or customer"
            role="combobox" aria-expanded={open} aria-controls="inv-results" aria-autocomplete="list"
            aria-activedescendant={open && hits[active] ? `inv-hit-${hits[active].job_id}` : undefined}
            className={INPUT} data-testid="inv-search"
          />
          {state === "loading" && <p className="m-0 mt-1 text-xs text-muted">Searching…</p>}
          {state === "error" && <p className="m-0 mt-1 text-xs text-danger-ink">Search failed — try again.</p>}
          {open && cleanQuery(q) && (
            <ul id="inv-results" role="listbox" className="absolute z-10 left-0 right-0 mt-1 m-0 p-0 list-none max-h-[260px] overflow-y-auto bg-[var(--surface)] border border-[var(--card-border)] rounded-lg"
              style={{ boxShadow: "var(--shadow-md)" }}>
              {hits.length === 0 && <li className="p-3 text-sm text-muted">No orders match.</li>}
              {hits.map((j, i) => {
                const taken = value.some((v) => v.job_id === j.job_id);
                return (
                  <li key={j.job_id} id={`inv-hit-${j.job_id}`} role="option" aria-selected={i === active} aria-disabled={taken}
                    onMouseDown={(e) => { e.preventDefault(); pick(j); }} onMouseEnter={() => setActive(i)}
                    className={`px-3 min-h-[44px] flex items-center gap-2 text-sm border-t border-[var(--line)] first:border-t-0 ${taken ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${i === active ? "bg-[var(--ghost-bg)]" : ""}`}>
                    <span className="font-mono tabular-nums font-semibold">INV {j.invoice_number ?? "?"}</span>
                    <span className="flex-1 truncate text-muted">{j.customer ?? ""}</span>
                    {j.ship_date && isYmd(j.ship_date) && <span className="font-mono tabular-nums text-xs text-muted">ships {shortDate(j.ship_date)}</span>}
                    {j.archived && <span className={CHIP_MUTED}>archived</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
