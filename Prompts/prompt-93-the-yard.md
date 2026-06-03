# P93 — "The Yard": move a loaded trailer out of a bay to a holding area

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **logistics-agent** and **db-api-agent**. **Depends on P92** (status write-through) so shipping from the yard propagates correctly.

Use case: a trailer is loaded in a bay, gets pulled to the yard, and another trailer takes the bay. The yard is a holding area; the trailer still needs to be marked shipped from there.

---

## Data model

The job↔bay link lives in **`loading_assignments`** (`bay_id` is already nullable, FK to `loading_bays`; status is `loading_status`). Model the yard as a **location flag on the assignment**, not on `loading_bays`.

### Migration — Steve runs this MANUALLY in the Cloudflare D1 Dashboard Console. Claude Code must NOT run it.
```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.
ALTER TABLE loading_assignments ADD COLUMN location TEXT DEFAULT 'bay';  -- 'bay' | 'yard'
```
First verify `loading_assignments` doesn't already carry an equivalent location concept; if it does, extend that instead of adding a redundant column.

## Behavior

**Backend (`_worker.js`, `handleApiLoadingAssignments` PUT ~line 4432):**
- Accept a `location` field in the assignment update allow-list.
- Add a "move to yard" path: set `location = 'yard'` and `bay_id = NULL` (frees the physical bay) while preserving `loading_status`, `trailer_number`, `load_number`, and the job link. `logActivity('update','loading_assignment', id, 'Moved to yard', ...)`.
- Ensure the assignment list query (~line 4330) returns the `location` column so the frontend can group by it.

**Frontend (`logistics/loading.html`):**
- Add a **"Move to Yard"** action button to occupied bay cards. The bay-card render path is `renderAssignmentCard()` (called from the per-bay `bayAssignments.map(...)` in `renderOverview()`/`renderBayView()`); wire the button to a new `moveToYard(assignmentId)` that PUTs `{ id, location: 'yard', bay_id: null }` then re-`renderDashboard()`.
- Add a **"Yard" section/column** to the overview (next to the in-transit/delivered sections) that lists assignments where `location === 'yard'`, rendered with `renderAssignmentCard`. Yard cards keep their existing actions — **Mark Shipped / View BOL / photos** — unchanged.
- The existing bay filter (`a.bay_id === bay.id && ['not_started','loading','loaded'].includes(a.loading_status)`) naturally excludes yarded assignments once `bay_id` is null; confirm a yarded card does not also render in a bay.

## ASSUMPTIONS (Steve — override before running if any are wrong)
1. The yard is **unbounded** (a simple list, no capacity).
2. "Move to Yard" is available on **any occupied bay card** (not gated behind Mark Loaded).
3. Yarded trailers still require **Mark Shipped** to leave the system, going through the P92 write-through.

---

## What NOT to change
- The auto-pack algorithm. The `STORAGE_KEY`. Bay assignment logic for the normal (non-yard) flow. The photo capture flow. `renderAssignmentCard`'s existing action buttons (only add "Move to Yard" on bay cards).
