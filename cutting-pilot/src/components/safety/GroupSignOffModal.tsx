"use client";
// src/components/safety/GroupSignOffModal.tsx  (saf-03) — group sign-off on /v2/safety/manage.
// Block (ready blocks), date (today ET default, max today), who attended (search + checkbox list of every trainee;
// "Select all <role>" for the page's role filter; Clear; live count), optional note ≤200. People whose LATEST
// completion of this block is on this date show muted + disabled ("already recorded") — the server skips them anyway.
// POST /v2/api/safety/manage/group; success → onDone (page closes, banners, refetches); 400 → detail inline, stays open.
import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import SearchInput from "@/components/dashboard/SearchInput";
import { useLang } from "@/components/lang";
import { etNowWallClock } from "@/lib/etDateTime";
import { getBlock } from "@/lib/safety/trainingBlocks";
import { blockText } from "@/lib/safety/blockText";
import { BTN_OUTLINE, FOCUS, fill, splitRoles, type LatestMapJson, type RecordsBlock, type RecordsPerson } from "./safetyUi";

export interface GroupResult { recorded: number; skipped: number; block_id: string; completed_on: string }

const FIELD = "min-h-[44px] px-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm focus:outline-hidden focus:border-[var(--brand)]";
const NOTE_MAX = 200;

interface Props {
  blocks: RecordsBlock[];
  people: RecordsPerson[];
  latest: LatestMapJson;
  roleFilter: string;
  onClose: () => void;
  onDone: (r: GroupResult) => void;
}

export default function GroupSignOffModal({ blocks, people, latest, roleFilter, onClose, onDone }: Props) {
  const { lang, t } = useLang();
  const today = etNowWallClock().date;
  const [blockId, setBlockId] = useState(blocks[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const already = (uid: string) => latest[uid]?.[blockId]?.completed_on === date;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? people.filter((p) => p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)) : people;
  }, [people, search]);
  // Selections that are now "already recorded" (block/date changed) don't count and aren't sent.
  const chosen = Array.from(sel).filter((u) => !already(u));
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
  const canRecord = chosen.length > 0 && dateOk && !busy && !!blockId;

  function toggle(uid: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(uid)) n.delete(uid); else n.add(uid);
      return n;
    });
  }
  function selectRole() {
    setSel((s) => {
      const n = new Set(s);
      for (const p of people) if (splitRoles(p.roles).includes(roleFilter) && !already(p.user_id)) n.add(p.user_id);
      return n;
    });
  }

  async function record() {
    if (!canRecord) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/v2/api/safety/manage/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block_id: blockId, completed_on: date, user_ids: chosen, note: note.trim() || undefined }),
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        onDone({ recorded: json.recorded, skipped: (json.skipped ?? []).length, block_id: blockId, completed_on: date });
        return;
      }
      let msg = String(json?.detail || json?.error || t("safety.submitFailed"));
      if (Array.isArray(json?.bad_ids) && json.bad_ids.length) {
        const names = json.bad_ids.map((id: string) => people.find((p) => p.user_id === id)?.name ?? id);
        msg += ` (${names.join(", ")})`;
      }
      setError(msg);
    } catch {
      setError(t("safety.networkError"));
    } finally {
      setBusy(false);
    }
  }

  const n = chosen.length;
  const recordLabel = busy
    ? t("safety.records.recording")
    : n === 0 ? t("safety.records.selectPeople") : n === 1 ? t("safety.records.record1") : fill(t("safety.records.recordN"), { n });

  return (
    <Modal isOpen onClose={onClose} title={t("safety.records.groupSignOff")} size="lg">
      <div className="flex flex-col gap-3.5" data-testid="group-dialog">
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2.5">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            {t("safety.records.dlgBlock")}
            <select data-testid="dlg-block" value={blockId} onChange={(e) => setBlockId(e.target.value)} className={`${FIELD} cursor-pointer`}>
              {blocks.map((b) => {
                const blk = getBlock(b.id);
                return (
                  <option key={b.id} value={b.id}>
                    {t("safety.records.dlgBlock")} {b.n} — {blk ? blockText(blk, lang).title : b.titleEn}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            {t("safety.records.dlgDate")}
            <input data-testid="dlg-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={FIELD} />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">
              {t("safety.records.dlgWho")} · <span data-testid="dlg-count" className="text-text">{fill(t("safety.records.selectedCount"), { n })}</span>
            </span>
            <span className="flex flex-wrap gap-2">
              {roleFilter && (
                <button type="button" data-testid="dlg-select-role" onClick={selectRole} className={`${BTN_OUTLINE} cursor-pointer`}>
                  {fill(t("safety.records.selectAllRole"), { role: roleFilter })}
                </button>
              )}
              <button type="button" data-testid="dlg-clear" onClick={() => setSel(new Set())} className={`${BTN_OUTLINE} cursor-pointer`}>
                {t("safety.records.clear")}
              </button>
            </span>
          </div>
          <label className="flex">
            <span className="sr-only">{t("safety.records.search")}</span>
            <SearchInput value={search} onChange={setSearch} placeholder={t("safety.records.search")} />
          </label>
          <div className="border border-[var(--line)] rounded-lg max-h-[300px] overflow-auto" data-testid="dlg-people">
            {shown.map((p) => {
              const dis = already(p.user_id);
              return (
                <label
                  key={p.user_id}
                  data-testid="dlg-person"
                  data-user={p.user_id}
                  className={`flex items-center gap-2.5 min-h-[48px] px-3 border-b border-[var(--line)] last:border-b-0 text-sm ${dis ? "text-muted cursor-not-allowed" : "cursor-pointer hover:bg-[var(--ghost-bg)]"}`}
                >
                  <input
                    type="checkbox"
                    checked={!dis && sel.has(p.user_id)}
                    disabled={dis}
                    onChange={() => toggle(p.user_id)}
                    className="w-[22px] h-[22px] m-0 shrink-0 accent-[var(--primary-bg)]"
                  />
                  <span className="flex-1 min-w-0">
                    {p.name}
                    {dis && <span className="ml-2 text-xs italic">{t("safety.records.alreadyRecorded")}</span>}
                  </span>
                  <span className="text-xs text-muted text-right">{p.roles}</span>
                </label>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          <span className="flex justify-between">
            {t("safety.records.note")}
            <span className="font-normal tabular-nums" data-testid="dlg-note-count">{note.length}/{NOTE_MAX}</span>
          </span>
          <input data-testid="dlg-note" type="text" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} className={FIELD} />
        </label>
        <p className="m-0 text-xs text-muted">{t("safety.records.finePrint")}</p>
        {error && <p role="alert" data-testid="dlg-error" className="m-0 text-sm text-danger-ink">{error}</p>}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={`${BTN_OUTLINE} cursor-pointer`}>{t("safety.records.cancel")}</button>
          <button
            type="button"
            data-testid="dlg-record"
            onClick={() => void record()}
            disabled={!canRecord}
            aria-busy={busy || undefined}
            className={`min-h-[44px] px-[18px] rounded-lg font-semibold text-sm ${FOCUS} ${
              canRecord ? "bg-[var(--brand)] text-white cursor-pointer hover:bg-[var(--brand-hover)]" : "bg-[var(--ghost-bg)] text-muted cursor-not-allowed"
            }`}
          >
            {recordLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
