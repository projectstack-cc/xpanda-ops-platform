# Prompt 132 — Yard section in Loading Team View

## Context

Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. Assume the **logistics-agent** role.

The Loading Dashboard (`logistics/loading.html`) has two view modes toggled at the top: **Overview** (`overview`) and **Loading Team View** (`bay`). The **Yard** section currently only renders in Overview — its markup lives inside `#ld-overview` and `renderOverview()` populates `#ld-yard`. In Loading Team View, `renderBayList()` renders a bay list into `#ld-bay-list-content` and the Yard is absent.

Add a static (non-collapsible) **Yard** section to the Loading Team View, below the bay list, reusing the existing yard filter and card renderer so behavior matches Overview exactly.

## Scope

- **One file:** `logistics/loading.html`. Frontend only. No worker, no migration, no CSS additions beyond reusing existing classes (`ld-section`, `ld-section-title`, `ld-transit-grid`, `ld-empty`).
- Do **not** touch the Overview Yard (`#ld-yard`, `toggleSection('yard')`), `applyCollapseState`, or the collapse key list. The new section uses a distinct id `ld-yard-team` and is intentionally non-collapsible.

## Methodology (required)

1. Read the file. For each find-block below, confirm it appears **exactly once** (`grep -c` / programmatic count == 1) before applying.
2. Apply both replacements as full-block find/replace (no partial/described edits).
3. Extract the inline `<script>` block(s) from `logistics/loading.html` and run `node --check` on the concatenated script before writing. Do not write if it fails.

## Edit 1 — Add the Yard markup to the Team View container

**Find:**
```html
    <div id="ld-bay-list-content">
      <div class="ld-skeleton" style="padding:12px;">
        <div style="height:72px;background:var(--ghost-bg);border-radius:12px;margin-bottom:8px;animation:pulse 1.5s infinite;"></div>
        <div style="height:72px;background:var(--ghost-bg);border-radius:12px;margin-bottom:8px;animation:pulse 1.5s infinite;"></div>
        <div style="height:72px;background:var(--ghost-bg);border-radius:12px;margin-bottom:8px;animation:pulse 1.5s infinite;"></div>
      </div>
    </div>
  </div>
```

**Replace:**
```html
    <div id="ld-bay-list-content">
      <div class="ld-skeleton" style="padding:12px;">
        <div style="height:72px;background:var(--ghost-bg);border-radius:12px;margin-bottom:8px;animation:pulse 1.5s infinite;"></div>
        <div style="height:72px;background:var(--ghost-bg);border-radius:12px;margin-bottom:8px;animation:pulse 1.5s infinite;"></div>
        <div style="height:72px;background:var(--ghost-bg);border-radius:12px;margin-bottom:8px;animation:pulse 1.5s infinite;"></div>
      </div>
    </div>
    <div class="ld-section" data-section-key="yard-team" style="margin-top:16px;">
      <h3 class="ld-section-title" style="display:flex; align-items:center; gap:8px;">
        Yard
      </h3>
      <div id="ld-yard-team" class="ld-transit-grid"></div>
    </div>
  </div>
```

## Edit 2 — Populate the Team View Yard in `renderBayList()`

**Find:**
```javascript
  container.innerHTML = html;
}
```

**Replace:**
```javascript
  container.innerHTML = html;

  const yard = sortAssignments(allAssignments.filter(a => a.location === 'yard'));
  const yardEl = document.getElementById('ld-yard-team');
  if (yardEl) {
    yardEl.innerHTML = yard.length
      ? yard.map(a => renderAssignmentCard(a, false, false)).join('')
      : '<div class="ld-empty">No trailers in the yard</div>';
  }
}
```

## Acceptance

- Switching to **Loading Team View** shows the bay list with a **Yard** section beneath it.
- Yard cards in Team View are identical to Overview Yard cards (same data, same actions: Mark In Transit / View BOL / Photos / etc. per existing `renderAssignmentCard` logic).
- Empty yard shows "No trailers in the yard".
- Overview Yard and its collapse behavior are unchanged.
- `node --check` passes on the inline script.
