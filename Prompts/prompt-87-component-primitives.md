# Prompt 87 — UI Overhaul (Foundation 3 of 3): Shared Component Primitives

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`, plus `agent-frontend-designer.md`.** Assume:
- **Lead: frontend-designer** — establishing the reusable component vocabulary.
- Honor cross-cutting rules: vanilla CSS only, no frameworks, no build step.

**No DB migration. No `_worker.js` change. No JavaScript change.** CSS only — one new file plus an `@import` line in the six module CSS files.

**Depends on Prompt 85** (`shared/tokens.css` exists). Order matters: components consume tokens.

## Context

Buttons, cards, badges, inputs, and tables are currently re-styled module-by-module with drifting class names. This prompt introduces a **shared, additive component layer** — `shared/components.css` — defining canonical primitives (`.btn`, `.card`, `.badge`, form fields, `.data-table`) that **consume the existing token names** from Prompt 85 (NOT a new `--color-*` namespace).

This layer is **additive and non-breaking**: existing module styles are not modified. Because each module imports `components.css` *before* its own rules, any module that already defines one of these class names keeps its own look (its later-in-cascade rule wins within that file). Reskins (Prompt 88+) progressively migrate markup onto these primitives. The reserved brand red lives only in `.btn-brand`.

---

## Part 1 — Create `shared/components.css`

Create `shared/components.css` with this content:

```css
/* shared/components.css — platform component primitives (UI overhaul, Prompt 87).
   Consumes tokens from shared/tokens.css. Additive: modules adopt these classes
   during reskins. Brand red is exposed ONLY via .btn-brand (use sparingly). */

/* ---- Buttons ---- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 8px 16px; font: inherit; font-weight: 500; line-height: 1.2;
  border: 1px solid transparent; border-radius: var(--radius);
  cursor: pointer; white-space: nowrap; user-select: none;
  transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
}
.btn:active { transform: scale(.98); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft); }

.btn-primary { background: var(--primary-bg); color: var(--primary-text); box-shadow: var(--shadow); }
.btn-primary:hover { background: var(--accent); }

.btn-secondary { background: var(--surface); color: var(--text); border-color: var(--input-border); }
.btn-secondary:hover { background: var(--ghost-bg); }

.btn-ghost { background: transparent; color: var(--muted); }
.btn-ghost:hover { background: var(--ghost-bg); color: var(--text); }

.btn-danger { background: var(--danger-bg); color: var(--danger-text); }
.btn-danger:hover { filter: brightness(.92); }

/* Brand red — reserved for true destructive/critical CTAs only. Use sparingly. */
.btn-brand { background: var(--brand); color: #fff; }
.btn-brand:hover { background: var(--brand-hover); }

.btn-sm { padding: 4px 12px; font-size: .8125rem; }
.btn-lg { padding: 12px 24px; font-size: 1rem; }

/* ---- Cards ---- */
.card {
  background: var(--card-bg); border: 1px solid var(--card-border);
  border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow);
  transition: box-shadow .15s ease, transform .15s ease;
}
.card-hover:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
.card-header {
  font-size: 1.0625rem; font-weight: 600; color: var(--text);
  margin: 0 0 16px; padding-bottom: 16px; border-bottom: 1px solid var(--line);
}

/* ---- Badges ---- */
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 10px; font-size: .75rem; font-weight: 500; border-radius: 999px;
}
.badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.badge-success { background: rgba(22,163,74,.12); color: var(--success-bg); }
.badge-danger  { background: rgba(220,38,38,.12); color: var(--danger-bg); }
.badge-warning { background: rgba(217,119,6,.12);  color: #b45309; }
.badge-info    { background: rgba(59,130,246,.12); color: #2563eb; }
.badge-neutral { background: rgba(107,114,128,.14); color: var(--muted); }

/* ---- Form fields ---- */
.form-group { margin-bottom: 16px; }
.form-label { display: block; font-size: .875rem; font-weight: 500; color: var(--text); margin-bottom: 6px; }
.form-label .required { color: var(--danger-bg); margin-left: 2px; }
.form-input, .form-select, .form-textarea {
  width: 100%; padding: 8px 12px; font: inherit; font-size: .875rem;
  color: var(--text); background: var(--input-bg);
  border: 1px solid var(--input-border); border-radius: var(--radius);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.form-input:focus, .form-select:focus, .form-textarea:focus {
  outline: none; border-color: var(--primary-bg); box-shadow: 0 0 0 3px var(--accent-soft);
}
.form-input::placeholder { color: var(--text-hint); }
.form-input:disabled { background: var(--ghost-bg); color: var(--text-hint); cursor: not-allowed; }
.form-textarea { min-height: 100px; resize: vertical; }
.form-error { font-size: .75rem; color: var(--danger-bg); margin-top: 4px; }

/* ---- Data table ---- */
.data-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: .875rem; }
.data-table thead th {
  background: var(--surface-2); color: var(--muted);
  font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
  padding: 10px 14px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap;
}
.data-table tbody td { padding: 10px 14px; border-bottom: 1px solid var(--line); color: var(--text); }
.data-table tbody tr:hover { background: var(--ghost-bg); }
```

## Part 2 — Import into each module CSS

In each of the six module `*-shared.css` files, add the components import **immediately after** the tokens import added in Prompt 85, so the order is:

```css
@import url('/shared/tokens.css');
@import url('/shared/components.css');
```

Files: `jobs/jobs-shared.css`, `logistics/logistics-shared.css`, `manufacturing/manufacturing-shared.css`, `production/production-shared.css`, `qc/qc-shared.css`, `reports/reports-shared.css`.

---

## Scope guard — do NOT do any of the following

- Do **not** modify any existing rule in any module CSS. This is additive only — append the one import line; change nothing else.
- Do **not** migrate any existing markup to the new classes in this prompt. Adoption happens during the per-module reskins (Prompt 88+).
- Do **not** rename or redefine any token. Components must consume the existing token names only — no new `--color-*` variables.
- Do **not** touch standalone pages, inline `<style>` blocks, `_worker.js`, any `*-header.js`, or any HTML file.

## Verify

- `shared/components.css` exists; the six module CSS files each import tokens then components, in that order.
- Existing module pages look **unchanged** (additive layer, existing rules still win where class names collide).
- In a scratch element, applying `class="btn btn-primary"` renders a slate button; `class="badge badge-success"` renders a green pill — both correct in light and dark mode.

## Manual steps after merge

- Hard-refresh to pick up the new `components.css`.
- No D1 migration. No console steps.

---

## After this lands

Foundation is complete (tokens → mode → components). The next prompts are **module reskins, one per session**, starting with the front door (`index.html` + `login.html`), then logistics → jobs → manufacturing → production → qc → reports → admin. Each reskin: remove the page's local/inline color drift, wire `tokens.css` (+ `components.css`) into standalone pages, migrate markup onto the primitives, and add `data-mode="floor"` density refinements. Those are written individually after this foundation is tested in the live platform, so each can target the exact resulting class names.
