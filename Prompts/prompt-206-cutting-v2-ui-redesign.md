# Prompt 206 — Cutting v2: dashboard UI redesign (tablet-first master-detail)

## ⚠️ Read first — sanctioned framework exception
Read **`AGENTS.md`**, **`xpanda-ops-agents.md`**, and **`agent-react-component.md`** (the full design
doctrine). The "vanilla JS only" rule is **suspended for `cutting-pilot/` only**. Do not revert/warn.
Touch nothing outside `cutting-pilot/` except `CHANGELOG.md` / `BACKLOG.md`.

## Assigned agent
- **React Component Agent** (`agent-react-component.md` / §9b). State your one-line **Design Read**
  before generating UI. Defer to `agent-frontend-designer.md` for design-system values (palette,
  type, spacing, tokens) and to §9a for anything touching routing/auth/bindings/the API contract.

## Goal
Replace the current barbaric P198 cutting UI with the proper **tablet-first, by-job, master-detail**
interface, built to the design doctrine. This is a **UI-layer redesign only** — the data contract,
API routes, and DB model from P198 are untouched (see fences). The screen must stop reading as
AI-generated and start reading as an industrial operations console.

## Consume the EXISTING contract (do not change it)
The queue and action routes already exist (P198). The UI consumes them as-is:
- `GET /v2/api/cutting/queue` → jobs, each with `requiredLines` and `lines[]`:
  `{ line, line_status('not_started'|'in_progress'|'complete'), sort_order, open_session_id|null,
  open_operator_name|null, last_handoff_note }`.
- `POST /v2/api/cutting/clock-in` `{ job_id, line }`
- `POST /v2/api/cutting/clock-out` `{ session_id, handoff_note, qty_done_delta? }`
- `POST /v2/api/cutting/complete-line` `{ job_id, line, handoff_note? }`
After every mutating action, refetch the queue. Operator identity is server-side (headers) — never a
form field. If the UI genuinely needs a field the contract lacks, STOP and flag §9a — do not add it
here.

## Locked design (build exactly this)
**Tablet-first** (cutter stations are mounted/surface tablets), scaling up to laptop with the same
components, degrading gracefully narrow. Not kanban, not floating cards — an expandable list.

### Master view — job list
- Vertical list, one **row per job**. Dense and scannable (cockpit density), regions defined by
  hairline `border-line`, NOT shadows.
- Row content: job identity (invoice #, customer, ship date) with **`font-mono tabular-nums`** on
  invoice/date/counts; a **rolled-up `StatusPill`** (NOT five separate dots); and a **handoff-note
  indicator** (small lucide icon) when any line's `last_handoff_note` is non-empty — so the next
  shift sees "read me" without expanding.
- **Rolled-up pill derivation** (define once, color+text, never color alone):
  - all required lines `complete` → **"Cut complete"** (success token)
  - any line has an `open_session_id` → **"Cutting · N/M"** (active/accent token), where N = complete,
    M = required count
  - some `complete`, none open → **"N/M done"** (neutral progress)
  - none started → **"Not started"** (quiet neutral)
- Selecting a row opens the detail surface for that job and visually marks the row active.

### Detail surface — per-job lines + operator loop
- **Responsive container:** a **side drawer** at ≥ tablet-landscape/laptop (list stays visible,
  master-detail); a **bottom sheet** at narrow widths. Both are the SAME reusable primitive
  (`<Sheet>`), composed — no duplicated markup.
- Shows the five required lines in `sort_order` (Cross Cutter, Hole Cutter, Main Line, Blue Line,
  Laminate). Each **`LineRow`**: line name, status (color+text), clocked-in operator name if any,
  and the line's `last_handoff_note` shown prominently as the resume hint.
- Per-line actions, gated by state (≥44px targets, `cursor-pointer`, `:focus-visible`):
  - no open session, not complete → **Clock In** (you become operator)
  - YOUR open session → **Clock Out** (opens handoff `<Modal>`: note textarea + optional qty) and
    **Mark Complete**
  - SOMEONE ELSE's open session → "Running — {name}", actions disabled (the one-operator guard;
    surface the 409 `line_busy` clearly if it still races)
  - `complete` → success state, no actions

### Components to build (establish the reusable pattern — the point of the migration)
- `src/components/Sheet.tsx` — ONE responsive overlay primitive (side drawer ↔ bottom sheet by
  breakpoint). Scrim is the only place blur is allowed.
- `src/components/Modal.tsx` — ONE centered dialog primitive (the handoff form composes it). If
  `Sheet` already covers the dialog need cleanly, compose rather than duplicate — but no copy-paste.
- `src/components/StatusPill.tsx` — rolled-up + per-line status rendering, color+text from tokens.
- `src/app/v2/cutting/CuttingBoard.tsx` (`"use client"`) — fetch queue, render list, manage selected
  job + refetch.
- `JobRow.tsx`, `LineRow.tsx`, `HandoffModal.tsx` — composed from the primitives above.
- `page.tsx` stays a thin server shell rendering `<CuttingBoard/>`.

## Design doctrine (enforced — see agent-react-component.md for the full list)
- **No AI tells:** no emoji icons (use **lucide-react**), no decorative gradients/blur, nothing
  reflexively centered, no row of identical metric cards, no uniform soft shadows.
- **Industrial identity:** committed type voice; `font-mono tabular-nums` on ALL numeric data;
  borders over shadows; brand **red used sparingly** (primary action / rush / alert only); one focal
  point per screen.
- **Tokens only** — no hex literals; status colors mapped to tokens once; light+dark both correct.
- **Designed states:** empty ("No jobs need cutting — check the Job Board"), loading (skeleton rows,
  not a centered spinner), error (inline message + retry). Never a blank div or bare spinner.
- **Accessibility:** contrast ≥4.5:1 both themes, `prefers-reduced-motion` honored (motion only
  explains state changes), ARIA labels on icon-only buttons, full keyboard nav.

## Build verification (MANDATORY — loop until green before completion)
- `cd cutting-pilot && npx tsc --noEmit` clean.
- `npx opennextjs-cloudflare build` exits 0 (the P205 asset-relocation step runs in the pipeline —
  do not remove it). If anything fails, fix and re-run until verified green. Never hand back a
  non-building tree.
- Confirm the P203 middleware `_next/static` exclusion and P205 asset relocation are untouched.

## Post-deploy check (Steve deploys; then verify on www.xpandaops.com/v2/cutting)
- List renders dense + legible on a tablet, both themes; pills and handoff indicators correct.
- Open a row → drawer (laptop) / sheet (narrow); clock in → status flips, your name shows; clock out
  with a note → note shows as resume hint; mark all required lines complete → job flips to `done` on
  the legacy board.
- No emoji, no stray spinner, empty/error states look designed.

## Changelog / backlog
- `CHANGELOG.md` under `## Manufacturing / Cutting (React pilot)` (newest-first):
  > **P206** — Cutting v2 UI redesign: replaced the placeholder P198 interface with a tablet-first,
  > by-job master-detail board — dense job list with rolled-up status pill + handoff-note indicator,
  > responsive detail (side drawer/bottom sheet) for the five-line operator loop. Established
  > reusable `<Sheet>`/`<Modal>`/`<StatusPill>` primitives (no copy-paste). Industrial design
  > doctrine applied (lucide icons, mono tabular-nums, borders-over-shadows, tokenized status, brand
  > red sparing, designed empty/loading/error states). Data contract unchanged.
- `BACKLOG.md`: mark the cutting UI redesign done; remaining cutting items = priority listing,
  nav link wiring, block-calculator BOM (`cutting_lines.qty_target`).

## Do NOT
- Change `/v2/api/cutting/*` handlers, the queue payload shape, or the DB model (P198 / §9a domain).
  Flag §9a if a missing field blocks the UI.
- Invent a client-side state model — the server is authoritative; refetch after actions.
- Collect operator identity from a form (headers only).
- Remove the P203 middleware exclusion or the P205 asset-relocation build step.
- Use kanban columns / draggable cards, emoji icons, hardcoded colors, or any marketing-page pattern
  (hero/bento/eyebrow/etc. — explicitly out of scope per the agent doc).
- Touch anything outside `cutting-pilot/` except `CHANGELOG.md` / `BACKLOG.md`.
