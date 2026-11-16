"use client";
// src/components/safety/TrainingBlock.tsx  (saf-02) — /v2/safety/training/[block].
// One <video> + a video list (tap a row → new source; the old element unmounts, so it stops). The <video> mirrors
// legacy safety/training/block-0N.html exactly: controls, playsinline, preload="metadata", crossorigin="anonymous",
// <source type="video/mp4">, and two subtitle tracks es "Español" / ht "Kreyòl Ayisyen". Legacy marks the es track
// `default` on every page; that stays for EN and ES, and HT makes the ht track the default instead.
// Completion: attest → POST /v2/api/safety/complete (button disabled until checked AND while in flight);
// 201 → "Completion recorded", 409 already_today → "Already recorded today" (not an error); history from /me.
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useLang } from "@/components/lang";
import LangSelect from "@/components/LangSelect";
import { getBlock, mediaUrls, TRAINING_POSTER } from "@/lib/safety/trainingBlocks";
import { blockText, formatYmd, videoText } from "@/lib/safety/blockText";
import { etNowWallClock } from "@/lib/etDateTime";
import { BTN_OUTLINE, CARD, FOCUS, fetchMe, fill, type MeCompletion } from "./safetyUi";

type History = { state: "loading" } | { state: "error" } | { state: "ok"; rows: MeCompletion[] };
type Result = { kind: "recorded" | "already"; date: string } | null;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export default function TrainingBlock({ blockId, userName }: { blockId: string; userName: string }) {
  const { lang, t } = useLang();
  const block = getBlock(blockId)!; // the server shell 404s unknown / not-ready ids
  const txt = blockText(block, lang);
  const [cur, setCur] = useState(0);
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<History>({ state: "loading" });
  const videoRef = useRef<HTMLVideoElement>(null);

  const video = block.videos[cur];
  const vtxt = videoText(video, lang);
  const urls = mediaUrls(block, video);
  const defaultTrack = lang === "ht" ? "ht" : "es";

  const loadHistory = useCallback(async (quiet = false) => {
    if (!quiet) setHistory({ state: "loading" });
    try {
      const me = await fetchMe();
      setHistory({ state: "ok", rows: me.completions.filter((c) => c.block_id === block.id) });
    } catch {
      if (!quiet) setHistory({ state: "error" });
    }
  }, [block.id]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // Language switch while a video is mounted: show the matching caption track without reloading the video.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    for (const tr of Array.from(el.textTracks)) {
      if (tr.language === "es" || tr.language === "ht") tr.mode = tr.language === defaultTrack ? "showing" : "disabled";
    }
  }, [defaultTrack]);

  async function submit() {
    if (!attest || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/v2/api/safety/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block_id: block.id, attested: true }),
      });
      const json: any = await res.json().catch(() => null);
      if (res.status === 201 && json?.ok && json.completion) {
        const c = json.completion as MeCompletion;
        setResult({ kind: "recorded", date: c.completed_on });
        setHistory((h) =>
          h.state === "ok"
            ? { state: "ok", rows: [{ id: c.id, block_id: c.block_id, completed_on: c.completed_on, source: c.source }, ...h.rows] }
            : h
        );
        void loadHistory(true);
      } else if (res.status === 409 && json?.error === "already_today") {
        setResult({ kind: "already", date: json.completion?.completed_on ?? etNowWallClock().date });
        void loadHistory(true);
      } else {
        setError(String(json?.detail || json?.error || t("safety.submitFailed")));
      }
    } catch {
      setError(t("safety.networkError"));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = attest && !busy;

  return (
    <main className="w-full max-w-[1320px] mx-auto px-4 pt-6 pb-12 flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <a href="/v2/safety" className={`inline-flex items-center min-h-[44px] text-[13px] font-semibold text-[var(--link)] no-underline hover:underline ${FOCUS}`}>
            {t("safety.back")}
          </a>
          <div className="font-mono text-xs font-semibold text-muted">
            {fill(t("safety.blockLabel"), { n: block.n })} · {fill(t("safety.videosMin"), { k: block.videos.length, m: block.minutes })}
          </div>
          <h1 className="mt-0.5 mb-0.5 text-[22px] font-bold tracking-tight">{txt.title}</h1>
          <p className="m-0 text-sm text-muted">{txt.topics}</p>
        </div>
        <LangSelect />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] gap-5 items-start">
        <section aria-label={t("safety.videoList")} className="min-w-0 flex flex-col gap-3">
          <div className={`${CARD} overflow-hidden`}>
            <video
              key={`${video.key}`}
              ref={videoRef}
              data-testid="player"
              controls
              playsInline
              preload="metadata"
              crossOrigin="anonymous"
              poster={TRAINING_POSTER}
              className="block w-full aspect-video bg-black"
            >
              <source src={urls.mp4} type="video/mp4" />
              <track kind="subtitles" srcLang="es" label="Español" src={urls.vttEs} default={defaultTrack === "es"} />
              <track kind="subtitles" srcLang="ht" label="Kreyòl Ayisyen" src={urls.vttHt} default={defaultTrack === "ht"} />
            </video>
            <div className="px-4 py-3 flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="text-base font-bold" data-testid="video-title">{vtxt.title}</div>
                <div className="text-[13px] text-muted">{vtxt.desc}</div>
              </div>
              <span className="text-xs text-muted">
                {t("safety.captionsTitle")} {t("safety.captionsTapCc")}
              </span>
            </div>
          </div>

          <ol className="m-0 p-0 list-none flex flex-col gap-2">
            {block.videos.map((v, k) => {
              const on = k === cur;
              const vt = videoText(v, lang);
              return (
                <li key={v.key}>
                  <button
                    type="button"
                    data-testid="video-row"
                    aria-current={on ? "true" : undefined}
                    onClick={() => setCur(k)}
                    className={`w-full min-h-[56px] flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] text-left text-text cursor-pointer border ${
                      on ? "bg-[var(--info-bg)] border-[var(--info-border)]" : "bg-[var(--surface)] border-[var(--card-border)] hover:bg-[var(--ghost-bg)]"
                    } ${FOCUS}`}
                  >
                    <span className="font-mono text-[13px] font-semibold text-muted w-[22px] shrink-0">{k + 1}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold">{vt.title}</span>
                      <span className="block text-xs text-muted">{vt.desc}</span>
                    </span>
                    <span className={`text-xs font-semibold shrink-0 ${on ? "text-[var(--info-text)]" : "text-muted"}`}>
                      {on ? t("safety.playing") : t("safety.play")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="min-w-0 flex flex-col gap-3">
          <div className={`${CARD} p-4 flex flex-col gap-3`} data-testid="completion-card">
            <h2 className="m-0 text-[15px] font-bold">{t("safety.completionTitle")}</h2>
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--ghost-bg)] text-[13px]">
              <span
                aria-hidden="true"
                className="w-8 h-8 shrink-0 rounded-full bg-[var(--primary-bg)] text-[var(--primary-text)] inline-flex items-center justify-center font-bold text-[13px]"
              >
                {initials(userName)}
              </span>
              <span>
                {t("safety.recordingFor")} <strong data-testid="recording-for">{userName}</strong>
                <span className="block text-xs text-muted">{t("safety.fromSignIn")}</span>
              </span>
            </div>

            {result ? (
              <div
                role="status"
                data-testid="result"
                data-kind={result.kind}
                className="flex items-start gap-2 p-3 rounded-lg border border-[var(--success-ink)] text-success-ink text-sm"
              >
                <CheckCircle2 size={18} aria-hidden="true" className="shrink-0 mt-0.5" />
                <span>
                  <strong>{result.kind === "recorded" ? t("safety.recorded") : t("safety.alreadyToday")}</strong>{" "}
                  {fill(t("safety.recordedLine"), { n: block.n, date: formatYmd(result.date, lang, "long") })}
                </span>
              </div>
            ) : (
              <>
                <label className="flex items-start gap-2.5 min-h-[44px] px-3 py-2.5 border border-[var(--input-border)] rounded-lg text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="attest"
                    checked={attest}
                    onChange={(e) => setAttest(e.target.checked)}
                    className="w-[22px] h-[22px] m-0 shrink-0 accent-[var(--primary-bg)] cursor-pointer"
                  />
                  <span>{t("safety.attest")}</span>
                </label>
                <button
                  type="button"
                  data-testid="submit"
                  onClick={() => void submit()}
                  disabled={!canSubmit}
                  aria-busy={busy || undefined}
                  className={`min-h-[52px] lg:min-h-[48px] rounded-lg font-semibold text-[15px] ${FOCUS} ${
                    canSubmit
                      ? "bg-[var(--brand)] text-white cursor-pointer hover:bg-[var(--brand-hover)]"
                      : "bg-[var(--ghost-bg)] text-muted cursor-not-allowed"
                  }`}
                >
                  {busy ? t("safety.submitting") : t("safety.submit")}
                </button>
                {error && (
                  <p role="alert" data-testid="submit-error" className="m-0 text-sm text-danger-ink">
                    {error}
                  </p>
                )}
              </>
            )}

            <div className="border-t border-[var(--line)] pt-2.5 text-[13px] text-muted">
              <div className="font-semibold text-text mb-1">{t("safety.historyTitle")}</div>
              {history.state === "loading" && <div className="animate-pulse motion-reduce:animate-none">{t("safety.loading")}</div>}
              {history.state === "error" && (
                <div role="alert" className="flex flex-wrap items-center gap-2">
                  <span className="text-danger-ink">{t("safety.loadError")}</span>
                  <button type="button" onClick={() => void loadHistory()} className={`${BTN_OUTLINE} cursor-pointer`}>
                    {t("safety.retry")}
                  </button>
                </div>
              )}
              {history.state === "ok" &&
                (history.rows.length === 0 ? (
                  <div data-testid="history-empty">{t("safety.historyEmpty")}</div>
                ) : (
                  <ul className="m-0 p-0 list-none" data-testid="history">
                    {history.rows.map((r) => (
                      <li key={r.id}>
                        {formatYmd(r.completed_on, lang, "long")} · {r.source === "group" ? t("safety.sourceGroup") : t("safety.sourceSelf")}
                      </li>
                    ))}
                  </ul>
                ))}
            </div>
          </div>
          <p className="m-0 px-1 text-xs text-muted">{t("safety.retakeNote")}</p>
        </aside>
      </div>
    </main>
  );
}
