"use client";
// src/components/safety/PersonHistory.tsx  (saf-03) — one trainee's full history on /v2/safety/manage.
// GET /v2/api/safety/manage/person?user_id= (voided included; filtered here behind "Show voided"). With canEdit each
// non-voided row has Void → inline confirm with a required reason (≤200) → POST /v2/api/safety/manage/void; the row
// updates in place and the page refetches records (the latest date may change). 409 = already voided → reload list.
import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import { formatYmd } from "@/lib/safety/blockText";
import { BTN_OUTLINE, FOCUS, fill } from "./safetyUi";
import type { RecordsBlock, RecordsPerson } from "./safetyUi";

interface Row {
  id: string;
  block_id: string;
  completed_on: string;
  source: "self" | "group";
  recorded_by_name: string;
  note: string | null;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
}
type Load = { state: "loading" } | { state: "error" } | { state: "ok"; rows: Row[] };
const REASON_MAX = 200;

interface Props {
  person: RecordsPerson;
  blocks: RecordsBlock[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export default function PersonHistory({ person, blocks, canEdit, onClose, onChanged }: Props) {
  const { lang, t } = useLang();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [showVoided, setShowVoided] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const reload = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const res = await fetch(`/v2/api/safety/manage/person?user_id=${encodeURIComponent(person.user_id)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(String(res.status));
      setLoad({ state: "ok", rows: json.completions as Row[] });
    } catch {
      setLoad({ state: "error" });
    }
  }, [person.user_id]);
  useEffect(() => { void reload(); }, [reload]);

  const blockN = (id: string) => blocks.find((b) => b.id === id)?.n ?? id.replace("block-", "");

  async function confirmVoid(id: string) {
    if (!reason.trim()) { setMsg(t("safety.records.reasonRequired")); return; }
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/v2/api/safety/manage/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, reason: reason.trim() }),
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        const c = json.completion;
        setLoad((l) => (l.state === "ok"
          ? { state: "ok", rows: l.rows.map((r) => (r.id === id ? { ...r, voided_at: c.voided_at, voided_by_name: c.voided_by_name, void_reason: c.void_reason } : r)) }
          : l));
        setVoiding(null);
        setReason("");
        onChanged();
      } else if (res.status === 409) {
        setVoiding(null);
        setReason("");
        setMsg(t("safety.records.alreadyVoided"));
        await reload();
        onChanged();
      } else {
        setMsg(String(json?.detail || json?.error || t("safety.submitFailed")));
      }
    } catch {
      setMsg(t("safety.networkError"));
    } finally {
      setBusy(false);
    }
  }

  const rows = load.state === "ok" ? load.rows.filter((r) => showVoided || !r.voided_at) : [];

  return (
    <Modal isOpen onClose={onClose} title={person.name} size="lg">
      <div className="flex flex-col gap-3" data-testid="person-dialog">
        <div className="text-sm text-muted">
          <span className="font-mono">{person.username}</span>
          {person.roles && <> · {person.roles}</>}
        </div>
        <label className="inline-flex items-center gap-2.5 min-h-[44px] text-sm cursor-pointer self-start">
          <input
            type="checkbox"
            data-testid="show-voided"
            checked={showVoided}
            onChange={(e) => setShowVoided(e.target.checked)}
            className="w-[22px] h-[22px] m-0 accent-[var(--primary-bg)]"
          />
          {t("safety.records.showVoided")}
        </label>
        {msg && <p role="status" data-testid="person-msg" className="m-0 text-sm text-danger-ink">{msg}</p>}

        {load.state === "loading" && <div className="text-sm text-muted animate-pulse motion-reduce:animate-none">{t("safety.loading")}</div>}
        {load.state === "error" && (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-danger-ink">{t("safety.loadError")}</span>
            <button type="button" onClick={() => void reload()} className={`${BTN_OUTLINE} cursor-pointer`}>{t("safety.retry")}</button>
          </div>
        )}
        {load.state === "ok" && rows.length === 0 && <div className="text-sm text-muted">{t("safety.records.noCompletions")}</div>}
        {rows.length > 0 && (
          <ul className="m-0 p-0 list-none flex flex-col divide-y divide-[var(--line)] border border-[var(--line)] rounded-lg" data-testid="person-rows">
            {rows.map((r) => {
              const voided = !!r.voided_at;
              return (
                <li key={r.id} data-testid="person-row-item" data-id={r.id} data-voided={voided ? "1" : "0"} className="px-3 py-2.5 flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className={`font-mono ${voided ? "line-through text-muted" : "text-success-ink"}`}>{formatYmd(r.completed_on, lang, "long")}</span>
                    <span className={`font-mono text-xs font-semibold ${voided ? "line-through text-muted" : "text-muted"}`}>
                      {fill(t("safety.blockLabel"), { n: blockN(r.block_id) })} {t(`safety.records.short.${r.block_id}`)}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-1.5 py-px rounded-full border ${
                        r.source === "group"
                          ? "bg-[var(--info-bg)] border-[var(--info-border)] text-[var(--info-text)]"
                          : "bg-[var(--ghost-bg)] border-[var(--input-border)] text-muted"
                      }`}
                    >
                      {r.source === "group" ? t("safety.sourceGroup") : t("safety.sourceSelf")}
                    </span>
                    {canEdit && !voided && voiding !== r.id && (
                      <button
                        type="button"
                        data-testid="void-btn"
                        onClick={() => { setVoiding(r.id); setReason(""); setMsg(""); }}
                        className={`ml-auto min-h-[44px] px-3 rounded-lg text-sm font-semibold text-danger-ink border border-[var(--danger-soft-border)] hover:bg-[var(--danger-soft-bg)] cursor-pointer ${FOCUS}`}
                      >
                        {t("safety.records.void")}
                      </button>
                    )}
                  </div>
                  {(r.source === "group" || r.note) && (
                    <div className={`text-xs text-muted ${voided ? "line-through" : ""}`}>
                      {r.source === "group" && fill(t("safety.records.recordedBy"), { name: r.recorded_by_name })}
                      {r.source === "group" && r.note && " · "}
                      {r.note}
                    </div>
                  )}
                  {voided && (
                    <div className="text-xs text-danger-ink" data-testid="voided-by">
                      {fill(t("safety.records.voidedBy"), { name: r.voided_by_name ?? "", reason: r.void_reason ?? "" })}
                    </div>
                  )}
                  {voiding === r.id && (
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-end" data-testid="void-confirm">
                      <label className="flex-1 flex flex-col gap-1 text-xs font-semibold text-muted">
                        {t("safety.records.voidReason")}
                        <input
                          type="text"
                          data-testid="void-reason"
                          value={reason}
                          maxLength={REASON_MAX}
                          onChange={(e) => setReason(e.target.value)}
                          className="min-h-[44px] px-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm font-normal focus:outline-hidden focus:border-[var(--brand)]"
                        />
                      </label>
                      <button type="button" onClick={() => { setVoiding(null); setMsg(""); }} className={`${BTN_OUTLINE} cursor-pointer`}>
                        {t("safety.records.cancel")}
                      </button>
                      <button
                        type="button"
                        data-testid="void-confirm-btn"
                        onClick={() => void confirmVoid(r.id)}
                        disabled={busy || !reason.trim()}
                        className={`min-h-[44px] px-4 rounded-lg font-semibold text-sm bg-[var(--danger-bg)] text-[var(--danger-text)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`}
                      >
                        {t("safety.records.confirmVoid")}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
