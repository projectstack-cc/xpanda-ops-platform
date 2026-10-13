"use client";
// src/app/logistics/load-builder/LoadPicker.tsx
// Design read: building this as a parts picker for a logistics planner on a desktop (usable on a
// phone), dense + industrial, master-detail — a category rail beside a card grid, like legacy's Load
// tab (logistics/load-builder.html renderLoadTab: rail with counts + "in load" dot, search, cards
// with parent-group sub-headings, Add or a − qty + stepper).
//
// lbr-08. Presentational only: the library, the load list and every handler come from LoadPlanView.
// Rail: "All parts" then each category (alphabetical, "Uncategorized" last — legacy's
// groupByCategory). Search covers name, code and dims and ignores the rail while it has text.
// Within a category: ungrouped cards first (API order), then each parent group as a sub-heading
// with its cards sorted by height. Stack count is the trailer's height after runners ÷ the part's.
import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Search, RotateCw } from "lucide-react";
import type { CartLine, Dimensions, PackSku } from "@/lib/packEngine";
import type { LibrarySku } from "@/lib/jobPull";
import { thicknessColor } from "@/lib/thicknessPalette";
import { BTN_GHOST, CARD, NO_SAVE_REASON } from "./loadBuilderUi";

export type LibraryState =
  | { status: "loading" }
  | { status: "ready"; skus: LibrarySku[] }
  | { status: "denied" }
  | { status: "error"; message: string };

const ALL = "__all__";
const UNCATEGORIZED = "Uncategorized";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

export function dimsLabel(s: Pick<PackSku, "length" | "width" | "height">): string {
  return `${fmt(s.length)}×${fmt(s.width)}×${fmt(s.height)}″`;
}

function categoryOf(s: PackSku): string {
  return (s.category || "").trim() || UNCATEGORIZED;
}

/** Thickness swatch — the same data color the trailer diagram and PDF use for this height. */
export function Swatch({ height, size = 12 }: { height: number; size?: number }) {
  return <span aria-hidden="true" className="shrink-0 rounded-full border border-[var(--border)]" style={{ width: size, height: size, background: thicknessColor(height).bg }} />;
}

/** − / numeric input / + . The input commits on blur or Enter (not per keystroke), so clearing the
 * field to type a new number never removes the line mid-typing; 0 or empty removes it. */
export function QtyStepper({ qty, label, disabled, onStep, onSet }: { qty: number; label: string; disabled: boolean; onStep: (d: 1 | -1) => void; onSet: (n: number) => void }) {
  const [draft, setDraft] = useState(String(qty));
  useEffect(() => setDraft(String(qty)), [qty]);
  function commit() {
    const t = draft.trim();
    const n = t === "" ? 0 : Math.floor(Number(t));
    if (!Number.isFinite(n) || n < 0) {
      setDraft(String(qty));
      return;
    }
    if (n !== qty) onSet(n);
  }
  const btn = `inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[var(--border)] text-text cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={btn} disabled={disabled} onClick={() => onStep(-1)} aria-label={`One fewer ${label}`}>
        <Minus size={16} aria-hidden="true" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={draft}
        disabled={disabled}
        aria-label={`Quantity of ${label}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className={`w-16 min-h-[44px] rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-center text-sm font-mono tabular-nums text-text disabled:opacity-40 ${FOCUS}`}
      />
      <button type="button" className={btn} disabled={disabled} onClick={() => onStep(1)} aria-label={`One more ${label}`}>
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

interface LoadPickerProps {
  library: LibraryState;
  onRetry: () => void;
  dims: Dimensions;
  runnerHeight: number;
  cart: CartLine[];
  /** false for a view-only user (browse only — NO_SAVE_REASON). */
  canAdd: boolean;
  /** The customize editor is open. */
  locked: boolean;
  searchFocusKey: number;
  onAdd: (sku: LibrarySku) => void;
  onStep: (sku: LibrarySku, d: 1 | -1) => void;
  onSetQty: (sku: LibrarySku, qty: number) => void;
}

export default function LoadPicker(p: LoadPickerProps) {
  const [activeCat, setActiveCat] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (p.searchFocusKey > 0) searchRef.current?.focus();
  }, [p.searchFocusKey]);

  const skus = useMemo(() => (p.library.status === "ready" ? p.library.skus : []), [p.library]);
  const qtyById = useMemo(() => new Map(p.cart.map((c) => [c.skuId, c.qty])), [p.cart]);

  const { groups, catKeys } = useMemo(() => {
    const g = new Map<string, LibrarySku[]>();
    for (const s of skus) {
      const cat = categoryOf(s);
      if (!g.has(cat)) g.set(cat, []);
      g.get(cat)!.push(s);
    }
    const keys = Array.from(g.keys()).sort((a, b) => (a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b)));
    return { groups: g, catKeys: keys };
  }, [skus]);

  const cat = activeCat === ALL || groups.has(activeCat) ? activeCat : ALL;
  const q = query.trim().toLowerCase();
  const effHeight = p.dims.height - p.runnerHeight;
  const editable = p.canAdd && !p.locked;

  const searchHits = useMemo(() => {
    if (!q) return [];
    return skus.filter((s) => {
      const d = dimsLabel(s);
      const hay = [s.name, s.sku, d, d.replace(/×/g, "x").replace("″", "")].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [skus, q]);

  /** Ungrouped first (API order), then each parent group, height-sorted. */
  const sections = useMemo(() => {
    const list = cat === ALL ? skus : (groups.get(cat) ?? []);
    const out: { heading: string | null; skus: LibrarySku[] }[] = [];
    const ungrouped = list.filter((s) => !s.parentGroup);
    if (ungrouped.length) out.push({ heading: null, skus: ungrouped });
    const byParent = new Map<string, LibrarySku[]>();
    for (const s of list) {
      if (!s.parentGroup) continue;
      if (!byParent.has(s.parentGroup)) byParent.set(s.parentGroup, []);
      byParent.get(s.parentGroup)!.push(s);
    }
    byParent.forEach((group, name) => out.push({ heading: name, skus: [...group].sort((a, b) => a.height - b.height) }));
    return out;
  }, [cat, skus, groups]);

  const inLoadCount = (list: LibrarySku[]) => list.reduce((n, s) => n + (qtyById.has(s.id) ? 1 : 0), 0);

  function railItem(key: string, label: string, list: LibrarySku[]) {
    const active = !q && cat === key;
    const picked = inLoadCount(list);
    return (
      <button
        key={key}
        type="button"
        onClick={() => {
          setActiveCat(key);
          setQuery("");
        }}
        aria-pressed={active}
        className={[
          "shrink-0 lg:shrink lg:w-full inline-flex items-center justify-between gap-3 min-h-[44px] px-3 rounded-lg border text-sm font-medium cursor-pointer whitespace-nowrap transition-colors",
          FOCUS,
          active ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] text-text font-semibold" : "border-[var(--border)] lg:border-transparent text-muted hover:text-text hover:bg-[var(--ghost-bg)]",
        ].join(" ")}
      >
        <span className="truncate">{label}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono tabular-nums text-xs text-muted">{list.length}</span>
          {picked > 0 && <span className="w-2 h-2 rounded-full bg-[var(--brand)]" title={`${picked} in this load`} aria-label={`${picked} in this load`} />}
        </span>
      </button>
    );
  }

  function card(s: LibrarySku) {
    const qty = qtyById.get(s.id) ?? 0;
    const perStack = s.height > 0 ? Math.max(0, Math.floor((effHeight + 1e-6) / s.height)) : 0;
    const swatch = thicknessColor(s.height).bg;
    return (
      <div
        key={s.id}
        className={[
          "flex flex-col gap-1 rounded-lg border border-l-4 p-3 min-w-0",
          qty > 0 ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_6%,transparent)]" : "border-[var(--card-border)] bg-[var(--card-bg)]",
        ].join(" ")}
        style={qty > 0 ? { borderLeftColor: swatch } : undefined}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Swatch height={s.height} />
          <span className="font-mono text-xs font-semibold text-muted truncate">{s.sku || "—"}</span>
        </div>
        <div className="text-sm font-semibold text-text truncate" title={s.name}>
          {s.name}
        </div>
        <div className="text-xs text-muted font-mono tabular-nums">
          {dimsLabel(s)} · {perStack}/stack
        </div>
        <div className="mt-1">
          {qty > 0 ? (
            <QtyStepper qty={qty} label={s.name} disabled={!editable} onStep={(d) => p.onStep(s, d)} onSet={(n) => p.onSetQty(s, n)} />
          ) : (
            <button type="button" onClick={() => p.onAdd(s)} disabled={!editable} title={p.canAdd ? undefined : NO_SAVE_REASON} className={BTN_GHOST} aria-label={`Add ${s.name}`}>
              <Plus size={16} aria-hidden="true" /> Add
            </button>
          )}
        </div>
      </div>
    );
  }

  const GRID = "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2";

  let body: React.ReactNode;
  if (p.library.status === "loading") {
    body = <p className="text-sm text-muted py-8 text-center">Loading the parts library…</p>;
  } else if (p.library.status === "denied") {
    body = <p className="text-sm text-muted py-8 text-center">You don&apos;t have access to the parts library.</p>;
  } else if (p.library.status === "error") {
    body = (
      <div className="py-6 flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-[var(--danger-ink)]">{p.library.message}</p>
        <button type="button" onClick={p.onRetry} className={BTN_GHOST}>
          <RotateCw size={16} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  } else if (skus.length === 0) {
    body = <p className="text-sm text-muted py-8 text-center">The parts library is empty. Add parts on the Parts tab.</p>;
  } else {
    body = (
      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-3 min-w-0">
        <nav aria-label="Part categories" className="min-w-0">
          <div className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
            {railItem(ALL, "All parts", skus)}
            {catKeys.map((k) => railItem(k, k, groups.get(k) ?? []))}
          </div>
        </nav>
        {/* Scrolls inside its own box, like legacy's .skp-grid, so the Load list stays in reach. */}
        <div className="min-w-0 space-y-3 max-h-[70vh] overflow-y-auto overscroll-contain pr-1" tabIndex={0} aria-label="Parts">
          {q ? (
            searchHits.length ? (
              <div className={GRID}>{searchHits.map(card)}</div>
            ) : (
              <p className="text-sm text-muted py-6 text-center">No parts match &ldquo;{query.trim()}&rdquo;.</p>
            )
          ) : sections.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">No parts in this category.</p>
          ) : (
            sections.map((sec) => (
              <div key={sec.heading ?? "__ungrouped__"} className="space-y-2">
                {sec.heading && <h3 className="text-xs font-semibold uppercase tracking-wider text-muted pt-1">{sec.heading}</h3>}
                <div className={GRID}>{sec.skus.map(card)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <section className={`${CARD} space-y-3 min-w-0`} aria-labelledby="lb-picker-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="lb-picker-heading" className="text-sm font-semibold text-text">
          Parts
        </h2>
        {!p.canAdd && <span className="text-xs text-muted">{NO_SAVE_REASON}</span>}
      </div>
      <label className="relative block">
        <span className="sr-only">Search parts</span>
        <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all parts — name, code or size"
          className={`w-full min-h-[44px] pl-9 pr-3 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-sm text-text disabled:opacity-40 ${FOCUS}`}
        />
      </label>
      {body}
    </section>
  );
}
