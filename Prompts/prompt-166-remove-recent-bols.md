# Remove the "Recent BOLs" sidebar from the BOL Generator

> Assign a number before committing. Pure removal + layout: deletes the Recent BOLs sidebar (markup,
> CSS, loader fn + its calls) and makes the form full-width. Reflects HEAD `a66e5e2`.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent** —
`logistics/bol-generator.html` only. No worker, no migration.

## Files
- `logistics/bol-generator.html` — 6 edits

---

### Edit 1 — remove the sidebar markup

FIND (count == 1):
```
<!-- ═══════════════════════════════════════════════════
     Right column — sidebar
════════════════════════════════════════════════════ -->
<div class="bol-sidebar-col">

  <div class="bol-section">
    <div class="bol-section-title">Recent BOLs</div>
    <div id="recent-bols-list">
      <div class="bol-recent-empty">Loading…</div>
    </div>
  </div>

</div><!-- /.bol-sidebar-col -->
```
REPLACE: *(empty — delete the block)*

### Edit 2 — make the form column full-width

FIND (count == 1):
```
.bol-columns {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 20px;
  align-items: start;
}
```
REPLACE:
```
.bol-columns {
  display: block;
}
```

### Edit 3 — remove the Recent BOLs CSS

FIND (count == 1):
```
/* ── Recent BOLs sidebar ─────────────────────────────────────────────── */
.bol-recent-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  border-radius: 6px;
  transition: background .1s, padding .1s;
}

.bol-recent-item:last-child { border-bottom: none; }

.bol-recent-item:hover {
  background: var(--accent-soft);
  padding: 10px 6px;
  margin: 0 -6px;
}

.bol-recent-num      { font-weight: 800; font-size: 14px; }
.bol-recent-customer { font-size: 12px; color: var(--muted); margin-top: 1px; }
.bol-recent-meta     { font-size: 11px; color: #94a3b8; margin-top: 1px; }
.bol-recent-empty    { font-size: 13px; color: var(--muted); text-align: center; padding: 16px 0; }
```
REPLACE: *(empty)*

### Edit 4 — remove the `loadRecentBols` function

FIND (count == 1):
```
async function loadRecentBols() {
  const list = document.getElementById('recent-bols-list');
  try {
    const res = await api.get('/api/bols?days=90');
    const bols = ((res.data && res.data.bols) || []).slice(0, 10);

    if (!bols.length) {
      list.innerHTML = '<div class="bol-recent-empty">No recent BOLs</div>';
      return;
    }

    list.innerHTML = '';
    for (const b of bols) {
      const item = document.createElement('div');
      item.className = 'bol-recent-item';
      item.style.position = 'relative';
      item.innerHTML = `
        <div class="bol-recent-num">BOL #${b.bol_number}</div>
        <div class="bol-recent-customer">${esc(b.ship_to_company || '—')}</div>
        <div class="bol-recent-meta">${esc(b.date)} · ${esc(b.carrier_name || '—')}</div>
        <button class="bol-delete-btn" title="Delete BOL" style="position:absolute;top:6px;right:6px;background:none;border:none;color:#dc2626;font-size:18px;cursor:pointer;padding:2px 6px;line-height:1;">&times;</button>
      `;
      item.querySelector('.bol-delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete BOL #${b.bol_number}? This cannot be undone.`)) return;
        const res = await api.del(`/api/bols/${b.id}`);
        if (res.ok) { item.remove(); } else { alert('Failed to delete BOL.'); }
      });
      item.addEventListener('click', () => loadBolIntoForm(b));
      list.appendChild(item);
    }
  } catch {
    list.innerHTML = '<div class="bol-recent-empty">Failed to load</div>';
  }
}
```
REPLACE: *(empty)*

### Edit 5 — remove the init call

FIND (count == 1):
```
  loadCarriers();
  loadRecentBols();
  setupCustomerSearch();
```
REPLACE:
```
  loadCarriers();
  setupCustomerSearch();
```

### Edit 6 — remove the post-generate refresh call

FIND (count == 1):
```
        showToast(`${bolLabel} ${isEdit ? 'updated' : 'generated'}`);
        loadRecentBols();
      },
```
REPLACE:
```
        showToast(`${bolLabel} ${isEdit ? 'updated' : 'generated'}`);
      },
```

### Edit 7 — remove the post-save refresh call

FIND (count == 1):
```
    showToast(data.bol.bol_number ? `${isEdit ? 'Updated' : 'Draft saved'} — BOL #${data.bol.bol_number}` : isEdit ? 'Updated' : 'Draft saved');
    loadRecentBols();
  } catch (e) {
```
REPLACE:
```
    showToast(data.bol.bol_number ? `${isEdit ? 'Updated' : 'Draft saved'} — BOL #${data.bol.bol_number}` : isEdit ? 'Updated' : 'Draft saved');
  } catch (e) {
```

---

## Verify
- All FINDs `count == 1`. Extract the `bol-generator.html` script to a temp `.js` and `node --check`.
- `grep -c "loadRecentBols\|recent-bols-list\|bol-recent-" logistics/bol-generator.html` → **0**.
- The page loads with the form spanning full width; no empty right column; generate/save still work
  and show their toasts.
- `loadBolIntoForm` is still defined (it's used elsewhere) — only its call from the deleted list is gone.

## What NOT to change
- Do NOT touch `loadBolIntoForm`, the form, generate/save logic, or the worker.

## Deploy
```
git add logistics/bol-generator.html
git commit -m "P###: remove Recent BOLs sidebar from BOL generator; form goes full-width"
git push
```
