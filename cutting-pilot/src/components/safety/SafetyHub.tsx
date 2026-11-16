"use client";
// src/components/safety/SafetyHub.tsx  (saf-02) — /v2/safety hub.
// Emergency strip first (static, renders even if the API fails), then the training column (GET /v2/api/safety/me:
// progress over READY blocks + one card per ready block) and the side column (SDS Library, Training records for
// safety.manage, compliance fine print). Phone: one column, SDS collapses to a single full-width button above training.
import { useCallback, useEffect, useState } from "react";
import { Phone, ArrowRight } from "lucide-react";
import { useLang } from "@/components/lang";
import LangSelect from "@/components/LangSelect";
import { readyBlocks } from "@/lib/safety/trainingBlocks";
import { blockText, formatYmd } from "@/lib/safety/blockText";
import {
  BTN_OUTLINE, BTN_PRIMARY, CARD, CHIP_DONE, CHIP_TODO, FOCUS, SDS_BROWSE_URL, SDS_URL, fetchMe, fill, type MeCompletion,
} from "./safetyUi";

type Load = { state: "loading" } | { state: "error" } | { state: "ok"; completions: MeCompletion[] };

export default function SafetyHub({ canManage }: { canManage: boolean }) {
  const { lang, t } = useLang();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const me = await fetchMe();
      setLoad({ state: "ok", completions: me.completions });
    } catch {
      setLoad({ state: "error" });
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const blocks = readyBlocks();
  // /me is newest first → the first row seen per block is the latest completion.
  const latest = new Map<string, string>();
  if (load.state === "ok") for (const c of load.completions) if (!latest.has(c.block_id)) latest.set(c.block_id, c.completed_on);
  const done = blocks.filter((b) => latest.has(b.id)).length;
  const pct = blocks.length ? Math.round((done / blocks.length) * 100) : 0;

  return (
    <main className="w-full max-w-[1320px] mx-auto px-4 pt-6 pb-12 flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-bold tracking-tight">{t("safety.pageTitle")}</h1>
          <p className="m-0 text-sm text-muted">{t("safety.subtitle")}</p>
        </div>
        <LangSelect />
      </div>

      {/* Emergency — always first, never depends on the API. */}
      <section
        aria-label={t("safety.emergencyTitle").replace(/:$/, "")}
        data-testid="emergency"
        className="rounded-xl border border-[var(--danger-soft-border)] bg-[var(--danger-soft-bg)] text-danger-ink px-4 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-3"
      >
        <div className="flex-[1_1_320px] min-w-0">
          <div className="text-[13px] font-bold uppercase tracking-wider">{t("safety.emergencyTitle").replace(/:$/, "")}</div>
          <div className="mt-0.5 text-[15px]">{t("safety.emergencyBody")}</div>
          <div className="mt-0.5 text-[13px]">{t("safety.poisonBody")}</div>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 w-full sm:w-auto">
          <a
            href="tel:911"
            className={`min-h-[48px] sm:min-h-[44px] inline-flex items-center justify-center gap-2 px-4 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] font-bold text-[15px] no-underline hover:opacity-90 ${FOCUS}`}
          >
            <Phone size={18} aria-hidden="true" />
            {t("safety.call911")}
          </a>
          <a
            href="tel:18002221222"
            className={`min-h-[44px] inline-flex items-center justify-center px-4 rounded-lg bg-[var(--surface)] border border-[var(--danger-soft-border)] text-danger-ink font-semibold text-sm no-underline hover:bg-[var(--danger-soft-bg)] ${FOCUS}`}
          >
            {t("safety.poisonButton")}
          </a>
        </div>
      </section>

      {/* Phone: SDS collapses to one full-width button. */}
      <a
        href={SDS_URL}
        data-testid="sds-phone"
        className={`md:hidden min-h-[52px] flex items-center justify-between px-3.5 rounded-xl bg-[var(--primary-bg)] text-[var(--primary-text)] font-semibold text-[15px] no-underline ${FOCUS}`}
      >
        {t("safety.sdsTitle")}
        <ArrowRight size={18} aria-hidden="true" />
      </a>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] gap-5 items-start">
        <section aria-labelledby="safety-training-h" className="min-w-0 flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="safety-training-h" className="m-0 text-[15px] font-bold">{t("safety.trainingTitle")}</h2>
            {load.state === "ok" && (
              <span className="text-[13px] text-muted" data-testid="progress-text">
                {fill(t("safety.progress"), { done, total: blocks.length })}
              </span>
            )}
          </div>
          <div
            role="progressbar"
            aria-label={t("safety.trainingTitle")}
            aria-valuemin={0}
            aria-valuemax={blocks.length}
            aria-valuenow={load.state === "ok" ? done : undefined}
            className="h-1.5 rounded-full bg-[var(--line)] overflow-hidden"
          >
            <div className="h-full bg-[var(--success-ink)] transition-[width]" style={{ width: `${load.state === "ok" ? pct : 0}%` }} />
          </div>

          {load.state === "loading" && (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]" aria-busy="true" aria-label={t("safety.loading")}>
              {blocks.map((b) => (
                <div key={b.id} className={`${CARD} h-[148px] animate-pulse motion-reduce:animate-none`} />
              ))}
            </div>
          )}

          {load.state === "error" && (
            <div role="alert" className={`${CARD} p-4 flex flex-wrap items-center justify-between gap-3`}>
              <span className="text-sm text-danger-ink">{t("safety.loadError")}</span>
              <button type="button" onClick={() => void refresh()} className={`${BTN_OUTLINE} cursor-pointer`}>
                {t("safety.retry")}
              </button>
            </div>
          )}

          {load.state === "ok" && (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
              {blocks.map((b) => {
                const txt = blockText(b, lang);
                const on = latest.get(b.id);
                return (
                  <a
                    key={b.id}
                    href={`/v2/safety/training/${b.id}`}
                    data-testid="block-card"
                    data-block={b.id}
                    className={`${CARD} p-4 flex flex-col gap-2 no-underline text-text hover:border-[var(--input-border)] hover:shadow-[var(--shadow)] ${FOCUS}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-muted">{fill(t("safety.blockLabel"), { n: b.n })}</span>
                      <span className={on ? CHIP_DONE : CHIP_TODO} data-testid="block-status">
                        {on ? fill(t("safety.statusDone"), { date: formatYmd(on, lang, "short") }) : t("safety.statusNotDone")}
                      </span>
                    </span>
                    <span className="text-base font-bold leading-snug">{txt.title}</span>
                    <span className="text-[13px] text-muted leading-relaxed">{txt.topics}</span>
                    <span className="mt-auto pt-1.5 text-xs text-muted">
                      {fill(t("safety.videosMin"), { k: b.videos.length, m: b.minutes })}
                    </span>
                  </a>
                );
              })}
            </div>
          )}

          <p className="m-0 text-xs text-muted">{t("safety.moreBlocks")}</p>
        </section>

        <aside className="min-w-0 flex flex-col gap-3">
          <div className={`${CARD} p-4 hidden md:flex flex-col gap-2.5`} data-testid="sds-card">
            <h2 className="m-0 text-[15px] font-bold">{t("safety.sdsTitle")}</h2>
            <p className="m-0 text-[13px] text-muted">{t("safety.sdsDesc")}</p>
            <a href={SDS_URL} className={BTN_PRIMARY}>{t("safety.sdsOpen")}</a>
            <a href={SDS_BROWSE_URL} className={BTN_OUTLINE}>{t("safety.sdsBrowse")}</a>
            <p className="m-0 text-xs text-muted">{t("safety.sdsNote")}</p>
          </div>

          {canManage && (
            <div className={`${CARD} p-4 flex flex-col gap-2.5`} data-testid="records-card">
              <div className="flex items-center justify-between gap-2">
                <h2 className="m-0 text-[15px] font-bold">{t("safety.recordsTitle")}</h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-muted">
                  {t("safety.recordsBadge")}
                </span>
              </div>
              <p className="m-0 text-[13px] text-muted">{t("safety.recordsDesc")}</p>
              <a href="/v2/safety/manage" className={BTN_OUTLINE}>{t("safety.recordsOpen")}</a>
            </div>
          )}

          <p className="m-0 px-1 text-xs text-muted leading-normal">
            <strong className="text-text">{t("safety.complianceTitle")}</strong> {t("safety.complianceBody")}
          </p>
        </aside>
      </div>
    </main>
  );
}
