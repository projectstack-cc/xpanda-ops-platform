# Prompt 198 — Cutting v2 pilot: operator loop (clock in/out, handoff, line completion)

## ⚠️ Read first — sanctioned framework exception
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. The "vanilla JS only / no frameworks" rule
is **deliberately suspended for `cutting-pilot/` only** — this is the sanctioned React/Next.js +
Tailwind pilot. Do not revert or warn about React/Tailwind/Next inside `cutting-pilot/`. Touch
nothing outside `cutting-pilot/` except `CHANGELOG.md` / `BACKLOG.md` at the end.

## Prerequisites (all confirmed green by Steve)
- P196/P197 done: dev server green, Worker builds, auth bridge validated on the real host
  (`xpandaops.com`) — `/v2/cutting` renders identity via the shared `xpanda_session`.
- `add-cutting-sessions.sql` has been run in D1 — `cutting_lines` and `cutting_sessions` exist.
- `GET /v2/api/cutting/queue` returns real jobs with `requiredLines`.

## Assigned agents
- **Frontend Designer** (`agent-frontend-designer.md`) — the operator UI. Floor use on iPads/phones:
  44px+ touch targets, large tap areas, Tailwind colors via the `var(--token)` mapping (matches the
  platform). This is the FIRST real React component work — establish a clean, reusable component
  pattern (one `<Modal>`, composable line/session components). The whole point of the migration is
  reactive components, NOT copy-pasted modals — set that precedent here.
- **Database & API agent** (`xpanda-ops-agents.md` §9) — the `/v2/api/cutting/*` route handlers and
  D1 writes against `cutting_lines` / `cutting_sessions`.
- **Admin & Auth agent** (§8) — operator identity is authoritative from the session, never client-trusted.

## Schema reference (already migrated — do not re-create)
```
cutting_lines:    id, job_id, line, line_status('not_started'|'in_progress'|'complete'),
                  qty_target(NULL until BOM), qty_done, sort_order, created_at, updated_at
                  UNIQUE(job_id, line)
cutting_sessions: id, job_id, line, operator_id, operator_name, status('open'|'closed'),
                  started_at, ended_at, handoff_note, qty_done_delta, created_at
PROCESS_ORDER = ['Cross Cutter','Hole Cutter','Main Line','Blue Line','Laminate']
```

## Locked design (from scoping — build exactly this)
- **Pick job → pick line.** Operator selects a job, then the specific line they're running. Sessions
  are per-line. Multiple operators may be clocked into different lines of the same job at once.
- **One operator per line at a time.** Reject a clock-in if an `open` session already exists for
  that (job_id, line). (Floor reality: people sometimes share a line physically, but the model is
  one clock-in per line for now.)
- **Operator identity is authoritative from the session.** `operator_id`/`operator_name` come from
  the middleware-injected `X-User-Id` / `X-User-Name` headers — NEVER from the client body. (Mirror
  the legacy P160 "authoritative, not client-trusted" pattern.)
- **Handoff note captured at clock-out.** This is the highest-value field — "where we stopped /
  watch out for X." The next shift reads it to resume.
- **Mark complete is per line.** When ALL of a job's required lines reach `complete`, fire ONE
  "cutting complete" signal to the job board. NO per-line sync back, NO bidirectional pill behavior.

## Tasks

### A. Queue route — extend to carry line state (`src/app/v2/api/cutting/queue/route.ts`)
Currently returns jobs + `requiredLines` (derived from `jobs.processes`). Extend so the board can
render line state in one payload:
1. **Lazily reconcile `cutting_lines`** from each job's `requiredLines`: `INSERT OR IGNORE INTO
   cutting_lines (id, job_id, line, line_status, sort_order, created_at, updated_at)` for each
   required line (status default `not_started`, `sort_order` = PROCESS_ORDER index). This keeps
   `cutting_lines` in sync with the job board's checked processes without touching legacy job
   creation. (A GET performing idempotent upserts is acceptable here — legacy `validateSession`
   does similar housekeeping.)
2. Return, per job, a `lines[]` array: `{ line, line_status, sort_order, open_session_id|null,
   open_operator_name|null, last_handoff_note }`. Derive `open_*` from the current `open`
   `cutting_sessions` row for that (job_id, line); `last_handoff_note` from the most recent
   `closed` session's `handoff_note` for that line (the resume hint).
3. Keep filtering to jobs with ≥1 required line; keep excluding `archived`/`shipped`. Order lines
   by `sort_order`.

### B. Clock-in route — `POST /v2/api/cutting/clock-in`  (`src/app/v2/api/cutting/clock-in/route.ts`)
- Body: `{ job_id, line }`. Validate `line` ∈ PROCESS_ORDER.
- Operator from headers: `X-User-Id`, `X-User-Name` (read via `headers()` / request headers).
- **Guard:** if an `open` session exists for (job_id, line) → return 409 `{ ok:false, error:'line_busy',
  operator: <name> }`. Do not open a second.
- Insert `cutting_sessions` row: status `open`, `started_at` now, `operator_id`/`operator_name` from
  headers.
- Set `cutting_lines.line_status = 'in_progress'` for that (job_id, line) (unless already `complete`).
- If `jobs.status = 'not_started'`, bump to `'in_production'` (one-directional, safe; never downgrade).
- `logActivity` analog: insert an `activity_log` row (same table as legacy — shared D1) action
  `update`, entity `cutting_session`, summarizing the clock-in. (Match legacy `activity_log` columns.)

### C. Clock-out route — `POST /v2/api/cutting/clock-out`  (`.../clock-out/route.ts`)
- Body: `{ session_id, handoff_note, qty_done_delta? }`. Operator from headers (must match the
  session's `operator_id`, else 403 — only the clocked-in operator closes their own session; allow
  admin override via `X-User-Is-Admin`).
- Close the session: status `closed`, `ended_at` now, store `handoff_note`, store `qty_done_delta`
  if provided (also add to `cutting_lines.qty_done` if non-null).
- Line stays `in_progress` (work paused, not finished). Do NOT set `complete` here.

### D. Complete-line route — `POST /v2/api/cutting/complete-line`  (`.../complete-line/route.ts`)
- Body: `{ job_id, line, handoff_note? }`. Operator from headers.
- Set `cutting_lines.line_status = 'complete'` for (job_id, line).
- Close any lingering `open` session on that line (status `closed`, `ended_at` now, record
  `handoff_note` if passed) — no orphan open sessions.
- **Job-board signal:** after setting complete, check if ALL `cutting_lines` for `job_id` are
  `complete`. If so: `UPDATE jobs SET status='done', updated_at=? WHERE id=? AND status IN
  ('not_started','in_production')` (never downgrade loading/shipped/archived). This is the single
  one-directional signal.
- `activity_log` row for the completion (and for job-done when it fires).

### E. Operator UI — `src/app/v2/cutting/page.tsx` + components
Replace the proof-of-bridge placeholder with the real board. Suggested structure (establish the
reusable pattern):
- `page.tsx` — server component shell, renders `<CuttingBoard />`.
- `src/app/v2/cutting/CuttingBoard.tsx` — `"use client"`. Fetches `/v2/api/cutting/queue`,
  renders the job list. Selecting a job opens its line detail. Refetches after every action.
- `src/components/Modal.tsx` — ONE reusable modal primitive (used for the clock-out handoff form).
  This is the anti-copy-paste precedent.
- Line rows show: line name, status pill (not_started / in_progress / complete — use token colors),
  clocked-in operator name if any, and the last handoff note (the resume hint) shown prominently.
- Actions per line, gated by state:
  - `not_started` / `in_progress` with no open session → **Clock In** (becomes the current user).
  - line has YOUR open session → **Clock Out** (opens Modal: handoff note textarea, optional qty)
    and **Mark Complete**.
  - line has SOMEONE ELSE's open session → show "In progress — {name}", actions disabled (the
    one-operator guard, surfaced in UI; 409 from the API is the backstop).
  - `complete` → green pill, no actions.
- Mobile-first: 44px+ targets, single-column on phone, readable on a 7" tablet in portrait.
- Handle the 409 `line_busy` response with a clear toast/inline message (don't swallow it).

## Verification gate (before commit)
- `cd cutting-pilot && npx tsc --noEmit` → clean.
- `npm run dev` on the real host context (or local with remote D1), manually walk the loop:
  1. Queue shows real jobs with their lines + statuses.
  2. Clock into a line → status flips to in_progress, your name shows.
  3. Second clock-in attempt on the same line (different/forced operator) → 409 surfaced, not opened.
  4. Clock out with a handoff note → line stays in_progress, note shows as the resume hint.
  5. Mark each required line complete → on the last one, the linked job flips to `done` on the
     legacy job board (verify in the legacy app).
- Confirm operator identity on written rows matches the logged-in user (header-derived, not client).

## Changelog / backlog
- `CHANGELOG.md` under `## Manufacturing / Cutting (React pilot)` (newest-first):
  > **P198** — Cutting v2 operator loop: pick-job→pick-line clock-in/out with per-line sessions.
  > Queue route lazily reconciles `cutting_lines` from job-board processes and returns per-line
  > status + open operator + last handoff note. New routes `/v2/api/cutting/{clock-in,clock-out,
  > complete-line}`: operator identity authoritative from session headers (not client); one-open-
  > session-per-line guard (409 `line_busy`); clock-out captures the handoff note (line stays
  > in_progress); complete-line closes lingering sessions and, when all required lines complete,
  > fires the single one-directional `jobs.status='done'` signal to the job board (no pill sync).
  > First real React components: reusable `<Modal>` primitive established (anti-copy-paste). Mobile-
  > first floor UI. Activity logged to shared `activity_log`.
- `BACKLOG.md` Cutting v2 line: mark operator loop done; remaining = priority ordering (next),
  block-calculator BOM wiring (`cutting_lines.qty_target`), kill `cutting_steps`/legacy
  `cutting-dashboard.html` once v2 is on the floor.

## Do NOT
- Touch the legacy `cutting_steps` table, `_worker.js/routes/cutting.js`, `lib/cutting.js`, or
  `manufacturing/cutting-dashboard.html` — they stay live until v2 reaches the floor.
- Add per-line sync back to the job board (only the all-complete → done signal).
- Trust operator identity from the client body.
- Touch anything outside `cutting-pilot/` except `CHANGELOG.md` / `BACKLOG.md`.
