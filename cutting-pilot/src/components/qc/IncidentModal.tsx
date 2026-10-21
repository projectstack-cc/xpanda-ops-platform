"use client";
// src/components/qc/IncidentModal.tsx — qc-08
// The /v2/qc Incident report popup over native qc_incidents (replaces legacy qc/incident-report.html).
// Two tabs:
//   New report — the legacy form's fields. INV # is optional: looked up on blur / Enter with the scrap
//                lookup (GET /v2/api/qc/scrap/lookup), it fills Customer, Delivery date (the job's ship
//                date) and Product delivered (all editable). Customer is free text with suggestions from
//                the incident customer sheet (GET /v2/api/qc/incidents/customers). Saves with
//                POST /v2/api/qc/incidents; the server then files the incident Doc + tracker-Sheet row.
//   Recent     — the last 30 days with Doc link / Drive failed / pending (retrying), and Retry Drive.
// View-only users see both tabs, with Submit disabled and no Retry. Composes the shared Modal at xl.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import Modal from "@/components/Modal";
import { etNowWallClock, parseStoredUtc } from "@/lib/etDateTime";
import {
  CATEGORIES,
  DEPARTMENTS,
  LONG_TEXT_MAX,
  NAME_MAX,
  PRODUCTS,
  RISK_LEVELS,
  productFromLines,
  validateIncident,
  type IncidentRow,
} from "@/lib/qc/incident";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  canEdit: boolean;
  userName: string;
}

interface LookupJob {
  id: string;
  invoice_number: string;
  customer: string;
  ship_date: string;
}

type Lookup =
  | { status: "idle" }
  | { status: "loading"; inv: string }
  | { status: "found"; inv: string; job: LookupJob }
  | { status: "notfound"; inv: string }
  | { status: "error"; inv: string };

interface Form {
  date: string;
  person: string;
  individual: string;
  inv: string;
  customer: string;
  product: string;
  delivery: string;
  category: string;
  risk: string;
  details: string;
  root: string;
  departments: string[];
  actions: string;
}

function blankForm(userName: string, prev?: Form): Form {
  return {
    date: etNowWallClock().date,
    person: prev?.person ?? userName,
    individual: "",
    inv: "",
    customer: "",
    product: "",
    delivery: "",
    category: "",
    risk: "",
    details: "",
    root: "",
    departments: [],
    actions: "",
  };
}

const SUBMIT_TIMEOUT_MS = 30_000;
const RETRY_CLIENT_TIMEOUT_MS = 40_000; // the server bounds the Apps Script POST at 25 s
const DRIVE_STUCK_MS = 2 * 60 * 1000; // the forwarder's claim window

function isStuck(r: IncidentRow): boolean {
  if (r.drive_status !== "pending") return false;
  const since = parseStoredUtc(r.drive_attempted_at ?? r.created_at);
  return since !== null && Date.now() - since > DRIVE_STUCK_MS;
}

const SHORT: Record<string, string> = {
  "Date is required.": "date",
  "Person completing is required.": "person completing",
  "Customer is required.": "customer",
  "Product delivered is required.": "product delivered",
  "Category is required.": "category",
  "Risk level is required.": "risk level",
  "Incident details are required.": "incident details",
};

function mdyLabel(ymd: string): string {
  const [y, mo, d] = (ymd || "").split("-").map(Number);
  return y && mo && d ? `${mo}/${d}/${String(y).slice(2)}` : ymd || "—";
}

const LABEL = "flex flex-col gap-1 min-w-0 text-xs font-semibold text-muted";
const INPUT =
  "w-full min-h-[44px] px-3 rounded-lg border border-[var(--border)] bg-surface text-text text-sm focus:outline-hidden focus:border-[var(--brand)]";
const TEXTAREA =
  "w-full min-h-[88px] px-3 py-2 rounded-lg border border-[var(--border)] bg-surface text-text text-sm focus:outline-hidden focus:border-[var(--brand)]";
const MONO = "font-mono tabular-nums";
const BTN =
  "inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-md border border-[var(--border)] bg-surface text-sm font-semibold text-text hover:bg-[var(--ghost-bg)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
const BTN_PRIMARY =
  "inline-flex items-center justify-center min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
const CHIP = "inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border whitespace-nowrap";
const REQ = <span className="text-[var(--danger-ink)]" aria-hidden="true"> *</span>;

function RiskChip({ risk }: { risk: string }) {
  if (risk === "High") return <span className={`${CHIP} bg-surface text-[var(--danger-ink)] border-[var(--danger-ink)]`}>High</span>;
  if (risk === "Medium") return <span className={`${CHIP} bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]`}>Medium</span>;
  return <span className={`${CHIP} bg-[var(--ghost-bg)] text-text border-[var(--border)]`}>{risk || "—"}</span>;
}

function DriveCell({
  row,
  canEdit,
  onPatched,
}: {
  row: IncidentRow;
  canEdit: boolean;
  onPatched: (row: IncidentRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stuck = isStuck(row);
  const showRetry = canEdit && (row.drive_status === "failed" || stuck);

  async function retry() {
    setBusy(true);
    setError(null);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), RETRY_CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch(`/v2/api/qc/incidents/${encodeURIComponent(row.id)}/drive`, { method: "POST", signal: ac.signal });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || `Retry failed (HTTP ${res.status}).`);
        return;
      }
      onPatched(json.incident as IncidentRow);
    } catch (e) {
      setError(
        (e as any)?.name === "AbortError"
          ? "No answer after 40 s — refresh in a minute to see whether it went through."
          : "Network error — couldn't reach the server."
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="text-xs">
        {row.drive_status === "synced" && row.drive_file_id ? (
          <a
            href={`https://docs.google.com/document/d/${encodeURIComponent(row.drive_file_id)}/edit`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open incident Doc for ${row.customer}`}
            className="inline-flex items-center gap-1 font-semibold text-[var(--link)] hover:underline"
          >
            <FileText size={12} aria-hidden="true" />
            Doc
          </a>
        ) : row.drive_status === "synced" ? (
          <span className="text-muted">Drive synced</span>
        ) : row.drive_status === "failed" ? (
          <span className="font-semibold text-[var(--danger-ink)]" title={row.drive_error ?? undefined}>
            Drive failed
            {row.drive_error && <span className="sr-only">: {row.drive_error}</span>}
          </span>
        ) : (
          <span className="text-muted">{stuck ? "Drive pending (retrying)" : "Drive pending"}</span>
        )}
      </div>
      {showRetry && (
        <button type="button" onClick={retry} disabled={busy} aria-busy={busy} className={`${BTN} px-3 text-xs disabled:cursor-wait`}>
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} aria-hidden="true" />
          {busy ? "Retrying…" : "Retry Drive"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--danger-ink)]">
          {error}
        </p>
      )}
    </div>
  );
}

function IncidentBody({
  canEdit,
  userName,
  requestClose,
  setDirty,
}: {
  canEdit: boolean;
  userName: string;
  requestClose: (force?: boolean) => void;
  setDirty: (dirty: boolean) => void;
}) {
  const [tab, setTab] = useState<"new" | "recent">("new");
  const [form, setForm] = useState<Form>(() => blankForm(userName));
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const [customers, setCustomers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const lookupSeq = useRef(0);
  const today = etNowWallClock().date;

  const loadRecent = useCallback(async () => {
    setRecentError(null);
    try {
      const res = await fetch("/v2/api/qc/incidents?days=30");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setRecentError(json?.error || "Couldn't load recent incident reports.");
        return;
      }
      setRows(json.incidents ?? []);
    } catch {
      setRecentError("Network error — couldn't reach the server.");
    }
  }, []);

  useEffect(() => {
    loadRecent();
    let live = true;
    fetch("/v2/api/qc/incidents/customers")
      .then((r) => r.json())
      .then((json) => {
        if (live && Array.isArray(json?.names)) setCustomers(json.names);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [loadRecent]);

  const patch = useCallback(
    (p: Partial<Form>) => {
      setDirty(true);
      setSuccess(null);
      setForm((prev) => ({ ...prev, ...p }));
      // Retyping the INV drops the order link until it's looked up again.
      if (p.inv !== undefined) {
        setLookup((lk) => (lk.status !== "idle" && lk.inv !== p.inv!.trim() ? { status: "idle" } : lk));
      }
    },
    [setDirty]
  );

  async function runLookup() {
    const inv = form.inv.trim();
    if (!inv) return;
    if (lookup.status !== "idle" && lookup.inv === inv) return;
    const seq = ++lookupSeq.current;
    setLookup({ status: "loading", inv });
    try {
      const res = await fetch(`/v2/api/qc/scrap/lookup?inv=${encodeURIComponent(inv)}`);
      const json = await res.json().catch(() => null);
      if (seq !== lookupSeq.current) return;
      if (!res.ok || !json?.ok) {
        setLookup({ status: "error", inv });
      } else if (!json.found) {
        setLookup({ status: "notfound", inv });
      } else {
        const job = json.job as LookupJob;
        const lines: { description: string; dimensions: string; category: string | null }[] = json.lines ?? [];
        const nonEmpty = lines.filter((l) => (l.description || "").trim() || (l.dimensions || "").trim());
        setLookup({ status: "found", inv, job });
        setForm((prev) => ({
          ...prev,
          customer: job.customer || prev.customer,
          delivery: (job.ship_date || "").slice(0, 10) || prev.delivery,
          product: productFromLines(nonEmpty),
        }));
      }
    } catch {
      if (seq === lookupSeq.current) setLookup({ status: "error", inv });
    }
  }

  const jobId = lookup.status === "found" && lookup.inv === form.inv.trim() ? lookup.job.id : null;

  const payload = useMemo(
    () => ({
      incident_date: form.date,
      person_completing: form.person,
      reporting_individual: form.individual,
      customer: form.customer,
      job_id: jobId,
      job_ref: form.inv,
      product_delivered: form.product,
      delivery_date: form.delivery,
      incident_category: form.category,
      risk_level: form.risk,
      incident_details: form.details,
      root_cause: form.root,
      implicated_departments: form.departments,
      corrective_actions: form.actions,
    }),
    [form, jobId]
  );

  const problems = useMemo(() => {
    const out: string[] = [];
    if (form.inv.trim() && lookup.status === "loading") out.push("INV # lookup in progress");
    const r = validateIncident(payload, today);
    if (!r.ok) for (const m of r.errors) out.push(SHORT[m] ?? m.replace(/\.$/, "").toLowerCase());
    return out;
  }, [payload, today, form.inv, lookup.status]);

  const canSubmit = canEdit && !busy && problems.length === 0;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
    setSuccess(null);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), SUBMIT_TIMEOUT_MS);
    try {
      const res = await fetch("/v2/api/qc/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      const json = await res.json().catch(() => null);
      if (res.status === 201 && json?.ok) {
        const saved = json.incident as IncidentRow;
        setSuccess(`Saved — ${saved.customer} · ${saved.incident_category} (${saved.risk_level}). The Doc is on its way to Drive.`);
        setHighlight(saved.id);
        setRows((prev) => [saved, ...(prev ?? []).filter((r) => r.id !== saved.id)]);
        setForm((prev) => blankForm(userName, prev));
        setLookup({ status: "idle" });
        setDirty(false);
        setTab("recent");
        loadRecent();
        return;
      }
      setSubmitError(json?.error || `Couldn't save (HTTP ${res.status}).`);
    } catch (e) {
      setSubmitError(
        (e as any)?.name === "AbortError"
          ? "No answer after 30 s — check Recent before submitting again."
          : "Network error — couldn't reach the server."
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  const tabCls = (on: boolean) =>
    `min-h-[44px] px-4 border-b-2 text-sm font-semibold cursor-pointer ${
      on ? "border-[var(--brand)] text-text" : "border-transparent text-muted hover:text-text"
    }`;

  return (
    <div className="space-y-4">
      <nav aria-label="Incident report sections" role="tablist" className="-mt-2 flex gap-1 border-b border-[var(--line)]">
        <button type="button" role="tab" aria-selected={tab === "new"} className={tabCls(tab === "new")} onClick={() => setTab("new")}>
          New report
        </button>
        <button type="button" role="tab" aria-selected={tab === "recent"} className={tabCls(tab === "recent")} onClick={() => setTab("recent")}>
          Recent <span className={`${MONO} text-xs text-muted`}>({rows ? rows.length : "…"})</span>
        </button>
      </nav>

      {success && (
        <p role="status" className="rounded-lg border border-[var(--loaded-border)] bg-[var(--loaded-bg)] text-[var(--loaded-text)] text-sm px-3 py-2">
          {success}
        </p>
      )}

      {tab === "new" ? (
        <>
          {!canEdit && (
            <p className="rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)] text-sm px-3 py-2">
              View only — you need QC edit access to file an incident report.
            </p>
          )}
          <fieldset disabled={!canEdit} className="space-y-4 min-w-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className={LABEL}>
                <span>Date{REQ}</span>
                <input type="date" className={`${INPUT} ${MONO}`} value={form.date} max={today} onChange={(e) => patch({ date: e.target.value })} />
              </label>
              <label className={LABEL}>
                <span>Person completing{REQ}</span>
                <input className={INPUT} value={form.person} maxLength={NAME_MAX} autoComplete="off" onChange={(e) => patch({ person: e.target.value })} />
              </label>
              <label className={LABEL}>
                Reporting individual
                <input
                  className={INPUT}
                  value={form.individual}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  placeholder="Who raised it (optional)"
                  onChange={(e) => patch({ individual: e.target.value })}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className={LABEL}>
                  INV #
                  <input
                    className={`${INPUT} ${MONO}`}
                    value={form.inv}
                    autoComplete="off"
                    maxLength={50}
                    placeholder="Optional"
                    onChange={(e) => patch({ inv: e.target.value })}
                    onBlur={runLookup}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runLookup();
                      }
                    }}
                  />
                </label>
                {lookup.status === "loading" && <p className="text-xs text-muted">Looking up INV {lookup.inv}…</p>}
                {lookup.status === "found" && (
                  <p className="text-xs text-[var(--success-ink)]" data-testid="incident-lookup-found">
                    {lookup.job.customer || "—"} · shipped {mdyLabel((lookup.job.ship_date || "").slice(0, 10))}
                  </p>
                )}
                {lookup.status === "notfound" && <p className="text-xs text-muted">Not on file — fill in below</p>}
                {lookup.status === "error" && <p className="text-xs text-muted">Lookup failed — fill in below</p>}
              </div>
              <label className={`${LABEL} sm:col-span-2`}>
                <span>Customer{REQ}</span>
                <input
                  className={INPUT}
                  value={form.customer}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  list="incident-customers"
                  placeholder="Pick from the list or type a name"
                  onChange={(e) => patch({ customer: e.target.value })}
                />
                <datalist id="incident-customers">
                  {customers.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className={LABEL}>
                <span>Product delivered{REQ}</span>
                <select className={`${INPUT} cursor-pointer`} value={form.product} onChange={(e) => patch({ product: e.target.value })}>
                  <option value="">Select…</option>
                  {PRODUCTS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                Delivery date
                <input type="date" className={`${INPUT} ${MONO}`} value={form.delivery} onChange={(e) => patch({ delivery: e.target.value })} />
              </label>
              <label className={LABEL}>
                <span>Category{REQ}</span>
                <select className={`${INPUT} cursor-pointer`} value={form.category} onChange={(e) => patch({ category: e.target.value })}>
                  <option value="">Select…</option>
                  {CATEGORIES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                <span>Risk level{REQ}</span>
                <select className={`${INPUT} cursor-pointer`} value={form.risk} onChange={(e) => patch({ risk: e.target.value })}>
                  <option value="">Select…</option>
                  {RISK_LEVELS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className={LABEL}>
              <span>Incident details{REQ}</span>
              <textarea className={TEXTAREA} value={form.details} maxLength={LONG_TEXT_MAX} onChange={(e) => patch({ details: e.target.value })} />
            </label>
            <label className={LABEL}>
              Root cause
              <textarea
                className={TEXTAREA}
                value={form.root}
                maxLength={LONG_TEXT_MAX}
                placeholder="Optional at initial submission"
                onChange={(e) => patch({ root: e.target.value })}
              />
            </label>

            <fieldset className="min-w-0">
              <legend className="text-xs font-semibold text-muted mb-1">Implicated departments</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                {DEPARTMENTS.map((d) => {
                  const on = form.departments.includes(d);
                  return (
                    <label key={d} className="flex items-center gap-3 min-h-[44px] text-sm text-text cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-[var(--brand)] cursor-pointer"
                        checked={on}
                        onChange={() =>
                          patch({ departments: on ? form.departments.filter((x) => x !== d) : DEPARTMENTS.filter((x) => x === d || form.departments.includes(x)) })
                        }
                      />
                      {d}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label className={LABEL}>
              Corrective actions
              <textarea
                className={TEXTAREA}
                value={form.actions}
                maxLength={LONG_TEXT_MAX}
                placeholder="Optional at initial submission"
                onChange={(e) => patch({ actions: e.target.value })}
              />
            </label>
          </fieldset>

          <div className="sticky -bottom-6 -mx-6 -mb-6 px-6 pt-3 pb-6 border-t border-[var(--line)] bg-surface space-y-2">
            {submitError && (
              <div role="alert" className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-3 py-2">
                {submitError}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted max-w-md">
                Saves to the platform, then files the incident Doc to the customer&apos;s Drive folder and adds it to the incident tracker.
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" className={BTN} onClick={() => requestClose()}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={!canSubmit} aria-busy={busy}>
                  {busy ? "Submitting…" : "Submit report"}
                </button>
              </div>
            </div>
            {canEdit && !busy && problems.length > 0 && (
              <p className="text-xs text-muted text-right" data-testid="incident-problems">
                Missing: {problems.join(" · ")}
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-text">Last 30 days</span>
            <button type="button" className={`${BTN} px-3 text-xs`} onClick={loadRecent}>
              <RefreshCw size={12} aria-hidden="true" />
              Refresh
            </button>
          </div>
          {recentError ? (
            <div className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <span>{recentError}</span>
              <button type="button" className="min-h-[44px] px-3 underline font-semibold text-xs cursor-pointer" onClick={loadRecent}>
                Retry
              </button>
            </div>
          ) : !rows ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-[var(--card-border)] p-6 text-center text-sm text-muted">No incident reports in the last 30 days.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--card-border)]">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="bg-[var(--ghost-bg)] text-left text-xs font-semibold text-muted">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Risk</th>
                    <th className="px-3 py-2">INV</th>
                    <th className="px-3 py-2">Drive</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      data-highlight={highlight === r.id || undefined}
                      className={`border-t border-[var(--line)] align-top ${highlight === r.id ? "bg-[var(--info-bg)]" : ""}`}
                    >
                      <td className={`px-3 py-2 ${MONO} whitespace-nowrap`}>{mdyLabel(r.incident_date)}</td>
                      <td className="px-3 py-2">
                        {r.customer}
                        <div className="text-[11px] text-muted">{r.person_completing}</div>
                      </td>
                      <td className="px-3 py-2">{r.incident_category}</td>
                      <td className="px-3 py-2">
                        <RiskChip risk={r.risk_level} />
                      </td>
                      <td className={`px-3 py-2 ${MONO}`}>{r.job_ref || "—"}</td>
                      <td className="px-3 py-2">
                        <DriveCell
                          row={r}
                          canEdit={canEdit}
                          onPatched={(next) => setRows((prev) => (prev ? prev.map((x) => (x.id === next.id ? next : x)) : prev))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function IncidentModal({ isOpen, onClose, canEdit, userName }: Props) {
  // Dirty lives here so Escape / backdrop / X (Modal routes them to onClose) confirm too.
  const [dirty, setDirty] = useState(false);
  const requestClose = useCallback(
    (force = false) => {
      if (!force && dirty && !window.confirm("Discard this unsent incident report?")) return;
      setDirty(false);
      onClose();
    },
    [dirty, onClose]
  );

  return (
    <Modal isOpen={isOpen} onClose={() => requestClose()} title="Incident report" size="xl">
      <IncidentBody canEdit={canEdit} userName={userName} requestClose={requestClose} setDirty={setDirty} />
    </Modal>
  );
}
