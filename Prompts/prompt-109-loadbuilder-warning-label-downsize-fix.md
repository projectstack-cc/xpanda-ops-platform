# P109 — Load Builder: false skip-warning, orientation labels, and box-truck auto-downsize

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **logistics-agent**. `logistics/load-builder.html` only. No DB, no migration.

⚠️ **This file contains the battle-tested auto-pack algorithm. Do NOT touch the packing math.** All three edits below are display/decision logic that sits *outside* `buildDemand`'s orientation scoring, `buildRow`, the packing passes, and the box-truck repack's `calcLoading` call. Apply the three edits as exact full-block find/replace. Do not refactor anything else.

Root context: parts like a 3×48×144 foam sheet fit fine when rotated (144″ along the trailer length, lying flat). `buildDemand` already rotates and places them correctly. The bugs are three checks that ignore that rotation or were scoped too narrowly.

---

## Edit 1 — Stop the false "exceeds dimensions / will be skipped" warning

The warning re-tests the SKU's raw stored dimensions, ignoring rotation, so it fires even when the part was rotated and loaded. `demand` (from `buildDemand`, built just above this loop) already contains exactly the parts that *could* be placed in some orientation. Warn only when the part is absent from `demand`.

**Find:**
```js
    } else if (sku.length > dims.length || sku.width > dims.width || sku.height > dims.height) {
      warnings.push(`"${sku.name}" exceeds trailer dimensions and will be skipped.`);
    }
```
**Replace with:**
```js
    } else if (!demand.some(d => d.skuId === sku.id)) {
      warnings.push(`"${sku.name}" exceeds trailer dimensions and will be skipped.`);
    }
```
(Leave the preceding `if (sku.length <= 0 ...) invalid dimensions` branch untouched. This also stays correct for Holey Board, which `buildDemand` omits from `demand` when it can't fit without rotation.)

---

## Edit 2 — Make the orientation label physically accurate

The label currently comes from the permutation index, so a sheet that ends up lying flat gets tagged "(stood up rotated)". Derive the label from the *result* — which original dimension ended up vertical — and only label non-flat orientations. This changes ONLY the displayed label, not which orientation is chosen.

**Find:**
```js
    const effectiveSku = { ...sku, length: bestOrientation.length, width: bestOrientation.width, height: bestOrientation.height };
    if (bestOrientation.label) effectiveSku.name = sku.name + bestOrientation.label;
```
**Replace with:**
```js
    const effectiveSku = { ...sku, length: bestOrientation.length, width: bestOrientation.width, height: bestOrientation.height };
    // Physically-accurate orientation label (derived from result, not permutation index).
    const sortedDims = [sku.length, sku.width, sku.height].sort((a, b) => a - b); // [min, mid, max]
    let physLabel = '';
    if (bestOrientation.height === sortedDims[2]) physLabel = ' (on end)';        // tallest dimension vertical = standing up
    else if (bestOrientation.height === sortedDims[1]) physLabel = ' (on side)';  // middle dimension vertical
    // smallest dimension vertical = lying flat → no label
    if (physLabel) effectiveSku.name = sku.name + physLabel;
```
**Do NOT change** the `orientations` array (its dimension assignments OR its existing `label` fields — they can stay unused), the scoring loop, or `bestOrientation` selection.

---

## Edit 3 — Let auto-downsize fire for single-trailer loads, rotation-aware

Two changes in the downsize block.

**3a.** Allow downsizing when there is one trailer (the common small-load case), not only multi-trailer overflow.
**Find:**
```js
    if (trailers.length > 1 && dims.length > boxTruckDims.length) {
```
**Replace with:**
```js
    if (trailers.length >= 1 && dims.length > boxTruckDims.length) {
```

**3b.** Make the `allSkusFit` pre-check rotation-aware (sorted-dimension comparison) instead of raw stored dims.
**Find:**
```js
      const allSkusFit = lastTrailerPieces.every(p => {
        const sku = skus.find(s => s.id === p.skuId);
        return sku && sku.width <= boxTruckDims.width && sku.length <= boxTruckDims.length && sku.height <= boxTruckDims.height;
      });
```
**Replace with:**
```js
      const allSkusFit = lastTrailerPieces.every(p => {
        const sku = skus.find(s => s.id === p.skuId);
        if (!sku) return false;
        const a = [sku.length, sku.width, sku.height].sort((x, y) => x - y);
        const b = [boxTruckDims.length, boxTruckDims.width, boxTruckDims.height].sort((x, y) => x - y);
        return a[0] <= b[0] && a[1] <= b[1] && a[2] <= b[2];
      });
```
The existing `if (boxResult && boxResult.trailers.length === 1)` gate remains the real safety check — a load that doesn't actually fit one box truck still won't be downsized. Leave that gate and the `calcLoading(tempCart, skus, boxTruckDims, ...)` repack call exactly as-is.

---

## Verify
Reload the screenshot's job (`?job_id=329c4cdb-...`): the false "exceeds / will be skipped" warnings are gone, the packing list no longer says "(stood up rotated)" for the flat sheets, and the single-trailer load now downsizes to a 26ft Box Truck. Then sanity-check a known large multi-trailer load still packs identically and a load that genuinely needs a 53ft does NOT get downsized.

## What NOT to change
`buildDemand`'s `orientations` array and scoring loop; `buildRow`; the packing passes; the box repack's `calcLoading` call and its `=== 1` gate; `STORAGE_KEY` (`foam_trailer_loader_v31`); trailer/box dimensions in `TRAILER_TYPES`; anything outside these three blocks.
