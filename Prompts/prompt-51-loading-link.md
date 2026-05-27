# Prompt 51 — Add Loading Dashboard Link to Logistics Dashboard

In `logistics/index.html`, find the outbound toolbar buttons (around line 58–62):

```html
<a class="logistics-btn logistics-btn-outline" href="/logistics/load-builder.html" style="text-decoration:none;">Load Builder</a>
<a class="logistics-btn logistics-btn-outline" href="/logistics/bol-generator.html" style="text-decoration:none;">BOL Generator</a>
```

Add after them:

```html
<a class="logistics-btn logistics-btn-outline" href="/logistics/loading.html" style="text-decoration:none;">Loading Dashboard</a>
```

No other changes.
