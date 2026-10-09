"use client";
// src/app/logistics/bol-email/BolEmailQueue.tsx — bem-01
// v2 port of legacy logistics/bol-email.html (BOL Email Queue), behavior 1:1 except the bem-01
// decisions: (2) "Other carrier" badge only when the carrier matches neither LISMA* nor SEAL* (the
// candidates query's own prefixes) — legacy flagged every non-Lisma row, i.e. every Seal row;
// (3) the live loading_assignments.trailer_number is copied onto `trailer_no` before rendering
// (preview AND send), matching the v2 BOL viewer — never replay the frozen bols.trailer_no
// (render_overrides.trailerNo still wins inside generatePdf). Failures show inline banners, not
// alert(); removals use the house two-step arm/confirm, not window.confirm(). English only (i18n
// backlogged). Each BOL is attached as its own driver-copy PDF via bolDomGlue.buildSingleCopyPdf.
import { useCallback, useEffect, useRef, useState } from "react";
import PlatformHeader from "@/components/PlatformHeader";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";
import { buildSingleCopyPdf } from "@/lib/bolDomGlue";
import type { BolRecord } from "@/lib/bolShared";

type Rec = Record<string, any>;

interface QueueRow {
  id: string;
  record: Rec;
  checked: boolean;
}

interface Recipient {
  id: number;
  email: string;
  name: string | null;
  is_selected: number | boolean | null;
}

interface Holiday {
  id: number;
  holiday_date: string;
  label: string | null;
}

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

const API = "/v2/api/bol-email";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KNOWN_CARRIER_RE = /^(LISMA|SEAL)/i;

async function api(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: any; error: string | null }> {
  try {
    const res = await fetch(API + path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const msg = data?.error || `HTTP ${res.status}`;
      return { ok: false, data, error: data?.detail ? `${msg} — ${data.detail}` : msg };
    }
    return { ok: true, data, error: null };
  } catch (e: any) {
    return { ok: false, data: null, error: e?.message || "Network error" };
  }
}

function dash(v: unknown): string {
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

function prettyDate(ds: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return ds || "—";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(ds + "T12:00:00")
  );
}

function isOtherCarrier(r: Rec): boolean {
  return !KNOWN_CARRIER_RE.test(String(r.carrier_name || ""));
}

// Decision 3: live trailer onto the record before rendering.
function forRender(r: Rec): BolRecord {
  const live = r.trailer_number;
  return (live != null && String(live).trim() !== "" ? { ...r, trailer_no: String(live) } : r) as BolRecord;
}

function filenameFor(r: Rec): string {
  const inv = r.invoice_number || r.bol_number || r.id;
  const cust = String(r.customer || "").replace(/[^\w-]+/g, "_");
  return `BOL-${inv}-${cust}.pdf`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  }
  return btoa(bin);
}

function RowLabel({ r }: { r: Rec }) {
  return (
    <>
      <span className="text-text">{dash(r.customer)}</span>
      <span className="text-muted"> · </span>
      <span className="text-text">{dash(r.invoice_number || r.bol_number)}</span>
      <span className="text-muted">
        {" "}
        · Load {dash(r.load_number)} · Trailer {dash(r.trailer_number)} · Bay {dash(r.bay_number || r.bay_label)}
      </span>
    </>
  );
}

const btnSm =
  "min-h-[44px] md:min-h-[32px] px-3 rounded border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-text cursor-pointer disabled:opacity-50";
const btnDangerSm =
  "min-h-[44px] md:min-h-[32px] px-3 rounded bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs font-semibold cursor-pointer disabled:opacity-50";
const inputCls =
  "min-h-[44px] md:min-h-[36px] px-3 rounded border border-[var(--input-border)] bg-[var(--surface)] text-sm text-text";

export default function BolEmailQueue({ userName, isAdmin, permissions }: Props) {
  // ── Queue ──────────────────────────────────────────────────────────────
  const [shipDate, setShipDate] = useState("");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [candLoading, setCandLoading] = useState(true);
  const [candError, setCandError] = useState<string | null>(null);

  // ── Recipients / closures ──────────────────────────────────────────────
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const recipientsRef = useRef<Recipient[]>([]);
  const [checkedRids, setCheckedRids] = useState<Set<number>>(new Set());
  const [recError, setRecError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingRid, setEditingRid] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [armedRid, setArmedRid] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holError, setHolError] = useState<string | null>(null);
  const [holDate, setHolDate] = useState("");
  const [holLabel, setHolLabel] = useState("");
  const [armedHid, setArmedHid] = useState<number | null>(null);

  // ── Search ─────────────────────────────────────────────────────────────
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Rec[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  // ── Send / preview ─────────────────────────────────────────────────────
  const [sendPhase, setSendPhase] = useState<null | "rendering" | "sending">(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; src: string | null; error: string | null } | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewSeqRef = useRef(0);

  const loadCandidates = useCallback(async () => {
    setCandLoading(true);
    const { ok, data, error } = await api("GET", "/candidates");
    setCandLoading(false);
    if (!ok) {
      setCandError(`Failed to load BOLs: ${error}`);
      setRows([]);
      return;
    }
    setCandError(null);
    setShipDate(data.ship_date || "");
    const seen = new Set<string>();
    const next: QueueRow[] = [];
    for (const record of (data.candidates || []) as Rec[]) {
      const id = String(record.id);
      if (seen.has(id)) continue;
      seen.add(id);
      next.push({ id, record, checked: true });
    }
    setRows(next);
  }, []);

  const loadRecipients = useCallback(async () => {
    const { ok, data, error } = await api("GET", "/recipients");
    if (!ok) {
      setRecError(`Failed to load recipients: ${error}`);
      return;
    }
    setRecError(null);
    const list: Recipient[] = data.recipients || [];
    // Legacy prevIds: only ids new to this page take their server is_selected; existing ids keep
    // whatever the user has checked here.
    const prevIds = new Set(recipientsRef.current.map((r) => r.id));
    setCheckedRids((prev) => {
      const next = new Set(prev);
      for (const r of list) {
        if (!prevIds.has(r.id)) {
          if (r.is_selected) next.add(r.id);
          else next.delete(r.id);
        }
      }
      for (const id of Array.from(next)) if (!list.some((r) => r.id === id)) next.delete(id);
      return next;
    });
    recipientsRef.current = list;
    setRecipients(list);
  }, []);

  const loadHolidays = useCallback(async () => {
    const { ok, data, error } = await api("GET", "/holidays");
    if (!ok) {
      setHolError(`Failed to load plant closures: ${error}`);
      return;
    }
    setHolError(null);
    setHolidays(data.holidays || []);
  }, []);

  useEffect(() => {
    void Promise.all([loadCandidates(), loadRecipients(), loadHolidays()]);
  }, [loadCandidates, loadRecipients, loadHolidays]);

  // ── Search (debounced 250ms) ───────────────────────────────────────────
  useEffect(() => {
    const q = term.trim();
    if (!q) {
      setResults(null);
      setSearchOpen(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { ok, data } = await api("GET", `/search?q=${encodeURIComponent(q)}`);
      if (cancelled) return;
      if (!ok || !Array.isArray(data?.results)) {
        setResults(null);
        setSearchOpen(false);
        return;
      }
      setResults(data.results.slice(0, 20));
      setSearchOpen(true);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  function addFromSearch(record: Rec) {
    const id = String(record.id);
    setRows((prev) => (prev.some((r) => r.id === id) ? prev : [...prev, { id, record, checked: true }]));
    setTerm("");
    setResults(null);
    setSearchOpen(false);
  }

  // ── Recipients ─────────────────────────────────────────────────────────
  function toggleEditMode() {
    setEditMode((m) => !m);
    setEditingRid(null);
    setArmedRid(null);
    setRecError(null);
  }

  async function addRecipient() {
    const email = newEmail.trim();
    const name = newName.trim();
    if (!EMAIL_RE.test(email)) {
      setRecError("Enter a valid email address.");
      return;
    }
    const { ok, error } = await api("POST", "/recipients", { email, name });
    if (!ok) {
      setRecError(`Failed to add recipient: ${error}`);
      return;
    }
    setNewEmail("");
    setNewName("");
    await loadRecipients();
  }

  async function saveRecipient(id: number) {
    const email = editEmail.trim();
    const name = editName.trim();
    if (!EMAIL_RE.test(email)) {
      setRecError("Enter a valid email address.");
      return;
    }
    setEditingRid(null);
    const { ok, error } = await api("PUT", `/recipients/${id}`, { email, name });
    if (!ok) setRecError(`Failed to update recipient: ${error}`);
    await loadRecipients();
  }

  async function deleteRecipient(id: number) {
    setArmedRid(null);
    const { ok, error } = await api("DELETE", `/recipients/${id}`);
    if (!ok) {
      setRecError(`Failed to remove recipient: ${error}`);
      return;
    }
    setCheckedRids((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await loadRecipients();
  }

  // ── Closures ───────────────────────────────────────────────────────────
  async function addHoliday() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holDate)) {
      setHolError("Pick a date.");
      return;
    }
    const { ok, error } = await api("POST", "/holidays", { holiday_date: holDate, label: holLabel.trim() });
    if (!ok) {
      setHolError(`Failed to add closure: ${error}`);
      return;
    }
    setHolDate("");
    setHolLabel("");
    await loadHolidays();
    void loadCandidates();
  }

  async function deleteHoliday(id: number) {
    setArmedHid(null);
    const { ok, error } = await api("DELETE", `/holidays/${id}`);
    if (!ok) {
      setHolError(`Failed to remove closure: ${error}`);
      return;
    }
    await loadHolidays();
    void loadCandidates();
  }

  // ── Send ───────────────────────────────────────────────────────────────
  const selected = rows.filter((r) => r.checked);
  const recCount = checkedRids.size;

  async function sendNow() {
    if (selected.length === 0 || recCount === 0 || sendPhase) return;
    setSendError(null);
    setSendPhase("rendering");
    const attachments: { filename: string; content: string }[] = [];
    try {
      for (const row of selected) {
        const bytes = await buildSingleCopyPdf([forRender(row.record)], "driver");
        attachments.push({ filename: filenameFor(row.record), content: bytesToBase64(bytes) });
      }
    } catch (e: any) {
      console.error("BOL render failed:", e);
      setSendError(`Failed to render BOLs: ${e?.message || e}`);
      setSendPhase(null);
      return;
    }

    setSendPhase("sending");
    const { ok, data, error } = await api("POST", "/send", {
      ship_date: shipDate,
      delivery_count: attachments.length,
      attachments,
      recipient_ids: Array.from(checkedRids),
    });
    setSendPhase(null);
    if (!ok) {
      setSendError(`Send failed: ${error}`);
      return;
    }
    setToast(`Sent ${data.sent} BOL(s) to ${data.recipients} recipient(s)`);
    setTimeout(() => setToast(null), 3000);
    void loadCandidates();
    void loadRecipients();
  }

  // ── Preview ────────────────────────────────────────────────────────────
  function revokePreviewUrl() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }

  async function openPreview(row: QueueRow) {
    const seq = ++previewSeqRef.current;
    revokePreviewUrl();
    setPreview({ title: filenameFor(row.record).replace(/\.pdf$/i, ""), src: null, error: null });
    try {
      const bytes = await buildSingleCopyPdf([forRender(row.record)], "driver");
      if (seq !== previewSeqRef.current) return;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      previewUrlRef.current = url;
      setPreview((p) => (p ? { ...p, src: url } : p));
    } catch (e: any) {
      if (seq !== previewSeqRef.current) return;
      setPreview((p) => (p ? { ...p, error: `Could not render BOL: ${e?.message || e}` } : p));
    }
  }

  function closePreview() {
    previewSeqRef.current++;
    revokePreviewUrl();
    setPreview(null);
  }

  useEffect(() => () => revokePreviewUrl(), []);

  const sendLabel = sendPhase === "rendering" ? "Rendering…" : sendPhase === "sending" ? "Sending…" : "Send";

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="BOL Email Queue"
        currentPath="/v2/logistics/bol-email"
      />

      <div className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 space-y-4">
        <p className="text-sm text-muted">
          BOL Email Queue — next shipping day&apos;s carrier shipments{shipDate ? ` (${prettyDate(shipDate)})` : ""}
        </p>

        <div className="flex flex-col md:flex-row gap-4 items-start">
          {/* ── Queue column ── */}
          <div className="flex-1 min-w-0 w-full space-y-3">
            <div ref={searchWrapRef} className="relative">
              <input
                type="text"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onFocus={() => results && setSearchOpen(true)}
                placeholder="Add a BOL manually — search by customer or BOL #…"
                autoComplete="off"
                className={`${inputCls} w-full`}
              />
              {searchOpen && results && (
                <div className="absolute z-20 left-0 right-0 mt-1 max-h-80 overflow-y-auto rounded border border-[var(--border)] bg-[var(--surface)]">
                  {results.length === 0 ? (
                    <div className="px-3 py-2.5 text-sm text-muted">No matches</div>
                  ) : (
                    results.map((r) => (
                      <button
                        key={String(r.id)}
                        type="button"
                        onClick={() => addFromSearch(r)}
                        className="block w-full text-left px-3 py-2.5 min-h-[44px] text-sm border-b border-[var(--border)] last:border-0 hover:bg-[var(--ghost-bg)] cursor-pointer"
                      >
                        <RowLabel r={r} />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="rounded border border-[var(--border)] bg-[var(--surface)]">
              {candError ? (
                <div className="flex items-center justify-between gap-3 px-3 py-3 bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm">
                  <span>{candError}</span>
                  <button type="button" onClick={() => void loadCandidates()} className={btnSm}>
                    Retry
                  </button>
                </div>
              ) : candLoading && rows.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted text-center">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted text-center">
                  No carrier BOLs found for {prettyDate(shipDate)}.
                </div>
              ) : (
                rows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center gap-2 px-3 min-h-[48px] border-b border-[var(--border)] last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={(e) =>
                        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, checked: e.target.checked } : r)))
                      }
                      className="w-5 h-5 shrink-0 cursor-pointer"
                      aria-label={`Include ${dash(row.record.customer)}`}
                    />
                    <button
                      type="button"
                      onClick={() => void openPreview(row)}
                      title="Click to preview"
                      className="flex-1 min-w-0 text-left text-sm py-2 cursor-pointer hover:underline"
                    >
                      <RowLabel r={row.record} />
                      {isOtherCarrier(row.record) && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)]">
                          Other carrier
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                      title="Remove from this send"
                      aria-label="Remove from this send"
                      className="w-11 h-11 md:w-8 md:h-8 shrink-0 rounded text-lg text-muted hover:bg-[var(--ghost-bg)] cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            {sendError && (
              <div className="rounded border border-[var(--danger-bg)] px-3 py-2.5 text-sm text-[var(--danger-bg)] whitespace-pre-wrap break-words">
                {sendError}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              <span className="text-sm text-muted">
                Shipping {prettyDate(shipDate)} · {selected.length} BOL{selected.length === 1 ? "" : "s"} · {recCount}{" "}
                recipient{recCount === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => void sendNow()}
                disabled={selected.length === 0 || recCount === 0 || sendPhase !== null}
                className="min-h-[44px] px-5 rounded bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendLabel}
              </button>
            </div>
          </div>

          {/* ── Recipients column ── */}
          <div className="w-full md:w-[320px] shrink-0 rounded border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
              <h3 className="text-sm font-semibold text-text">Recipients</h3>
              <button type="button" onClick={toggleEditMode} className={btnSm}>
                {editMode ? "Done" : "Edit"}
              </button>
            </div>
            {recError && <p className="px-3 pt-2 text-xs text-[var(--danger-bg)]">{recError}</p>}
            <div className="p-2 space-y-1">
              {recipients.map((r) =>
                editMode && editingRid === r.id ? (
                  <div key={r.id} className="space-y-1.5 p-1.5 rounded bg-[var(--ghost-bg)]">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Name"
                      className={`${inputCls} w-full`}
                    />
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="Email"
                      className={`${inputCls} w-full`}
                    />
                    <div className="flex gap-1.5 justify-end">
                      <button type="button" onClick={() => void saveRecipient(r.id)} className={btnSm}>
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingRid(null)} className={btnSm}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={r.id} className="flex items-center gap-2 min-h-[44px] px-1">
                    <label className="flex-1 min-w-0 flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checkedRids.has(r.id)}
                        onChange={(e) =>
                          setCheckedRids((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          })
                        }
                        className="w-5 h-5 shrink-0 cursor-pointer"
                      />
                      <span className="truncate text-text">
                        {r.name ? `${r.name} — ` : ""}
                        {r.email}
                      </span>
                    </label>
                    {editMode &&
                      (armedRid === r.id ? (
                        <div className="flex gap-1 shrink-0">
                          <button type="button" onClick={() => void deleteRecipient(r.id)} className={btnDangerSm}>
                            Remove
                          </button>
                          <button type="button" onClick={() => setArmedRid(null)} className={btnSm}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setArmedRid(null);
                              setEditingRid(r.id);
                              setEditName(r.name || "");
                              setEditEmail(r.email);
                            }}
                            title="Edit"
                            aria-label={`Edit ${r.email}`}
                            className="w-11 h-11 md:w-8 md:h-8 rounded text-muted hover:bg-[var(--ghost-bg)] cursor-pointer"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            onClick={() => setArmedRid(r.id)}
                            title="Remove"
                            aria-label={`Remove ${r.email}`}
                            className="w-11 h-11 md:w-8 md:h-8 rounded text-lg text-[var(--danger-bg)] hover:bg-[var(--ghost-bg)] cursor-pointer"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                  </div>
                )
              )}
              {recipients.length === 0 && !recError && <p className="px-1 py-2 text-sm text-muted">No recipients yet.</p>}
              {editMode && (
                <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Name (optional)"
                    className={`${inputCls} w-full`}
                  />
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="Email"
                    className={`${inputCls} w-full`}
                  />
                  <div className="flex justify-end">
                    <button type="button" onClick={() => void addRecipient()} className={btnSm}>
                      Add recipient
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Plant closures ── */}
        <details className="rounded border border-[var(--border)] bg-[var(--surface)]">
          <summary className="px-3 py-3 min-h-[44px] text-sm font-semibold text-text cursor-pointer">
            Plant closures (skipped when picking the ship day)
          </summary>
          <div className="px-3 pb-3 space-y-2">
            {holError && <p className="text-xs text-[var(--danger-bg)]">{holError}</p>}
            {holidays.length === 0 ? (
              <p className="text-sm text-muted">No closures listed.</p>
            ) : (
              holidays.map((h) => (
                <div key={h.id} className="flex items-center gap-3 min-h-[44px] text-sm border-b border-[var(--border)] last:border-0">
                  <span className="text-text tabular-nums">{h.holiday_date}</span>
                  <span className="flex-1 min-w-0 truncate text-muted">{h.label || ""}</span>
                  {armedHid === h.id ? (
                    <div className="flex gap-1 shrink-0">
                      <button type="button" onClick={() => void deleteHoliday(h.id)} className={btnDangerSm}>
                        Remove
                      </button>
                      <button type="button" onClick={() => setArmedHid(null)} className={btnSm}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setArmedHid(h.id)}
                      title="Remove"
                      aria-label={`Remove closure ${h.holiday_date}`}
                      className="w-11 h-11 md:w-8 md:h-8 shrink-0 rounded text-lg text-[var(--danger-bg)] hover:bg-[var(--ghost-bg)] cursor-pointer"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <input type="date" value={holDate} onChange={(e) => setHolDate(e.target.value)} className={inputCls} />
              <input
                type="text"
                value={holLabel}
                onChange={(e) => setHolLabel(e.target.value)}
                placeholder="Label (e.g. Thanksgiving)"
                className={`${inputCls} flex-1 min-w-[160px]`}
              />
              <button type="button" onClick={() => void addHoliday()} className={btnSm}>
                Add
              </button>
            </div>
          </div>
        </details>
      </div>

      <Modal isOpen={preview !== null} onClose={closePreview} title={preview?.title || "BOL preview"} size="xl">
        {preview?.error ? (
          <p className="text-sm text-[var(--danger-bg)] py-6 text-center">{preview.error}</p>
        ) : preview?.src ? (
          <PdfViewer src={preview.src} filename={`${preview.title}.pdf`} title="BOL preview" height={560} />
        ) : (
          <p className="text-sm text-muted py-6 text-center">Rendering BOL…</p>
        )}
      </Modal>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded text-sm font-medium pointer-events-none bg-[var(--success-bg)] text-[var(--success-text)]"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
