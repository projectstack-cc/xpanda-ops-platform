# Prompt 01 — BOL Generator: Remove Dimensions from Commodity Output

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

Remove the `dimensions` field from the auto-populated commodity string in the BOL generator.

---

## Scope

**One edit only:**

`/logistics/bol-generator.html`

Do NOT modify any other file.

---

## Change

In the `prefillFromJob` function, locate the block that builds commodity lines from job line items:

```js
const lines = job.line_items.map(li => {
  const parts = [
    li.quantity    ? li.quantity + ' ×' : '',
    li.part_number || '',
    li.description || '',
    li.dimensions  ? '(' + li.dimensions + ')' : '',
  ].filter(Boolean);
  return parts.join(' ');
});
```

Remove the `li.dimensions` line entirely so the result is:

```js
const lines = job.line_items.map(li => {
  const parts = [
    li.quantity    ? li.quantity + ' ×' : '',
    li.part_number || '',
    li.description || '',
  ].filter(Boolean);
  return parts.join(' ');
});
```

That is the only change. Do not modify anything else in this file.

---

## Completion

Notify me when done. No migration required.
