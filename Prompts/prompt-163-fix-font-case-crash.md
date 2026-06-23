# FIX — Cursive font path case mismatch crashes all BOL rendering

> Assign a number before committing. Urgent: bol-test and all BOL generation are broken. Reflects
> current HEAD of `logistics/bol-shared.js`.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent** —
`logistics/bol-shared.js` only. No migration, no worker.

## Root cause
The font committed to the repo is **`logistics/assets/FRSCRIPT.TTF`** (uppercase extension), but
`bol-shared.js` fetches **`/logistics/assets/FRSCRIPT.ttf`** (lowercase). Cloudflare Pages serves
paths **case-sensitively**, so the lowercase URL misses and Pages returns the **HTML app-shell with
HTTP 200**. Because the old code only checked `_ffResp.ok`, it treated that HTML as font bytes and
called `embedFont(<html>)`, which **throws** — and since that runs for every record, it crashes
*all* BOL rendering (bol-test, generator, load-builder, track), not just the signature.

## Fix
Match the real filename case **and** stop trusting an `ok` response that isn't actually a font, so a
future path/deploy slip degrades to "no signature" instead of crashing the BOL.

### Edit 1 — `bol-shared.js`: correct the path + validate the bytes

FIND (count == 1):
```
    // Cursive font for the shipper signature, embedded via fontkit. Fetched once; null-safe.
    let scriptFontBytes = null;
    try {
      const _ffResp = await fetch('/logistics/assets/FRSCRIPT.ttf');
      if (_ffResp.ok) scriptFontBytes = await _ffResp.arrayBuffer();
    } catch (_e) { scriptFontBytes = null; }
```
REPLACE:
```
    // Cursive font for the shipper signature, embedded via fontkit. Fetched once; null-safe.
    // Path is CASE-SENSITIVE on Cloudflare Pages — the asset is FRSCRIPT.TTF (uppercase). A wrong
    // path returns the HTML app-shell at HTTP 200, so an "ok" response is NOT enough: require a real
    // font signature before trusting the bytes, or embedFont() would crash every BOL.
    let scriptFontBytes = null;
    try {
      const _ffResp = await fetch('/logistics/assets/FRSCRIPT.TTF');
      const _ct = (_ffResp.headers.get('content-type') || '').toLowerCase();
      if (_ffResp.ok && _ct.indexOf('text/html') === -1) {
        const _buf = await _ffResp.arrayBuffer();
        const _b = new Uint8Array(_buf.slice(0, 4));
        const _tag = String.fromCharCode(_b[0], _b[1], _b[2], _b[3]);
        const _isFont = (_b[0] === 0x00 && _b[1] === 0x01 && _b[2] === 0x00 && _b[3] === 0x00) // TrueType
          || _tag === 'OTTO' || _tag === 'true' || _tag === 'ttcf' || _tag === 'wOFF' || _tag === 'wOF2';
        if (_isFont) scriptFontBytes = _buf;
      }
    } catch (_e) { scriptFontBytes = null; }
```

### Edit 2 — `bol-shared.js`: never let font embedding crash a BOL

FIND (count == 1):
```
      let cursive = null;
      if (scriptFontBytes && window.fontkit) {
        templateDoc.registerFontkit(window.fontkit);
        cursive = await templateDoc.embedFont(scriptFontBytes);
      }
```
REPLACE:
```
      let cursive = null;
      if (scriptFontBytes && window.fontkit) {
        try {
          templateDoc.registerFontkit(window.fontkit);
          cursive = await templateDoc.embedFont(scriptFontBytes);
        } catch (_fe) { cursive = null; }
      }
```

---

## Verify
- Both FINDs `count == 1`. `node --check logistics/bol-shared.js`.
- `/logistics/assets/FRSCRIPT.TTF` returns the font (font/sfnt or application/octet-stream,
  ~58 KB) — **not** `text/html`.
- bol-test renders again in all copyType modes; generator / load-builder / track render.
- A BOL with `shipper_name` set shows the name in **cursive**; with the font missing or unreadable,
  the BOL still renders — just without the signature (no crash).

## Note (alternative, not required)
You could instead rename the asset to lowercase `frscript.ttf` and leave the path — but matching the
committed `FRSCRIPT.TTF` plus the byte-guard above is the robust fix; the guard is what prevents this
whole class of "missing asset → HTML 200 → embed crash" failure going forward.

## What NOT to change
- Do NOT touch the QR logic, field draws, templates, the worker, or `STORAGE_KEY`.

## Deploy
```
git add logistics/bol-shared.js
git commit -m "P###: fix cursive font path case (FRSCRIPT.TTF) + guard non-font bytes so a missing asset can't crash BOL rendering"
git push
```
