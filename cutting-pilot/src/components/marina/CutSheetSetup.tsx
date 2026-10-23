"use client";
// src/components/marina/CutSheetSetup.tsx — marina-05
// /v2/qc/marina/[jobId]/setup/[fileId] — turn a cut-sheet PDF into parts, one page at a time. The page
// is drawn for reference; its text (pdf.js getTextContent → cutSheet.ts) prefills the label, notes and
// tappable dim chips. Pages are read lazily as you navigate (never all up front). Each page is POSTed
// as one part on "Save & next", so a reload loses at most the page in progress; a page with a part on
// this file + page_no is Done (read-only here — edit from the job page). Skips are session-only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArrowLeft, Maximize2 } from "lucide-react";
import Modal from "@/components/Modal";
import PlatformHeader from "@/components/PlatformHeader";
import { loadPdfJs } from "@/lib/pdfjs";
import { fallbackLabelFor, suggestFromPage, textItemsFromContent, type PageSuggestion } from "@/lib/marina/cutSheet";
import type { MarinaJobDetail as Detail, MarinaPartSummary } from "@/lib/marina/types";
import PartEditor, { checkDraft, dimsPayload, draftFromPart, emptyDraft, type PartDraft } from "./PartEditor";
import { API, CARD, ERROR_TEXT, GHOST, PRIMARY, jsonInit, marinaFetch, plural } from "./ui";

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
  canEdit: boolean;
  jobId: string;
  fileId: string;
}

interface PageDraft { draft: PartDraft; dirty: boolean; suggestion: PageSuggestion; }

export default function CutSheetSetup({ userName, isAdmin, permissions, canEdit, jobId, fileId }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const [drafts, setDrafts] = useState<Record<number, PageDraft>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [enlarge, setEnlarge] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const suggestions = useRef(new Map<number, PageSuggestion>());

  const jobHref = `/v2/qc/marina/${encodeURIComponent(jobId)}`;

  const load = useCallback(async () => {
    const r = await marinaFetch<{ detail: Detail }>(`/jobs/${encodeURIComponent(jobId)}`);
    if (!r.ok) {
      if (r.status === 404) setNotFound(true);
      else setLoadError(r.error);
      return;
    }
    setLoadError(null);
    setDetail(r.data.detail);
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  const file = detail?.files.find((f) => f.id === fileId) ?? null;
  const problem = !detail
    ? null
    : !file
      ? "This file isn't part of this job."
      : file.kind !== "cut_sheet"
        ? "Only cut sheets can be set up — this file is a customer drawing."
        : file.superseded_at
          ? "This cut sheet has been superseded — set up parts from the current one."
          : detail.job.status !== "open"
            ? "This job is complete — reopen it to set up parts."
            : !canEdit
              ? "You don't have permission to set up parts."
              : null;
  const ready = !!detail && !problem;

  // Load the PDF once the checks pass; destroy it on unmount.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}`);
        if (!res.ok) throw new Error(`Couldn't download the cut sheet (HTTP ${res.status}).`);
        const data = new Uint8Array(await res.arrayBuffer());
        const lib = await loadPdfJs();
        doc = await lib.getDocument({ data }).promise;
        if (cancelled) {
          doc.destroy().catch(() => {});
          return;
        }
        setPdf(doc);
      } catch (e: any) {
        if (!cancelled) setPdfError(String(e?.message || e) || "Couldn't open the cut sheet.");
      }
    })();
    return () => {
      cancelled = true;
      setPdf(null);
      doc?.destroy().catch(() => {});
    };
  }, [ready, fileId]);

  const doneByPage = useMemo(() => {
    const m = new Map<number, MarinaPartSummary>();
    for (const p of detail?.parts ?? []) if (p.file_id === fileId && p.page_no != null && !m.has(p.page_no)) m.set(p.page_no, p);
    return m;
  }, [detail, fileId]);
  const setUpCount = (detail?.parts ?? []).filter((p) => p.file_id === fileId).length;
  const numPages = pdf?.numPages ?? null;

  // Next to-do page after `from` (wrapping), skipping Done and skipped pages; null when none is left.
  const nextTodo = useCallback(
    (from: number, done: Map<number, MarinaPartSummary>, skip: Set<number>): number | null => {
      if (!numPages) return null;
      for (let i = 1; i <= numPages; i++) {
        const n = ((from - 1 + i) % numPages) + 1;
        if (n !== from && !done.has(n) && !skip.has(n)) return n;
      }
      return null;
    },
    [numPages]
  );

  // Start at the first to-do page.
  useEffect(() => {
    if (!numPages || current !== null || finished) return;
    for (let n = 1; n <= numPages; n++) {
      if (!doneByPage.has(n)) {
        setCurrent(n);
        return;
      }
    }
    setFinished(true);
  }, [numPages, current, finished, doneByPage]);

  // Read the current page's text lazily (cached) and seed its draft.
  useEffect(() => {
    if (!pdf || current === null || doneByPage.has(current) || drafts[current]) return;
    let cancelled = false;
    const n = current;
    (async () => {
      let s = suggestions.current.get(n);
      if (!s) {
        try {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          s = suggestFromPage(textItemsFromContent(content.items), fallbackLabelFor(file?.filename ?? null, n));
        } catch {
          s = suggestFromPage([], fallbackLabelFor(file?.filename ?? null, n));
        }
        suggestions.current.set(n, s);
      }
      if (cancelled) return;
      const sug = s;
      setDrafts((d) => (d[n] ? d : { ...d, [n]: { draft: emptyDraft(sug.label, sug.notes), dirty: false, suggestion: sug } }));
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, current, doneByPage, drafts, file?.filename]);

  const cur = current !== null ? drafts[current] : undefined;
  const dirty = !!cur?.dirty;

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function goTo(n: number) {
    setSaveError(null);
    setFinished(false);
    setConfirmLeave(false);
    setCurrent(n);
  }

  function advance(from: number, done: Map<number, MarinaPartSummary>, skip: Set<number>) {
    const next = nextTodo(from, done, skip);
    setSaveError(null);
    if (next === null) {
      setCurrent(null);
      setFinished(true);
    } else {
      setCurrent(next);
    }
  }

  function skip() {
    if (current === null) return;
    const s = new Set(skipped);
    s.add(current);
    setSkipped(s);
    advance(current, doneByPage, s);
  }

  async function saveAndNext() {
    if (current === null || !cur || !file) return;
    const n = current;
    setSaving(true);
    setSaveError(null);
    const notes = cur.draft.notes.trim();
    const r = await marinaFetch<{ detail: Detail }>(
      `/jobs/${encodeURIComponent(jobId)}/parts`,
      jsonInit("POST", {
        parts: [{ label: cur.draft.label.trim(), notes: notes || null, file_id: file.id, page_no: n, dims: dimsPayload(cur.draft) }],
      })
    );
    setSaving(false);
    if (!r.ok) {
      setSaveError(r.error);
      return;
    }
    // The create route returns the re-read job detail — same payload as GET /jobs/{id}.
    const fresh = r.data.detail;
    setDetail(fresh);
    setDrafts((d) => {
      const { [n]: _gone, ...rest } = d;
      return rest;
    });
    const done = new Map<number, MarinaPartSummary>();
    for (const p of fresh.parts) if (p.file_id === fileId && p.page_no != null && !done.has(p.page_no)) done.set(p.page_no, p);
    const s = new Set(skipped);
    s.delete(n);
    setSkipped(s);
    advance(n, done, s);
  }

  const header = (
    <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Quality Control · v2" currentPath="/v2/qc" />
  );
  const backLink = (
    <a
      href={jobHref}
      onClick={(e) => {
        if (dirty) {
          e.preventDefault();
          setConfirmLeave(true);
        }
      }}
      className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] no-underline"
    >
      <ArrowLeft size={16} aria-hidden="true" /> Back to job
    </a>
  );

  if (notFound || loadError || !detail || problem) {
    return (
      <div className="min-h-screen flex flex-col bg-bg text-text">
        {header}
        <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 space-y-4">
          <a href={notFound ? "/v2/qc/marina" : jobHref} className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] no-underline">
            <ArrowLeft size={16} aria-hidden="true" /> {notFound ? "Marina Foam jobs" : "Back to job"}
          </a>
          {notFound ? (
            <div className={`${CARD} space-y-1`}>
              <h1 className="text-lg font-bold">Job not found</h1>
              <p className="text-sm text-muted">It may have been deleted.</p>
            </div>
          ) : loadError ? (
            <div role="alert" className={`${CARD} space-y-3`}>
              <p className={ERROR_TEXT}>{loadError}</p>
              <button type="button" className={GHOST} onClick={() => { setLoadError(null); load(); }}>Retry</button>
            </div>
          ) : problem ? (
            <div role="alert" className={`${CARD} space-y-1`}>
              <h1 className="text-lg font-bold">Can&apos;t set up this file</h1>
              <p className="text-sm text-muted">{problem}</p>
            </div>
          ) : (
            <div className={`${CARD} space-y-2 animate-pulse`} aria-busy="true" aria-label="Loading">
              <div className="h-6 w-1/2 rounded bg-[var(--ghost-bg)]" />
              <div className="h-4 w-1/3 rounded bg-[var(--ghost-bg)]" />
            </div>
          )}
        </div>
      </div>
    );
  }

  const name = file?.filename || "Cut sheet";
  const doneHere = current !== null ? doneByPage.get(current) : undefined;
  const otherLabels = detail.parts.map((p) => p.label);
  const check = cur ? checkDraft(cur.draft, "all") : null;
  const canSave = !!check?.ok && !saving;

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      {header}
      <div className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 space-y-4 min-w-0">
        {backLink}
        {confirmLeave && (
          <div role="alert" className="rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] p-3 space-y-2">
            <p className="text-sm font-semibold text-[var(--info-text)]">Page {current} has unsaved changes — leave without saving?</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setConfirmLeave(false)}>Stay</button>
              <a href={jobHref} className={`${PRIMARY} no-underline`}>Leave</a>
            </div>
          </div>
        )}

        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight break-words">Set up parts</h1>
          <p className="text-sm text-muted break-words">
            {detail.job.name} · {name}
            {numPages ? ` · ${setUpCount} of ${plural(numPages, "page")} set up` : ""}
          </p>
        </div>

        {pdfError ? (
          <div role="alert" className={`${CARD} space-y-3`}>
            <p className={ERROR_TEXT}>{pdfError}</p>
            <a href={jobHref} className={`${GHOST} no-underline`}>Back to job</a>
          </div>
        ) : !numPages ? (
          <div className={`${CARD} animate-pulse`} aria-busy="true">
            <p className="text-sm text-muted">Opening the cut sheet…</p>
          </div>
        ) : (
          <>
            <nav aria-label="Pages" className="-mx-4 px-4 overflow-x-auto">
              <ol className="flex gap-2 pb-1 w-max">
                {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => {
                  const done = doneByPage.get(n);
                  const isCur = n === current;
                  const isSkip = !done && skipped.has(n);
                  const state = isCur ? "current" : done ? "done" : isSkip ? "skipped" : "to do";
                  return (
                    <li key={n}>
                      <button
                        type="button"
                        onClick={() => goTo(n)}
                        aria-current={isCur ? "page" : undefined}
                        aria-label={`Page ${n}: ${done ? `done — ${done.label}` : state}`}
                        className={`inline-flex items-center gap-1.5 min-h-[44px] min-w-[44px] px-3 rounded-lg border text-sm font-semibold cursor-pointer whitespace-nowrap ${
                          isCur
                            ? "bg-[var(--brand)] text-white border-[var(--brand)]"
                            : done
                              ? "bg-[var(--loaded-bg)] text-[var(--loaded-text)] border-[var(--loaded-border)]"
                              : isSkip
                                ? "bg-surface text-muted border-dashed border-[var(--input-border)]"
                                : "bg-surface text-text border-[var(--input-border)] hover:bg-[var(--ghost-bg)]"
                        }`}
                      >
                        <span>{n}</span>
                        {done && <span className="max-w-[9rem] truncate font-normal">{done.label}</span>}
                        {isSkip && <span className="font-normal">skipped</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            {finished || current === null ? (
              <div className={`${CARD} space-y-3`} role="status">
                <h2 className="text-lg font-bold">All pages handled — {plural(setUpCount, "part")} set up</h2>
                {skipped.size > 0 && (
                  <p className="text-sm text-muted">
                    {plural(skipped.size, "page")} skipped — tap {skipped.size === 1 ? "it" : "one"} above to set it up after all.
                  </p>
                )}
                <a href={jobHref} className={`${PRIMARY} no-underline`}>Back to job</a>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
                <section className={`${CARD} space-y-2 min-w-0`} aria-label={`Page ${current} image`}>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-bold">Page {current} of {numPages}</h2>
                    <button type="button" className={GHOST} onClick={() => setEnlarge(true)}>
                      <Maximize2 size={16} aria-hidden="true" /> Enlarge
                    </button>
                  </div>
                  <PageCanvas pdf={pdf!} pageNo={current} />
                </section>

                <section className={`${CARD} space-y-4 min-w-0`} aria-label={`Page ${current} part`}>
                  {doneHere ? (
                    <>
                      <p role="status" className="rounded-lg border border-[var(--loaded-border)] bg-[var(--loaded-bg)] text-[var(--loaded-text)] text-sm font-semibold px-3 py-2">
                        Already set up — edit it from the job page.
                      </p>
                      <PartEditor draft={draftFromPart(doneHere)} onChange={() => {}} readOnly idPrefix={`done-${current}`} />
                    </>
                  ) : !cur ? (
                    <p className="text-sm text-muted animate-pulse">Reading page {current}…</p>
                  ) : (
                    <>
                      <PartEditor
                        key={current}
                        idPrefix={`page-${current}`}
                        draft={cur.draft}
                        onChange={(next) => setDrafts((d) => ({ ...d, [current]: { ...d[current], draft: next, dirty: true } }))}
                        chips={cur.suggestion.chips}
                        hasText={cur.suggestion.hasText}
                        labelHint={cur.suggestion.labelFromText ? null : "Couldn't read the label — check it."}
                        existingLabels={otherLabels}
                      />
                      {saveError && <p role="alert" className={ERROR_TEXT}>{saveError}</p>}
                    </>
                  )}
                  <div className="flex flex-wrap justify-end gap-2 pt-1">
                    {doneHere ? (
                      <button type="button" className={PRIMARY} onClick={() => advance(current, doneByPage, skipped)}>Next page</button>
                    ) : (
                      <>
                        <button type="button" className={GHOST} onClick={skip} disabled={saving}>Skip page</button>
                        <button type="button" className={PRIMARY} onClick={saveAndNext} disabled={!canSave}>
                          {saving ? "Saving…" : "Save & next"}
                        </button>
                      </>
                    )}
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </div>

      {pdf && current !== null && (
        <Modal isOpen={enlarge} onClose={() => setEnlarge(false)} title={`Page ${current} of ${numPages}`} size="xl">
          <div className="overflow-auto max-h-[70vh] rounded-lg border border-[var(--border)]">
            <PageCanvas pdf={pdf} pageNo={current} fixedScale={2} />
          </div>
        </Modal>
      )}
    </div>
  );
}

// One PDF page on a canvas: container width × devicePixelRatio (cap 2), or a fixed CSS scale (Enlarge).
// The in-flight render is cancelled and awaited before the next one (pdf.js rejects two renders on one
// canvas). Reference only — no click-to-pick.
function PageCanvas({ pdf, pageNo, fixedScale }: { pdf: PDFDocumentProxy; pageNo: number; fixedScale?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<{ promise: Promise<unknown>; cancel: () => void } | null>(null);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (fixedScale) return;
    const el = wrapRef.current;
    if (!el) return;
    setWidth(Math.floor(el.clientWidth));
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (Math.abs(prev - w) >= 2 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedScale]);

  useEffect(() => {
    if (!fixedScale && !width) return;
    let cancelled = false;
    (async () => {
      const prev = taskRef.current;
      if (prev) {
        prev.cancel();
        await prev.promise.catch(() => {});
      }
      try {
        const page = await pdf.getPage(pageNo);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        const cssScale = fixedScale ?? width / base.width;
        const dpr = fixedScale ? 1 : Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale: cssScale * dpr });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = `${Math.floor(base.width * cssScale)}px`;
        canvas.style.height = `${Math.floor(base.height * cssScale)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const task = page.render({ canvasContext: ctx, viewport: vp });
        taskRef.current = task;
        await task.promise;
        if (!cancelled) setError(false);
      } catch (e: any) {
        if (!cancelled && e?.name !== "RenderingCancelledException") setError(true);
      }
    })();
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [pdf, pageNo, width, fixedScale]);

  return (
    <div ref={wrapRef} className={fixedScale ? "w-max" : "w-full"}>
      <canvas ref={canvasRef} className="block rounded" aria-label={`Cut sheet page ${pageNo}`} role="img" />
      {error && <p className={ERROR_TEXT}>Couldn&apos;t draw this page.</p>}
    </div>
  );
}
