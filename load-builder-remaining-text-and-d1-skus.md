# Load Builder — Remaining Space Text Display + D1 SKU Storage

You are working inside the xPanda Operations Platform repository. Follow all rules defined in AGENTS.md.

---

## Feature 1: Show Remaining Trailer Space in Stats Text

### Problem

The SVG trailer layout shows remaining space as a hatched area with a label like `45' 0" remaining`, but when the remaining space is too small for the label to fit inside the SVG, the user has no way to see how much space is left.

### Required Change

Add the remaining space as text in the **trailer stats line** — the line that currently reads something like:

> `15% length · 9% floor · 0 mixed stacks`

Change it to include the remaining space at the end:

> `15% length · 9% floor · 0 mixed stacks · 45' 0" remaining`

**Formatting rules:**
- Calculate: `remainingInches = dims.length - trailer.usedLength`
- If `remainingInches >= 12`: display as `XX' YY"` (e.g., `45' 0"`, `12' 6"`)
- If `remainingInches > 0` and `< 12`: display as just `YY"` (e.g., `8"`)
- If `remainingInches === 0`: display `FULL` instead
- Append the word `remaining` after the measurement (except for `FULL`)
- Style the remaining space portion in a slightly different color to draw attention — use `var(--accent)` or the orange color (`#D97706`) so it stands out from the gray stats text

This text should appear in the stats subtitle line for **every trailer** in the results view, regardless of whether the SVG label is visible.

### Where to change

In the `renderResultsTab` function, find where the subtitle line is built (the one with `% length · % floor · mixed stacks`). Append the remaining space calculation to that string.

---

## Feature 2: Move SKU Library from localStorage to D1

### Problem

SKUs are currently stored in `localStorage` under key `foam_trailer_loader_v31`. This means each user's browser has its own isolated SKU library — SKUs added on one computer don't appear on another. The SKU library needs to be shared across all users via the D1 database.

### Database Schema

Add one new table to D1. Document the CREATE TABLE SQL as a comment block in `_worker.js` near the new route handlers:

```sql
CREATE TABLE IF NOT EXISTS load_builder_skus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  length_in REAL NOT NULL,
  width_in REAL NOT NULL,
  height_in REAL NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#D97706',
  allow_rotation INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lb_skus_sku ON load_builder_skus(sku);
```

**Field notes:**
- `id` — use `crypto.randomUUID()` in the worker, matching the existing pattern
- `allow_rotation` — integer 0/1 (SQLite boolean), maps to the JS `allowRotation` field
- `sort_order` — for future drag-and-drop reordering; default to insertion order
- `length_in`, `width_in`, `height_in` — renamed with `_in` suffix to match the `parts_library` convention, but mapped to `length`, `width`, `height` in the JS objects returned by the API

### API Routes

Add these routes to `_worker.js` following the existing flat `if/else` pattern:

#### `GET /api/load-builder-skus`

Returns all SKUs ordered by `height_in ASC, name ASC` (matching the current `sortByHeight` behavior).

Response: JSON array of SKU objects with fields mapped to the JS naming convention:
```json
[
  {
    "id": "uuid",
    "name": "4in block",
    "sku": "FB-4",
    "length": 48,
    "width": 24,
    "height": 4,
    "weight": 1,
    "notes": "",
    "color": "#D97706",
    "allowRotation": false
  }
]
```

Map DB columns to JS fields in the SELECT or in the response mapping:
- `length_in` → `length`
- `width_in` → `width`
- `height_in` → `height`
- `allow_rotation` (0/1) → `allowRotation` (boolean)

#### `POST /api/load-builder-skus`

Create a new SKU. Accepts the JS-named fields in the request body. Generates UUID. Returns the created SKU.

#### `PUT /api/load-builder-skus/:id`

Update an existing SKU. Accepts partial updates. Sets `updated_at` to `datetime('now')`.

#### `DELETE /api/load-builder-skus/:id`

Delete a SKU by ID. Returns `{ success: true }`.

#### `POST /api/load-builder-skus/seed`

A one-time seed endpoint that inserts the DEFAULT_SKUS if the table is empty. This allows the app to self-initialize on first load. Check `SELECT COUNT(*) FROM load_builder_skus` — if 0, insert the defaults. If already populated, return `{ seeded: false, message: "SKUs already exist" }`.

### Frontend Changes

#### Loading SKUs

Replace the `loadSaved()` function logic. On page load:

1. Fetch `GET /api/load-builder-skus`
2. If the response is an empty array, call `POST /api/load-builder-skus/seed` to populate defaults, then re-fetch
3. Use the fetched SKUs as the source of truth
4. **Fallback**: If the fetch fails (network error, API not deployed yet), fall back to localStorage as before — this ensures the page still works during development or if the API is temporarily unavailable

#### Saving SKUs

Replace all `localStorage.setItem` calls for SKU persistence:

- **Add SKU**: `POST /api/load-builder-skus` with the new SKU data, then re-fetch the full list
- **Edit SKU**: `PUT /api/load-builder-skus/:id` with updated fields, then re-fetch
- **Delete SKU**: `DELETE /api/load-builder-skus/:id`, then re-fetch
- **Reset to defaults**: Delete all SKUs (loop through DELETE calls or add a `DELETE /api/load-builder-skus/all` endpoint), then call the seed endpoint
- **CSV paste import**: Loop through parsed rows and `POST` each one, then re-fetch

After each mutation, re-fetch the full SKU list and re-render. This keeps the UI in sync with the database.

#### Remove localStorage dependency for SKUs

- Remove the `localStorage.setItem(STORAGE_KEY, ...)` calls for SKU data
- Remove the `localStorage.getItem(STORAGE_KEY)` read in `loadSaved()`
- **Keep** localStorage for any non-SKU state if it exists (e.g., cart state between sessions is fine to keep in localStorage since carts are per-user/session)
- The `STORAGE_KEY` constant can remain in the code but should no longer be used for SKU storage

#### Async handling

Since the page now makes API calls, the initial load and all mutation operations become async:

- Show a brief loading state on first render while SKUs are being fetched (a simple "Loading SKUs..." text in the SKU grid area)
- Disable the Add/Edit/Delete buttons while an API call is in progress to prevent double-submits
- Show a brief error message if an API call fails, and do NOT clear the current UI state on failure

#### `persist()` function refactor

The current `persist(newSkus)` function directly writes to localStorage and re-renders. Refactor it:

- For bulk operations (reset, import), it should call the appropriate API endpoints and re-fetch
- For single operations (add, edit, delete), it should call the specific endpoint and re-fetch
- The render should happen after the re-fetch completes

You may want to split `persist` into `addSku`, `updateSku`, `deleteSku`, `resetSkus`, and `importSkus` functions for clarity.

---

## Manual Steps Required After Running This Prompt

**IMPORTANT — Tell the developer these steps at the end of your output:**

The following SQL must be run manually in the Cloudflare D1 console (Dashboard → D1 → your database → Console tab) BEFORE the API routes will work:

```sql
CREATE TABLE IF NOT EXISTS load_builder_skus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  length_in REAL NOT NULL,
  width_in REAL NOT NULL,
  height_in REAL NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#D97706',
  allow_rotation INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lb_skus_sku ON load_builder_skus(sku);
```

After creating the table, deploy the updated `_worker.js` with `npx wrangler pages deploy` (or your normal deploy method). The app will automatically seed the default SKUs on first load.

---

## What NOT to Change

- The trailer loading algorithm (calcLoading, buildRow, buildColumn, exactFillHeight, etc.)
- The manual trailer editor
- The SVG rendering functions (except the remaining-space text that's already in the SVG — leave that as-is)
- The print packing slip functionality
- The cart management (cart stays in local JS state — it's session-specific, not shared)
- The platform header/footer/shared CSS
- Any files outside of `/logistics/load-builder.html` and `_worker.js`

---

## Rules

- No frameworks. Vanilla HTML, CSS, JavaScript only.
- Follow existing `_worker.js` route patterns exactly (flat if/else, async handlers, `json()` helper)
- UUID generation via `crypto.randomUUID()` matching existing pattern
- No authentication on routes (matching existing pattern)
- The page must still work if the API is unavailable (localStorage fallback)
- All existing functionality must continue to work — adding D1 storage is additive, not a rewrite
