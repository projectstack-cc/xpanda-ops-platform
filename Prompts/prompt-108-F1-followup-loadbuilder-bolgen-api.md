# P108 — F1 follow-up: Load Builder + BOL Generator → `api.*` (transport only)

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **logistics-agent**. Foundation Roadmap **Phase F1 open follow-up** — the last and most delicate frontend migration, because these two files hold the battle-tested auto-pack algorithm and the shared BOL render path. **Transport-only refactor: swap `fetch` for `api.*` and nothing else.** Frontend-only, behavior-identical.

**Prereq (already true — confirm, don't change):** both pages load via `logistics-header.js` → `shared-header.js`, so `window.api` / `window.utils` are available.

## Scope
- `logistics/load-builder.html` (~23 raw `fetch` — largest file in the repo, 159KB)
- `logistics/bol-generator.html` (~13 raw `fetch`)

## Migration rules (transport only)
1. **`fetch` → `api.*`** (`get/post/put/del/raw` → `{ ok, data, error, status }`; read `/shared/shared-api.js`). Convert each network call and adapt only its response handling to the new shape. The fetch calls here cover: saved-loads CRUD, parts / load-builder-skus, the P94 `prefillFromJob` job fetch, BOL customers/carriers, and BOL create/update. Endpoints, methods, and bodies stay byte-identical.
2. **Preserve all UI** (toasts/inline/loading/progress) — feed from `error`/`data`.
3. **401** handled by the shared wrapper — drop redundant manual redirects only if confirmed.
4. **`utils.*`:** only swap inline date/escape/truncate helpers for the `/shared/shared-utils.js` equivalents where they match exactly. **Do not** route any load-builder dimensional/packing math or BOL coordinate math through `utils` — those are domain logic, not shared formatters. When in doubt, leave the calc alone.

## CRITICAL — do not touch (this is the whole point of isolating these two files)
- The **auto-pack algorithm**, column/stack building, mixing logic, rotation, bundle-qty handling — untouched. It is battle-tested; this prompt only changes how data is fetched, never how loads are computed.
- **`STORAGE_KEY` (`foam_trailer_loader_v31`)** — never change it.
- **`bol-shared.js`** coordinate logic and `pdf-lib` generation — not in scope; do not edit `bol-shared.js`.
- The **`BolEditor` mount/sizing fix** from P94 and `prefillFromJob`'s append/matching behavior — leave intact; only the `fetch` inside `prefillFromJob` becomes `api.get`.
- Saved-load layout serialization / TTL handling — leave logic intact; only its network calls migrate.

## Verify before declaring done
Identical behavior end-to-end: build a load (auto-pack output unchanged for a known input), save + reload a saved load, Pull-from-Job appends correctly (P94), open the inline BOL editor at correct size (P94), generate a BOL via `bol-shared.js`. No raw `fetch(` remains in either file (outside shared `*.js`).

## What NOT to change
- Auto-pack, mixing, rotation, bundle logic. `STORAGE_KEY`. `bol-shared.js`. `pdf-lib` generation. The P94 BolEditor/prefill behavior. Any dimensional/coordinate math. Endpoints/bodies/outputs. Other modules. The header chain.
