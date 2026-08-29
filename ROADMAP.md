# xPanda Ops Platform — Roadmap

> This file previously contained the verbatim text of an old QC density-calculator task prompt
> (not a roadmap). Replaced under `QC Cleanup-2` (AUDIT-601) with the platform's actual
> forward-looking remediation roadmap. Living doc — cross-reference `Prompts/`, `BACKLOG.md`, and
> `CHANGELOG.md` for current status; this file summarizes, it doesn't duplicate their detail.

---

## 1. QC Cleanup Track (active remediation sprint)

A sequence of numbered prompts (`Prompts/prompt-QC-Cleanup-*.md`) closing findings from the
platform QC/red-team audit (`PLATFORM-QC-AUDIT-P409.md`, `PLATFORM-REDTEAM-AUDIT-P409.md`),
tracked as `AUDIT-###` / `RT-##` / `REVIEW-#` IDs. Ordered in waves by production risk — safest
(docs/error-bodies) first, destructive (DROP/removal) and auth-path changes last, with two
parallel zero-risk verification/audit tracks that can run anytime.

**Wave A — safest (error bodies, docs, hygiene, format-only, one destructive DROP):**
- `QC Cleanup-1` — Info-leak hardening (error-response bodies). Closes AUDIT-101, RT-08.
- `QC Cleanup-2` — Docs cleanup: this file, stale BOL-file references, stale file-size figures,
  the missing `manufacturing.cutting.override` permission doc. Closes AUDIT-601, AUDIT-602,
  AUDIT-603, AUDIT-004.
- `QC Cleanup-3` — `.wrangler/`/`.gitignore` repo hygiene. Closes AUDIT-702.
- `QC Cleanup-4` — Drop orphan parts tables (destructive — DROP). Closes AUDIT-002 / AUDIT-303.
- `QC Cleanup-5` — Timestamp standardization (legacy + v2 inline inserts). Closes AUDIT-201,
  AUDIT-202, REVIEW-1.

**Wave B — behavioral, additive, or verification-only:**
- `QC Cleanup-6` — Retire v1 Production inventory pages (executes queued BACKLOG P403 item).
  Closes AUDIT-001.
- `QC Cleanup-7` — Dead-code sweep (v2 + reports endpoint + BOL remnants, removal-only). Closes
  AUDIT-302, AUDIT-304, AUDIT-602 (code half), REVIEW-2.
- `QC Cleanup-8` — `logActivity()` coverage gaps (qc.js, production.js, bol-email.js). Closes
  AUDIT-501, AUDIT-502, AUDIT-503, RT-07.
- `QC Cleanup-9` — VERIFY (read-only): v2 activity-log enumeration. Closes the open question behind
  AUDIT-504 (corrected) / AUDIT-203.

**Wave C — auth path (higher blast radius):**
- `QC Cleanup-10` — Auth lifecycle hardening (has a KV binding prerequisite). Closes RT-01, RT-02,
  RT-09.
- `QC Cleanup-11` — Session-gate hardening. Closes RT-03, RT-05.

**Wave D — destructive / high-blast-radius:**
- `QC Cleanup-12` — QuickBooks integration full removal (destructive — drop-ordering + credential
  revocation). Closes AUDIT-305, AUDIT-505, partial RT-03/RT-07.
- `QC Cleanup-13` — Legacy Cutting Dashboard retirement (destructive — touches `jobs.js`). Closes
  AUDIT-301.

**Parallel — zero production risk, no ordering dependency:**
- `QC Cleanup-14` — VERIFY: scaffolding-retirement audit (read-only, all agents).
- `QC Cleanup-15` — VERIFY: XSS-sink audit (read-only). Closes RT-04.

---

## 2. Open BACKLOG.md Themes (forward-looking)

Beyond the QC Cleanup track, `BACKLOG.md` carries the platform's standing feature/debt backlog by
module. Full item-level detail lives there — this is a pointer, not a duplicate:

- **Auth / Session** — hardening follow-ups feeding into `QC Cleanup-10`/`11`.
- **Production Log (v2)** — density-readout expansion; v1 module archival (`QC Cleanup-6`).
- **Carrier View (v2)** — appointment/ETA time column, dock instructions; upload-image downscale.
- **Shift Notes (v2)** — v2 activity-log parity.
- **Manufacturing / Cutting (React pilot)** — ongoing block-nester and bag-label work on `/v2/blocks`.
- **Orders (v2)** — order-board follow-ons.
- **Schedule Board (v2)** — scheduling follow-ons.
- **Loading Board (v2)** — loading-board follow-ons.
- **Logistics** — BOL / load-builder / loading-dashboard follow-ons.
- **Job Board** — Kanban / packing-slip follow-ons.
- **QuickBooks Integration** — scoped and tabled (not active); full removal path is
  `QC Cleanup-12` if the decision is made to drop it rather than resume it.
- **Admin / Platform** — role/permission and activity-log follow-ons.
- **Infra / CI-CD** — pipeline follow-ons.
- **Foundation Roadmap** — ✅ all phases complete (historical; see `CHANGELOG.md`).
- **Production / Manufacturing** — non-v2 module follow-ons.
- **Scrap Database (native — replaces Google Sheets)** — scoped, separate project (not started).
- **Manufacturing ERP add-ons** — icebox; fold in opportunistically.
- **QC** — QC module follow-ons.
- **Safety** — safety module follow-ons.
- **Reports** — reporting follow-ons.

See `BACKLOG.md` for the authoritative, itemized version of each of the above; see `CHANGELOG.md`
for everything already shipped.

---

## Process

- Each `QC Cleanup-N` prompt is scoped, single-agent (or a small named set), and ends with a
  ready-to-push report — one commit per prompt, no bundling.
- `CHANGELOG.md` gets an entry keyed to `QC Cleanup-N` when a prompt ships; `BACKLOG.md` items are
  removed when the work they describe ships.
- **Migration-before-push (HARD RULE)** and the **v2 visibility gate (HARD RULE)** in
  `xpanda-ops-agents.md` apply to this track exactly as they do to any other prompt.
