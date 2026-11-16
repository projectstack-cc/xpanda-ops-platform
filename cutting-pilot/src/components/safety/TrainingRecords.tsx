"use client";
// src/components/safety/TrainingRecords.tsx  (saf-03) — /v2/safety/manage.
// GET /v2/api/safety/manage/records → summary tiles (whole population; filters never change them), toolbar
// (search name/username, role, Show), people × ready-blocks table (latest date per cell, `group` tag, Last activity).
// A row opens PersonHistory (void there); Group sign-off opens GroupSignOffModal. Both actions need canEdit
// (safety.manage EDIT, X-User-Can-Edit-Safety-Manage); Export CSV is a plain download link.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Users, X } from "lucide-react";
import { useLang } from "@/components/lang";
import LangSelect from "@/components/LangSelect";
import MetricTile from "@/components/dashboard/MetricTile";
import SearchInput from "@/components/dashboard/SearchInput";
import FilterSelect from "@/components/dashboard/FilterSelect";
import { formatYmd } from "@/lib/safety/blockText";
import { BTN_OUTLINE, CARD, FOCUS, fill, splitRoles, type RecordsData } from "./safetyUi";
import GroupSignOffModal, { type GroupResult } from "./GroupSignOffModal";
import PersonHistory from "./PersonHistory";


type Load = { state: "loading" } | { state: "error" } | { state: "ok"; data: RecordsData };
type Show = "" | "missing" | "done";

export default function TrainingRecords({ canEdit }: { canEdit: boolean }) {
  const { lang, t } = useLang();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [show, setShow] = useState<Show>("");
  const [groupOpen, setGroupOpen] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string>("");

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoad({ state: "loading" });
    try {
      const res = await fetch("/v2/api/safety/manage/records", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(String(res.status));
      setLoad({ state: "ok", data: json as RecordsData });
    } catch {
      if (!quiet) setLoad({ state: "error" });
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const data = load.state === "ok" ? load.data : null;
  const roleOptions = useMemo(() => {
    const s = new Set<string>();
    for (const p of data?.people ?? []) for (const r of splitRoles(p.roles)) s.add(r);
    return Array.from(s).sort((a, b) => a.localeCompare(b)).map((r) => ({ value: r, label: r }));
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const ids = data.blocks.map((b) => b.id);
    return data.people.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.username.toLowerCase().includes(q)) return false;
      if (role && !splitRoles(p.roles).includes(role)) return false;
      const have = ids.filter((b) => data.latest[p.user_id]?.[b]).length;
      if (show === "missing" && have === ids.length) return false;
      if (show === "done" && have !== ids.length) return false;
      return true;
    });
  }, [data, search, role, show]);

  const clearFilters = () => { setSearch(""); setRole(""); setShow(""); };
  const person = data?.people.find((p) => p.user_id === personId) ?? null;

  function onGroupDone(r: GroupResult) {
    setGroupOpen(false);
    const b = data?.blocks.find((x) => x.id === r.block_id);
    let msg = fill(t("safety.records.banner"), { n: r.recorded, b: b?.n ?? r.block_id, date: formatYmd(r.completed_on, lang, "long") });
    if (r.skipped > 0) msg += ` · ${fill(t("safety.records.skipped"), { k: r.skipped })}`;
    setBanner(msg);
    void refresh(true);
  }

  return (
    <main className="w-full max-w-[1320px] mx-auto px-4 pt-6 pb-12 flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <a href="/v2/safety" className={`inline-flex items-center min-h-[44px] text-[13px] font-semibold text-[var(--link)] no-underline hover:underline ${FOCUS}`}>
            {t("safety.back")}
          </a>
          <h1 className="mt-0.5 mb-0.5 text-[22px] font-bold tracking-tight">{t("safety.recordsTitle")}</h1>
          <p className="m-0 text-sm text-muted">{t("safety.records.subtitle")}</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full sm:w-auto">
          <LangSelect />
          <a
            href="/v2/api/safety/manage/export"
            download
            data-testid="export"
            title={t("safety.records.exportTitle")}
            className={`${BTN_OUTLINE} gap-2 w-full sm:w-auto`}
          >
            <Download size={16} aria-hidden="true" />
            {t("safety.records.exportCsv")}
          </a>
          {canEdit && (
            <button
              type="button"
              data-testid="open-group"
              onClick={() => setGroupOpen(true)}
              disabled={!data}
              className={`min-h-[44px] inline-flex items-center justify-center gap-2 px-[18px] rounded-lg bg-[var(--brand)] text-white font-semibold text-sm cursor-pointer hover:bg-[var(--brand-hover)] disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto ${FOCUS}`}
            >
              <Users size={16} aria-hidden="true" />
              {t("safety.records.groupSignOff")}
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div role="status" data-testid="banner" className="flex items-center justify-between gap-2 px-4 py-2 rounded-xl border border-[var(--success-ink)] text-success-ink text-sm bg-[var(--surface)]">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner("")} aria-label={t("safety.records.dismiss")} className={`min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg cursor-pointer ${FOCUS}`}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {load.state === "error" && (
        <div role="alert" className={`${CARD} p-4 flex flex-wrap items-center justify-between gap-3`}>
          <span className="text-sm text-danger-ink">{t("safety.loadError")}</span>
          <button type="button" onClick={() => void refresh()} className={`${BTN_OUTLINE} cursor-pointer`}>{t("safety.retry")}</button>
        </div>
      )}

      {load.state === "loading" && (
        <div aria-busy="true" aria-label={t("safety.loading")} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => <div key={i} className={`${CARD} h-[104px] animate-pulse motion-reduce:animate-none`} />)}
          </div>
          <div className={`${CARD} h-[320px] animate-pulse motion-reduce:animate-none`} />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="tiles">
            <MetricTile label={t("safety.records.tilePeople")} value={data.summary.people} caption={t("safety.records.tilePeopleCaption")} />
            <MetricTile
              label={fill(t("safety.records.tileAllDone"), { n: data.blocks.length })}
              value={data.summary.allDone}
              caption={fill(t("safety.records.tileAllDoneCaption"), { p: data.summary.people })}
            />
            <MetricTile label={t("safety.records.tileNone")} value={data.summary.noneYet} caption={t("safety.records.tileNoneCaption")} tone="warn" />
            <MetricTile
              label={t("safety.records.tileMonth")}
              value={data.summary.thisMonth.completions}
              caption={fill(t("safety.records.tileMonthCaption"), { g: data.summary.thisMonth.group })}
            />
          </div>

          <div className={`${CARD} overflow-hidden`}>
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 px-4 py-3 border-b border-[var(--line)]">
              <label className="flex-1 min-w-0 sm:min-w-[240px] flex">
                <span className="sr-only">{t("safety.records.search")}</span>
                <SearchInput value={search} onChange={setSearch} placeholder={t("safety.records.search")} />
              </label>
              <label className="flex flex-col sm:flex-row" data-testid="role-filter">
                <span className="sr-only">{t("safety.records.roleLabel")}</span>
                <FilterSelect value={role} onChange={setRole} options={roleOptions} allLabel={t("safety.records.allRoles")} />
              </label>
              <label className="flex flex-col sm:flex-row" data-testid="show-filter">
                <span className="sr-only">{t("safety.records.showLabel")}</span>
                <FilterSelect
                  value={show}
                  onChange={(v) => setShow(v as Show)}
                  options={[
                    { value: "missing", label: t("safety.records.showMissing") },
                    { value: "done", label: t("safety.records.showAllDone") },
                  ]}
                  allLabel={t("safety.records.showEveryone")}
                />
              </label>
            </div>

            {rows.length === 0 ? (
              <div className="p-6 flex flex-col items-center gap-3 text-sm text-muted" data-testid="no-match">
                <span>{t("safety.records.noMatch")}</span>
                <button type="button" onClick={clearFilters} className={`${BTN_OUTLINE} cursor-pointer`}>{t("safety.records.clearFilters")}</button>
              </div>
            ) : (
              <div className="overflow-auto max-h-[70vh]" data-testid="table-scroll">
                <table className="w-full border-collapse text-[13px] min-w-[760px]" data-testid="records-table">
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-[var(--surface-2)] text-left text-muted text-xs uppercase tracking-wide">
                      <th scope="col" className="px-4 py-2.5 font-semibold max-sm:sticky max-sm:left-0 max-sm:z-30 bg-[var(--surface-2)]">{t("safety.records.colPerson")}</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">{t("safety.records.colRoles")}</th>
                      {data.blocks.map((b) => (
                        <th scope="col" key={b.id} className="px-3 py-2.5 font-semibold whitespace-nowrap" data-block={b.id}>
                          {b.n} {t(`safety.records.short.${b.id}`)}
                        </th>
                      ))}
                      <th scope="col" className="px-4 py-2.5 font-semibold whitespace-nowrap">{t("safety.records.colLast")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => {
                      const mine = data.latest[p.user_id] ?? {};
                      const dates = data.blocks.map((b) => mine[b.id]?.completed_on).filter(Boolean) as string[];
                      const last = dates.sort()[dates.length - 1];
                      return (
                        <tr key={p.user_id} data-testid="person-row" data-user={p.user_id} className="border-t border-[var(--line)] hover:bg-[var(--ghost-bg)] group">
                          <td className="px-2 py-1 max-sm:sticky max-sm:left-0 max-sm:z-10 bg-[var(--surface)] group-hover:bg-[var(--ghost-bg)]">
                            <button
                              type="button"
                              onClick={() => setPersonId(p.user_id)}
                              aria-label={fill(t("safety.records.openPerson"), { name: p.name })}
                              className={`w-full min-h-[44px] px-2 py-1 text-left rounded-lg cursor-pointer ${FOCUS}`}
                            >
                              <span className="block font-semibold text-text whitespace-nowrap">{p.name}</span>
                              <span className="block text-xs text-muted">{p.username}</span>
                            </button>
                          </td>
                          <td className="px-3 py-2 text-muted">{p.roles}</td>
                          {data.blocks.map((b) => {
                            const c = mine[b.id];
                            return (
                              <td key={b.id} className="px-3 py-2 whitespace-nowrap" data-testid="cell" data-block={b.id}>
                                {c ? (
                                  <>
                                    <span className="font-mono text-success-ink" data-date={c.completed_on}>{formatYmd(c.completed_on, lang, "short")}</span>
                                    {c.source === "group" && (
                                      <span data-testid="group-tag" className="ml-1.5 text-[11px] font-semibold px-1.5 py-px rounded-full bg-[var(--info-bg)] border border-[var(--info-border)] text-[var(--info-text)]">
                                        {t("safety.sourceGroup")}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2 whitespace-nowrap font-mono text-muted" data-testid="last">
                            {last ? formatYmd(last, lang, "short") : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {groupOpen && (
            <GroupSignOffModal
              blocks={data.blocks}
              people={data.people}
              latest={data.latest}
              roleFilter={role}
              onClose={() => setGroupOpen(false)}
              onDone={onGroupDone}
            />
          )}
          {person && (
            <PersonHistory
              person={person}
              blocks={data.blocks}
              canEdit={canEdit}
              onClose={() => setPersonId(null)}
              onChanged={() => void refresh(true)}
            />
          )}
        </>
      )}
    </main>
  );
}
