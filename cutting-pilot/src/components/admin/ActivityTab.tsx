"use client";
// src/components/admin/ActivityTab.tsx — admin-05
// Port of legacy admin/activity-log.html (read-only audit trail). Legacy filtered by action + entity type;
// v2 adds user and time range. Timestamps are mixed ISO / SQLite-UTC strings — formatEtDateTime
// (parseStoredUtc) handles both. Load more appends the next page of 50.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import FilterSelect from "@/components/dashboard/FilterSelect";
import { formatEtDateTime } from "@/lib/etDateTime";
import { adminApi, btnSm, errorBannerCls } from "@/lib/admin/client";
import type { ActivityEntry, ActivityFacets, ActivityRange } from "@/lib/admin/types";

const PAGE = 50;
const thCls = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted";
const tdCls = "px-3 py-2 align-top";

export default function ActivityTab() {
  const [facets, setFacets] = useState<ActivityFacets | null>(null);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [userId, setUserId] = useState("");
  const [range, setRange] = useState<ActivityRange>("7d");

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const reqId = useRef(0);

  const query = useCallback(
    (offset: number) => {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset), range });
      if (action) p.set("action", action);
      if (entityType) p.set("entity_type", entityType);
      if (userId) p.set("user_id", userId);
      return `/activity?${p.toString()}`;
    },
    [action, entityType, userId, range]
  );

  const loadFirst = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    const r = await adminApi<{ entries: ActivityEntry[]; total: number }>("GET", query(0));
    if (id !== reqId.current) return; // a newer filter change superseded this request
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEntries(r.data.entries);
    setTotal(r.data.total);
    setOpen(new Set());
  }, [query]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  useEffect(() => {
    void (async () => {
      const r = await adminApi<{ facets: ActivityFacets }>("GET", "/activity/facets");
      if (r.ok) setFacets(r.data.facets);
    })();
  }, []);

  async function loadMore() {
    const id = reqId.current;
    setLoadingMore(true);
    const r = await adminApi<{ entries: ActivityEntry[]; total: number }>("GET", query(entries.length));
    setLoadingMore(false);
    if (id !== reqId.current) return;
    if (!r.ok) {
      setError(r.error);
      return;
    }
    // The log is live: a row written between pages shifts the offset, so drop ids already shown.
    setEntries((prev) => {
      const seen = new Set(prev.map((x) => x.id));
      return prev.concat(r.data.entries.filter((x) => !seen.has(x.id)));
    });
    setTotal(r.data.total);
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="p-3 border-b border-[var(--border)] flex flex-wrap items-center gap-2">
        <FilterSelect
          value={action}
          onChange={setAction}
          allLabel="All actions"
          options={(facets?.actions ?? []).map((a) => ({ value: a, label: a }))}
        />
        <FilterSelect
          value={entityType}
          onChange={setEntityType}
          allLabel="All entities"
          options={(facets?.entity_types ?? []).map((t) => ({ value: t, label: t }))}
        />
        <FilterSelect
          value={userId}
          onChange={setUserId}
          allLabel="All users"
          options={(facets?.users ?? []).map((u) => ({ value: u.id, label: u.name }))}
        />
        {/* FilterSelect's leading all-option ("") maps to range=all. */}
        <FilterSelect
          value={range === "all" ? "" : range}
          onChange={(v) => setRange((v || "all") as ActivityRange)}
          allLabel="All time"
          options={[
            { value: "24h", label: "Last 24 hours" },
            { value: "7d", label: "Last 7 days" },
            { value: "30d", label: "Last 30 days" },
          ]}
        />
        <div className="flex-1" />
        <span className="font-mono text-xs text-muted">
          Showing {entries.length} of {total}
        </span>
      </div>

      <div className="p-3 space-y-2">
        {error && (
          <div role="alert" className={errorBannerCls}>
            <span>Couldn&apos;t load activity: {error}</span>
            <button type="button" className={btnSm} onClick={() => void loadFirst()}>
              Retry
            </button>
          </div>
        )}

        {loading && entries.length === 0 ? (
          <div className="py-8 text-sm text-muted">Loading activity…</div>
        ) : (
          <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-[var(--border)]">
                <tr>
                  <th className={thCls}>When</th>
                  <th className={thCls}>User</th>
                  <th className={thCls}>Action</th>
                  <th className={thCls}>Entity</th>
                  <th className={thCls}>Summary</th>
                  <th className={thCls}>
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted">
                      No activity matches these filters.
                    </td>
                  </tr>
                ) : (
                  entries.map((e) => {
                    const isOpen = open.has(e.id);
                    const detailText =
                      e.detail !== null && typeof e.detail === "object" ? JSON.stringify(e.detail, null, 2) : String(e.detail ?? "");
                    return (
                      <Fragment key={e.id}>
                        <tr className="border-b border-[var(--border-light)]">
                          <td className={`${tdCls} font-mono text-xs whitespace-nowrap`}>{formatEtDateTime(e.timestamp) ?? e.timestamp}</td>
                          <td className={tdCls}>{e.user_name ?? "—"}</td>
                          <td className={tdCls}>
                            <span
                              className={`rounded-sm bg-[var(--accent-soft)] border border-[var(--border)] text-xs font-semibold px-2 ${
                                e.action === "delete" ? "text-[var(--danger-bg)]" : "text-text"
                              }`}
                            >
                              {e.action}
                            </span>
                          </td>
                          <td className={`${tdCls} max-w-[220px]`}>
                            <div className="font-mono text-xs text-text">{e.entity_type}</div>
                            <div className="font-mono text-xs text-muted truncate" title={e.entity_id}>
                              {e.entity_id}
                            </div>
                          </td>
                          <td className={tdCls}>{e.summary || "—"}</td>
                          <td className="px-1 py-1 align-top text-right">
                            <button
                              type="button"
                              onClick={() => toggle(e.id)}
                              aria-expanded={isOpen}
                              aria-label={isOpen ? "Hide details" : "Show details"}
                              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded text-muted hover:text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            >
                              {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-[var(--border-light)]">
                            <td colSpan={6} className="px-3 pb-3">
                              <pre className="font-mono text-xs bg-[var(--ghost-bg)] text-text max-h-80 overflow-auto rounded-sm p-3 whitespace-pre-wrap break-all">
                                {detailText || "(no detail)"}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {entries.length < total && !loading && (
          <div className="flex justify-center pt-2">
            <button type="button" className={btnSm} disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
