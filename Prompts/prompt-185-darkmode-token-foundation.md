# Prompt NNN — Dark-Mode Fix Foundation: New Semantic Tokens

> **Type:** Code change, single file: `shared/tokens.css`. Additive only — no module files touched, no existing tokens changed. Zero behavioral change to any page (nothing consumes these yet; the module batches that follow will).
> **Source of truth:** `dark-mode-audit.md` §4 "Pre-fix: Shared tokens first."
> **Prompt number:** Steve assigns. Replace `NNN` in the filename before running.

## 0. Required reading (do this first)

1. **Pull the repo** (`git pull`).
2. Read **`AGENTS.md`** and **`xpanda-ops-agents.md`** in full.
3. Read **`agent-frontend-designer.md`** — token/design-system authority.
4. Read **`dark-mode-audit.md`** §4 (batching plan + token rationale).
5. **Read `shared/tokens.css` in full** before editing — you must match the file's existing structure and naming convention exactly.

## 1. Agent assignment

Operating under the **Orchestrator** (`xpanda-ops-agents.md` §1) with the **Frontend Designer** agent (`agent-frontend-designer.md`) as lead. This is a platform-wide shared-CSS change; no single domain agent owns `shared/tokens.css`, so it stays with the Frontend Designer under Orchestrator coordination.

## 2. Goal

Add three new semantic token groups so the dark-mode module fix batches can reference them instead of each module independently hardcoding the same light-only patterns. These unify the bulk of the "no token fits" notes in the audit:

- `--link` — interactive/link blue (back-links, "View …" links, "Mark all read", calendar "more" hover). Audit hits across Logistics, Jobs, Production, QC, Reports, Shared.
- `--info-bg` / `--info-border` / `--info-text` — info banners and selected-state surfaces (job-linked-note, push-notification banner, job-result selected, load-builder pull-from-job banner).
- `--warn-bg` / `--warn-border` / `--warn-text` — amber warning surfaces (yard button, production badges, load-builder warnings, inventory job-label banner).

## 3. What to add

Add all six/nine custom properties in **two** places, matching the existing file's formatting and grouping:

1. In the **`:root`** block (light values).
2. In the **`:root[data-theme="dark"]`** block (dark overrides).

### Recommended values

Light (`:root`):
```
--link: #0074cc;
--info-bg: #eff6ff;
--info-border: #bfdbfe;
--info-text: #1e40af;
--warn-bg: #fef3c7;
--warn-border: #fde68a;
--warn-text: #92400e;
```

Dark (`:root[data-theme="dark"]`):
```
--link: #60a5fa;
--info-bg: rgba(59, 130, 246, 0.12);
--info-border: rgba(59, 130, 246, 0.35);
--info-text: #93c5fd;
--warn-bg: rgba(245, 158, 11, 0.12);
--warn-border: rgba(245, 158, 11, 0.35);
--warn-text: #fcd34d;
```

**Before finalizing the dark values:** inspect the existing dark overrides already in `:root[data-theme="dark"]` (e.g. the status-pill / surface tints). If they follow a consistent rgba-tint convention, make `--info-*` and `--warn-*` match that convention's opacity and base-hue style for visual consistency. Keep `--link` dark as a solid, legible blue against `--bg` dark. Do not alter any existing token while doing this.

## 4. Constraints

- **Additive only.** Do not modify, rename, reorder, or remove any existing token.
- **Only `shared/tokens.css`** is touched. No module HTML/CSS/JS, no worker, no migration.
- Place the new tokens logically (group the three sets together, e.g. under a `/* semantic UI */` comment) in **both** blocks, mirroring the file's existing comment/spacing style.
- No `!important`, no inline styles (N/A here — token defs only).

## 5. Find/replace discipline

- Make edits on a `/tmp` copy first.
- Each find block must match the live file byte-for-byte and verify `count == 1` via Python `.count()` before applying.
- The two anchor points are the closing of the `:root` block and the closing of the `:root[data-theme="dark"]` block — confirm each anchor is unique in the file before inserting.
- No JS in this file, so `node --check` does not apply. After editing, re-read the full file to confirm both blocks are well-formed (matched braces, valid declarations, trailing semicolons).

## 6. Deliverable

- Modified `shared/tokens.css` with the two new token groups in `:root` and `:root[data-theme="dark"]`.
- Report the exact lines added in each block in the chat summary.
- Confirm: no other file changed; no existing token altered.
