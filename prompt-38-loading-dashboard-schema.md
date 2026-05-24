# Prompt 38 — Loading Dashboard: Schema & API

## Goal

Create the database schema and API endpoints for the Loading Dashboard — a bay-based loading management system where jobs are assigned to physical loading bays, progress through loading statuses, and are tracked through transit and delivery.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

**Prerequisite:** Prompt 37 (multi-role) should be completed.

---

## Step 1 — Database migration

Create `loading-dashboard.sql` at the project root:

```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

-- Bays: physical loading bays at the facility
CREATE TABLE IF NOT EXISTS loading_bays (
  id TEXT PRIMARY KEY,
  bay_number INTEGER NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  trailer_number TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed bays 20-30
INSERT OR IGNORE INTO loading_bays (id, bay_number, label, is_active) VALUES
  ('bay-20', 20, 'Bay 20', 1),
  ('bay-21', 21, 'Bay 21', 1),
  ('bay-22', 22, 'Bay 22', 1),
  ('bay-23', 23, 'Bay 23', 1),
  ('bay-24', 24, 'Bay 24', 1),
  ('bay-25', 25, 'Bay 25', 1),
  ('bay-26', 26, 'Bay 26', 1),
  ('bay-27', 27, 'Bay 27', 1),
  ('bay-28', 28, 'Bay 28', 1),
  ('bay-29', 29, 'Bay 29', 1),
  ('bay-30', 30, 'Bay 30', 1);

-- Loading assignments: links jobs to bays with loading status
CREATE TABLE IF NOT EXISTS loading_assignments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  bay_id TEXT DEFAULT NULL,
  trailer_number TEXT NOT NULL DEFAULT '',
  loading_status TEXT NOT NULL DEFAULT 'awaiting',
  assigned_by TEXT DEFAULT NULL,
  started_at TEXT DEFAULT NULL,
  loaded_at TEXT DEFAULT NULL,
  in_transit_at TEXT DEFAULT NULL,
  delivered_at TEXT DEFAULT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (bay_id) REFERENCES loading_bays(id)
);

CREATE INDEX IF NOT EXISTS idx_loading_assignments_job ON loading_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_loading_assignments_bay ON loading_assignments(bay_id);
CREATE INDEX IF NOT EXISTS idx_loading_assignments_status ON loading_assignments(loading_status);
```

### Loading statuses:
- `awaiting` — in the queue, not assigned to a bay yet
- `not_started` — assigned to a bay but loading hasn't begun
- `loading` — actively being loaded
- `loaded` — loading complete, trailer full
- `in_transit` — trailer has left the facility
- `delivered` — confirmed delivered
- `archived` — delivered and archived (hidden from active view)

### Key design notes:
- A job can have MULTIPLE loading assignments (multi-trailer shipments) — `job_id` is NOT unique
- Multiple assignments can share the same `bay_id` (piggyback loads)
- `bay_id` is NULL for `awaiting` status (not yet assigned to a bay)
- `trailer_number` lives on the assignment, not just the bay (trailers move, bays don't)

---

## Step 2 — API handlers in `_worker.js`

### 2a. Loading Bays API

Add `handleApiLoadingBays`:

**GET `/api/loading-bays`** — List all active bays ordered by `bay_number ASC`:
```javascript
const rows = await db.prepare(
  "SELECT * FROM loading_bays WHERE is_active = 1 ORDER BY bay_number ASC"
).all();
return json({ ok: true, bays: rows.results || [] });
```

**PUT `/api/loading-bays`** — Update a bay (trailer number, label). Accept `{ id, trailer_number, label }`.

Wire the route:
```javascript
if (url.pathname === "/api/loading-bays" || url.pathname.startsWith("/api/loading-bays/")) {
  return handleApiLoadingBays(request, env);
}
```

### 2b. Loading Assignments API

Add `handleApiLoadingAssignments`:

**GET `/api/loading-assignments`** — List all active (non-archived) assignments with job details:
```javascript
const includeArchived = url.searchParams.get('include_archived') === '1';
const bayId = url.searchParams.get('bay_id') || '';

let query = `
  SELECT la.*, j.customer, j.invoice_number, j.po_number, j.ship_date, j.ship_to_company,
         j.ship_to_city, j.ship_to_state, j.carrier, j.method,
         lb.bay_number, lb.label as bay_label
  FROM loading_assignments la
  JOIN jobs j ON la.job_id = j.id
  LEFT JOIN loading_bays lb ON la.bay_id = lb.id
`;

const conditions = [];
const binds = [];

if (!includeArchived) {
  conditions.push("la.loading_status != 'archived'");
}
if (bayId) {
  conditions.push("la.bay_id = ?");
  binds.push(bayId);
}

if (conditions.length) query += " WHERE " + conditions.join(" AND ");
query += " ORDER BY la.created_at ASC";

const rows = await db.prepare(query).bind(...binds).all();
return json({ ok: true, assignments: rows.results || [] });
```

**POST `/api/loading-assignments`** — Create a new assignment (pull job into loading). Accept `{ job_id, bay_id, trailer_number, notes }`.

This is a **manager-only action**. Check for the `logistics.loading.manage` permission:
```javascript
const userRole = request.headers.get('X-User-Role') || '';
const userPerms = JSON.parse(request.headers.get('X-User-Permissions') || '{}');
const isAdmin = request.headers.get('X-User-Is-Admin') === '1';

if (!isAdmin && !(userPerms['logistics.loading.manage']?.edit)) {
  return json({ ok: false, error: "Manager access required to assign jobs to loading." }, 403);
}
```

Set `loading_status` to `'awaiting'` if no `bay_id` is provided, or `'not_started'` if a bay is specified.

```javascript
const id = crypto.randomUUID();
const loading_status = payload.bay_id ? 'not_started' : 'awaiting';
const now = new Date().toISOString();

await db.prepare(`
  INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(id, payload.job_id, payload.bay_id || null, payload.trailer_number || '', loading_status,
        request.headers.get('X-User-Id') || null, payload.notes || '', now, now).run();
```

Log activity:
```javascript
await logActivity(db, 'create', 'loading_assignment', id,
  `Assigned job to loading — ${loading_status}`, { job_id: payload.job_id, bay_id: payload.bay_id });
```

**PUT `/api/loading-assignments`** — Update an assignment. Accept `{ id, loading_status, bay_id, trailer_number, notes }`.

Status transitions:
- `awaiting` → `not_started` (requires `bay_id` — assigning to a bay, manager only)
- `not_started` → `loading` (set `started_at` timestamp)
- `loading` → `loaded` (set `loaded_at` timestamp)
- `loaded` → `in_transit` (set `in_transit_at` timestamp)
- `in_transit` → `delivered` (set `delivered_at` timestamp)
- `delivered` → `archived`

Moving from `awaiting` to a bay (`not_started`) requires manager permission. All other transitions are allowed for anyone with `logistics.loading` edit permission.

```javascript
if (payload.loading_status) {
  // Manager-only: assigning to bay (awaiting → not_started) or reassigning bays
  if ((existing.loading_status === 'awaiting' && payload.loading_status === 'not_started') ||
      (payload.bay_id && payload.bay_id !== existing.bay_id)) {
    if (!isAdmin && !(userPerms['logistics.loading.manage']?.edit)) {
      return json({ ok: false, error: "Manager access required for bay assignment." }, 403);
    }
  }

  updates.push("loading_status = ?"); binds.push(payload.loading_status);

  // Set timestamps based on status transitions
  if (payload.loading_status === 'loading' && !existing.started_at) {
    updates.push("started_at = ?"); binds.push(now);
  }
  if (payload.loading_status === 'loaded' && !existing.loaded_at) {
    updates.push("loaded_at = ?"); binds.push(now);
  }
  if (payload.loading_status === 'in_transit' && !existing.in_transit_at) {
    updates.push("in_transit_at = ?"); binds.push(now);
  }
  if (payload.loading_status === 'delivered' && !existing.delivered_at) {
    updates.push("delivered_at = ?"); binds.push(now);
  }
}
```

Log activity for every status change:
```javascript
await logActivity(db, 'update', 'loading_assignment', id,
  `Loading status: ${existing.loading_status} → ${payload.loading_status}`,
  { job_id: existing.job_id, bay_id: payload.bay_id || existing.bay_id });
```

**DELETE `/api/loading-assignments`** — Remove an assignment (manager only). Accept `{ id }`.

Wire the route:
```javascript
if (url.pathname === "/api/loading-assignments" || url.pathname.startsWith("/api/loading-assignments/")) {
  return handleApiLoadingAssignments(request, env);
}
```

---

## Step 3 — Add permission keys

### 3a. In `_worker.js`

Add to `PATH_PERMISSION_MAP` (BEFORE the generic `/logistics/` entry):
```javascript
{ pattern: /^\/logistics\/loading/, key: 'logistics.loading' },
```

Add to `API_PERMISSION_MAP`:
```javascript
{ pattern: /^\/api\/loading-bays/, key: 'logistics.loading' },
{ pattern: /^\/api\/loading-assignments/, key: 'logistics.loading' },
```

### 3b. Add `logistics.loading.manage` to the permission system

This is a special permission for manager-only actions (pulling jobs, assigning bays). Add it to both maps:

In `API_PERMISSION_MAP`, the check is done manually inside the handler (Step 2b), not via the gate. So the gate only needs to check `logistics.loading` for basic view/edit access. The `.manage` check is handler-level.

### 3c. Update seed roles in `loading-dashboard.sql`

Add default permissions for the new keys to existing roles:

```sql
-- Update Staff role to include loading view+edit but not manage
UPDATE roles SET permissions = json_set(permissions,
  '$.logistics.loading', json('{"view":true,"edit":true}'),
  '$."logistics.loading.manage"', json('{"view":false,"edit":false}')
) WHERE id = 'role-staff';

-- Update Administrator role (not strictly necessary since admin bypasses, but for completeness)
UPDATE roles SET permissions = json_set(permissions,
  '$.logistics.loading', json('{"view":true,"edit":true}'),
  '$."logistics.loading.manage"', json('{"view":true,"edit":true}')
) WHERE id = 'role-administrator';
```

---

## Step 4 — Add permission labels to roles admin page

In `admin/roles.html`, add to `PERMISSION_LABELS`:

```javascript
'logistics.loading':         { group: 'Logistics',  label: 'Loading Dashboard' },
'logistics.loading.manage':  { group: 'Logistics',  label: 'Loading — Bay Management (manager)' },
```

---

## What NOT to touch

- Do NOT modify the job board
- Do NOT modify existing logistics pages
- Do NOT modify the BOL generator or load builder
- Do NOT modify existing API handlers
- Do NOT modify the auth flow

---

## Completion checklist

- [ ] `loading-dashboard.sql` migration created with `loading_bays` and `loading_assignments` tables
- [ ] Bays 20-30 seeded
- [ ] `GET /api/loading-bays` returns active bays
- [ ] `PUT /api/loading-bays` updates trailer number/label
- [ ] `GET /api/loading-assignments` returns assignments with job details, filters by bay and archive status
- [ ] `POST /api/loading-assignments` creates assignment (manager-only for bay assignment)
- [ ] `PUT /api/loading-assignments` updates status with proper transition timestamps
- [ ] `DELETE /api/loading-assignments` removes assignment (manager-only)
- [ ] Manager permission check on bay assignment and job pulling
- [ ] Activity logging on all create/update/delete operations
- [ ] Permission keys added to maps: `logistics.loading`, `logistics.loading.manage`
- [ ] Permission labels added to `admin/roles.html`
- [ ] Staff role seeded with loading view+edit, no manage
- [ ] Routes wired in routing block

**Notify Steve:** Run `loading-dashboard.sql` in D1 Dashboard Console. Then go to Admin → Roles and verify "Loading Dashboard" and "Loading — Bay Management" appear in the permission grid.
