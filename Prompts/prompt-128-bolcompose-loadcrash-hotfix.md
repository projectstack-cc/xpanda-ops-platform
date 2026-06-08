# Prompt 128 — Hotfix: BolCompose crashes at load (breaks load builder SKUs/calculate)

Read `AGENTS.md` + `xpanda-ops-agents.md`; **logistics-agent**. Edits **only** `/logistics/bol-compose.js`. No migration.

## Bug
`bol-compose.js` is loaded in `<head>`. P126's IIFE calls `injectReviewModal()` at eval time, which runs `document.body.appendChild(...)` — but `document.body` is null during head-eval, so the IIFE throws and `window.BolCompose` is never assigned. `BolCompose` is then undefined, so every `render()` in `load-builder.html` (which ends with `BolCompose.render()`) throws — poisoning the render pipeline so SKUs don't populate and Calculate Load can't show results. Fix: inject the review modal lazily (when the modal is actually used) instead of at load. Also fix a dangling `closeBolReviewLB` reference (P126 rename miss).

## Edits to `/logistics/bol-compose.js`

### 1 — stop injecting at eval time
FIND:
```javascript
  }
  injectReviewModal();

  // ── Modal state (owned by this module; was load-builder's state.bolModal) ──
```
REPLACE:
```javascript
  }

  // ── Modal state (owned by this module; was load-builder's state.bolModal) ──
```

### 2 — inject lazily when the authoring modal opens
FIND:
```javascript
  function open(opts) {
    OPTS = opts;
```
REPLACE:
```javascript
  function open(opts) {
    injectReviewModal();
    OPTS = opts;
```
(The bol-generator path already injects lazily inside `rrShow()`, so no change needed there.)

### 3 — fix undefined `closeBolReviewLB` reference (LB review modal Close button)
FIND:
```javascript
      newClose.addEventListener('click', closeBolReviewLB);
```
REPLACE:
```javascript
      newClose.addEventListener('click', closeReview);
```

## Verify
- `node --check logistics/bol-compose.js` passes; `closeBolReviewLB` no longer appears anywhere in the file.
- Load builder: page loads, SKUs populate, add SKUs, **Calculate Load** shows results (this is the regression — confirm it's gone).
- BOL generate from load builder: modal opens, GENERATE → review modal appears, **Close** button works, Approve & Save works.
- bol-generator: Generate → review → Approve still works.

## Deploy
```
git add logistics/bol-compose.js
git commit -m "P128: hotfix — inject BOL review modal lazily (was crashing IIFE at head-eval via document.body, leaving BolCompose undefined and breaking load-builder render); fix dangling closeBolReviewLB ref"
git push
```
