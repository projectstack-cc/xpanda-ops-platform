# Prompt 06 — Load Builder: HB Parent Group Data Migration & Seed Update

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

Prompt 05 already implemented the `parent_group` field, API handlers, state, and Load tab render logic. This prompt only populates the data.

---

## Scope

**One file to modify:**

- `_worker.js` — replace `LB_DEFAULT_SKUS` with the updated seed data below

**Do NOT modify:**
- Any logic, handlers, or render functions — those are already done
- `load-builder.html`
- Any other file

---

## Step 1 — D1 Migration

Do NOT run these. Write them here so I can run them manually in the Cloudflare Dashboard Console.

Run in this order:

```sql
-- 1. Add the column
ALTER TABLE load_builder_skus ADD COLUMN parent_group TEXT NOT NULL DEFAULT '';

-- 2. Assign parent groups to all existing HB SKUs
UPDATE load_builder_skus SET parent_group = '1in HB' WHERE sku IN ('HB-01', 'HB-01.25', 'HB-1.5', 'HB-1.75');
UPDATE load_builder_skus SET parent_group = '2in HB' WHERE sku IN ('HB-02', 'HB-02.25', 'HB-2.5', 'HB-2.75');
UPDATE load_builder_skus SET parent_group = '3in HB' WHERE sku IN ('HB-03', 'HB-03.25', 'HB-3.5', 'HB-3.75');
UPDATE load_builder_skus SET parent_group = '4in HB' WHERE sku IN ('HB-04', 'HB-04.25', 'HB-4.5', 'HB-4.75');
UPDATE load_builder_skus SET parent_group = '5in HB' WHERE sku IN ('HB-05', 'HB-05.25', 'HB-5.5', 'HB-5.75');
UPDATE load_builder_skus SET parent_group = '6in HB' WHERE sku IN ('HB-06', 'HB-06.25', 'HB-6.5', 'HB-6.75');
UPDATE load_builder_skus SET parent_group = '7in HB' WHERE sku IN ('HB-07', 'HB-07.25', 'HB-7.5', 'HB-7.75');
UPDATE load_builder_skus SET parent_group = '8in HB' WHERE sku IN ('HB-08', 'HB-08.25', 'HB-8.5', 'HB-8.75');
UPDATE load_builder_skus SET parent_group = '9in HB' WHERE sku IN ('HB-09', 'HB-09.25', 'HB-9.5', 'HB-9.75');
UPDATE load_builder_skus SET parent_group = '10in HB' WHERE sku IN ('HB-10', 'HB-10.25', 'HB-10.5', 'HB-10.75');
UPDATE load_builder_skus SET parent_group = '11in HB' WHERE sku IN ('HB-11', 'HB-11.25', 'HB-11.5', 'HB-11.75');
UPDATE load_builder_skus SET parent_group = '12in HB' WHERE sku IN ('HB-12', 'HB-12.25', 'HB-12.5', 'HB-12.75');
UPDATE load_builder_skus SET parent_group = '13in HB' WHERE sku IN ('HB-13', 'HB-13.25', 'HB-13.5', 'HB-13.75');
UPDATE load_builder_skus SET parent_group = '14in HB' WHERE sku IN ('HB-14', 'HB-14.25', 'HB-14.5', 'HB-14.75');
UPDATE load_builder_skus SET parent_group = '15in HB' WHERE sku IN ('HB-15', 'HB-15.25', 'HB-15.5', 'HB-15.75');
UPDATE load_builder_skus SET parent_group = '16in HB' WHERE sku IN ('HB-16', 'HB-16.25', 'HB-16.5', 'HB-16.75');
UPDATE load_builder_skus SET parent_group = '17in HB' WHERE sku IN ('HB-17', 'HB-17.25', 'HB-17.5', 'HB-17.75');
UPDATE load_builder_skus SET parent_group = '18in HB' WHERE sku IN ('HB-18', 'HB-18.25', 'HB-18.5', 'HB-18.75');
UPDATE load_builder_skus SET parent_group = '19in HB' WHERE sku IN ('HB-19', 'HB-19.25', 'HB-19.5', 'HB-19.75');
UPDATE load_builder_skus SET parent_group = '20in HB' WHERE sku IN ('HB-20', 'HB-20.25', 'HB-20.5', 'HB-20.75');
UPDATE load_builder_skus SET parent_group = '21in HB' WHERE sku IN ('HB-21', 'HB-21.25', 'HB-21.5', 'HB-21.75');
UPDATE load_builder_skus SET parent_group = '22in HB' WHERE sku IN ('HB-22', 'HB-22.25', 'HB-22.5', 'HB-22.75');
UPDATE load_builder_skus SET parent_group = '23in HB' WHERE sku IN ('HB-23', 'HB-23.25', 'HB-23.5', 'HB-23.75');
UPDATE load_builder_skus SET parent_group = '24in HB' WHERE sku IN ('HB-24', 'HB-24.25', 'HB-24.5', 'HB-24.75');
UPDATE load_builder_skus SET parent_group = '25in HB' WHERE sku IN ('HB-25', 'HB-25.25', 'HB-25.5', 'HB-25.75');
UPDATE load_builder_skus SET parent_group = '26in HB' WHERE sku IN ('HB-26', 'HB-26.25', 'HB-26.5', 'HB-26.75');
UPDATE load_builder_skus SET parent_group = '27in HB' WHERE sku IN ('HB-27', 'HB-27.25', 'HB-27.5', 'HB-27.75');
UPDATE load_builder_skus SET parent_group = '28in HB' WHERE sku IN ('HB-28', 'HB-28.25', 'HB-28.5', 'HB-28.75');
UPDATE load_builder_skus SET parent_group = '29in HB' WHERE sku IN ('HB-29', 'HB-29.25', 'HB-29.5', 'HB-29.75');
UPDATE load_builder_skus SET parent_group = '30in HB' WHERE sku IN ('HB-30', 'HB-30.25', 'HB-30.5', 'HB-30.75');
```

---

## Step 2 — `_worker.js`

Replace the entire `LB_DEFAULT_SKUS` array with the following:

```js
const LB_DEFAULT_SKUS = [
  { name: "1in block", sku: "HB-01", length: 48, width: 24, height: 1, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "1in HB" },
  { name: "1.25in Block", sku: "HB-01.25", length: 48, width: 24, height: 1.25, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "1in HB" },
  { name: "1.5in Block", sku: "HB-1.5", length: 48, width: 24, height: 1.5, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "1in HB" },
  { name: "1.75in Block", sku: "HB-1.75", length: 48, width: 24, height: 1.75, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "1in HB" },
  { name: "2in block", sku: "HB-02", length: 48, width: 24, height: 2, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "2in HB" },
  { name: "2.25in Block", sku: "HB-02.25", length: 48, width: 24, height: 2.25, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "2in HB" },
  { name: "2.5in Block", sku: "HB-2.5", length: 48, width: 24, height: 2.5, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "2in HB" },
  { name: "2.75in Block", sku: "HB-2.75", length: 48, width: 24, height: 2.75, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "2in HB" },
  { name: "3in block", sku: "HB-03", length: 48, width: 24, height: 3, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "3in HB" },
  { name: "3.25in Block", sku: "HB-03.25", length: 48, width: 24, height: 3.25, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "3in HB" },
  { name: "3.5in Block", sku: "HB-3.5", length: 48, width: 24, height: 3.5, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "3in HB" },
  { name: "3.75in Block", sku: "HB-3.75", length: 48, width: 24, height: 3.75, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "3in HB" },
  { name: "4in block", sku: "HB-04", length: 48, width: 24, height: 4, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "4in HB" },
  { name: "4.25in Block", sku: "HB-04.25", length: 48, width: 24, height: 4.25, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "4in HB" },
  { name: "4.5in Block", sku: "HB-4.5", length: 48, width: 24, height: 4.5, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "4in HB" },
  { name: "4.75in Block", sku: "HB-4.75", length: 48, width: 24, height: 4.75, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "4in HB" },
  { name: "5in block", sku: "HB-05", length: 48, width: 24, height: 5, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "5in HB" },
  { name: "5.25in Block", sku: "HB-05.25", length: 48, width: 24, height: 5.25, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "5in HB" },
  { name: "5.5in Block", sku: "HB-5.5", length: 48, width: 24, height: 5.5, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "5in HB" },
  { name: "5.75in Block", sku: "HB-5.75", length: 48, width: 24, height: 5.75, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "5in HB" },
  { name: "6in block", sku: "HB-06", length: 48, width: 24, height: 6, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "6in HB" },
  { name: "6.25in Block", sku: "HB-06.25", length: 48, width: 24, height: 6.25, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "6in HB" },
  { name: "6.5in Block", sku: "HB-6.5", length: 48, width: 24, height: 6.5, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "6in HB" },
  { name: "6.75in Block", sku: "HB-6.75", length: 48, width: 24, height: 6.75, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "6in HB" },
  { name: "7in block", sku: "HB-07", length: 48, width: 24, height: 7, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "7in HB" },
  { name: "7.25in Block", sku: "HB-07.25", length: 48, width: 24, height: 7.25, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "7in HB" },
  { name: "7.5in Block", sku: "HB-7.5", length: 48, width: 24, height: 7.5, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "7in HB" },
  { name: "7.75in Block", sku: "HB-7.75", length: 48, width: 24, height: 7.75, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "7in HB" },
  { name: "8in block", sku: "HB-08", length: 48, width: 24, height: 8, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "8in HB" },
  { name: "8.25in Block", sku: "HB-08.25", length: 48, width: 24, height: 8.25, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "8in HB" },
  { name: "8.5in Block", sku: "HB-8.5", length: 48, width: 24, height: 8.5, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "8in HB" },
  { name: "8.75in Block", sku: "HB-8.75", length: 48, width: 24, height: 8.75, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "8in HB" },
  { name: "9in block", sku: "HB-09", length: 48, width: 24, height: 9, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "9in HB" },
  { name: "9.25in Block", sku: "HB-09.25", length: 48, width: 24, height: 9.25, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "9in HB" },
  { name: "9.5in Block", sku: "HB-9.5", length: 48, width: 24, height: 9.5, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "9in HB" },
  { name: "9.75in Block", sku: "HB-9.75", length: 48, width: 24, height: 9.75, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "9in HB" },
  { name: "10in block", sku: "HB-10", length: 48, width: 24, height: 10, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "10in HB" },
  { name: "10.25in Block", sku: "HB-10.25", length: 48, width: 24, height: 10.25, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "10in HB" },
  { name: "10.5in Block", sku: "HB-10.5", length: 48, width: 24, height: 10.5, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "10in HB" },
  { name: "10.75in Block", sku: "HB-10.75", length: 48, width: 24, height: 10.75, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "10in HB" },
  { name: "11in block", sku: "HB-11", length: 48, width: 24, height: 11, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "11in HB" },
  { name: "11.25in Block", sku: "HB-11.25", length: 48, width: 24, height: 11.25, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "11in HB" },
  { name: "11.5in Block", sku: "HB-11.5", length: 48, width: 24, height: 11.5, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "11in HB" },
  { name: "11.75in Block", sku: "HB-11.75", length: 48, width: 24, height: 11.75, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "11in HB" },
  { name: "12in block", sku: "HB-12", length: 48, width: 24, height: 12, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "12in HB" },
  { name: "12.25in Block", sku: "HB-12.25", length: 48, width: 24, height: 12.25, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "12in HB" },
  { name: "12.5in Block", sku: "HB-12.5", length: 48, width: 24, height: 12.5, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "12in HB" },
  { name: "12.75in Block", sku: "HB-12.75", length: 48, width: 24, height: 12.75, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "12in HB" },
  { name: "13in block", sku: "HB-13", length: 48, width: 24, height: 13, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "13in HB" },
  { name: "13.25in Block", sku: "HB-13.25", length: 48, width: 24, height: 13.25, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "13in HB" },
  { name: "13.5in Block", sku: "HB-13.5", length: 48, width: 24, height: 13.5, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "13in HB" },
  { name: "13.75in Block", sku: "HB-13.75", length: 48, width: 24, height: 13.75, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "13in HB" },
  { name: "14in block", sku: "HB-14", length: 48, width: 24, height: 14, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "14in HB" },
  { name: "14.25in Block", sku: "HB-14.25", length: 48, width: 24, height: 14.25, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "14in HB" },
  { name: "14.5in Block", sku: "HB-14.5", length: 48, width: 24, height: 14.5, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "14in HB" },
  { name: "14.75in Block", sku: "HB-14.75", length: 48, width: 24, height: 14.75, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "14in HB" },
  { name: "15in block", sku: "HB-15", length: 48, width: 24, height: 15, weight: 1, notes: "", color: "#A21CAF", category: "Holey Board", parent_group: "15in HB" },
  { name: "15.25in Block", sku: "HB-15.25", length: 48, width: 24, height: 15.25, weight: 1, notes: "", color: "#A21CAF", category: "Holey Board", parent_group: "15in HB" },
  { name: "15.5in Block", sku: "HB-15.5", length: 48, width: 24, height: 15.5, weight: 1, notes: "", color: "#A21CAF", category: "Holey Board", parent_group: "15in HB" },
  { name: "15.75in Block", sku: "HB-15.75", length: 48, width: 24, height: 15.75, weight: 1, notes: "", color: "#A21CAF", category: "Holey Board", parent_group: "15in HB" },
  { name: "16in block", sku: "HB-16", length: 48, width: 24, height: 16, weight: 1, notes: "", color: "#4338CA", category: "Holey Board", parent_group: "16in HB" },
  { name: "16.25in Block", sku: "HB-16.25", length: 48, width: 24, height: 16.25, weight: 1, notes: "", color: "#4338CA", category: "Holey Board", parent_group: "16in HB" },
  { name: "16.5in Block", sku: "HB-16.5", length: 48, width: 24, height: 16.5, weight: 1, notes: "", color: "#4338CA", category: "Holey Board", parent_group: "16in HB" },
  { name: "16.75in Block", sku: "HB-16.75", length: 48, width: 24, height: 16.75, weight: 1, notes: "", color: "#4338CA", category: "Holey Board", parent_group: "16in HB" },
  { name: "17in block", sku: "HB-17", length: 48, width: 24, height: 17, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "17in HB" },
  { name: "17.25in Block", sku: "HB-17.25", length: 48, width: 24, height: 17.25, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "17in HB" },
  { name: "17.5in Block", sku: "HB-17.5", length: 48, width: 24, height: 17.5, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "17in HB" },
  { name: "17.75in Block", sku: "HB-17.75", length: 48, width: 24, height: 17.75, weight: 1, notes: "", color: "#D97706", category: "Holey Board", parent_group: "17in HB" },
  { name: "18in block", sku: "HB-18", length: 48, width: 24, height: 18, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "18in HB" },
  { name: "18.25in Block", sku: "HB-18.25", length: 48, width: 24, height: 18.25, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "18in HB" },
  { name: "18.5in Block", sku: "HB-18.5", length: 48, width: 24, height: 18.5, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "18in HB" },
  { name: "18.75in Block", sku: "HB-18.75", length: 48, width: 24, height: 18.75, weight: 1, notes: "", color: "#0F766E", category: "Holey Board", parent_group: "18in HB" },
  { name: "19in block", sku: "HB-19", length: 48, width: 24, height: 19, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "19in HB" },
  { name: "19.25in Block", sku: "HB-19.25", length: 48, width: 24, height: 19.25, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "19in HB" },
  { name: "19.5in Block", sku: "HB-19.5", length: 48, width: 24, height: 19.5, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "19in HB" },
  { name: "19.75in Block", sku: "HB-19.75", length: 48, width: 24, height: 19.75, weight: 1, notes: "", color: "#2563EB", category: "Holey Board", parent_group: "19in HB" },
  { name: "20in block", sku: "HB-20", length: 48, width: 24, height: 20, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "20in HB" },
  { name: "20.25in Block", sku: "HB-20.25", length: 48, width: 24, height: 20.25, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "20in HB" },
  { name: "20.5in Block", sku: "HB-20.5", length: 48, width: 24, height: 20.5, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "20in HB" },
  { name: "20.75in Block", sku: "HB-20.75", length: 48, width: 24, height: 20.75, weight: 1, notes: "", color: "#7C3AED", category: "Holey Board", parent_group: "20in HB" },
  { name: "21in block", sku: "HB-21", length: 48, width: 24, height: 21, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "21in HB" },
  { name: "21.25in Block", sku: "HB-21.25", length: 48, width: 24, height: 21.25, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "21in HB" },
  { name: "21.5in Block", sku: "HB-21.5", length: 48, width: 24, height: 21.5, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "21in HB" },
  { name: "21.75in Block", sku: "HB-21.75", length: 48, width: 24, height: 21.75, weight: 1, notes: "", color: "#DC2626", category: "Holey Board", parent_group: "21in HB" },
  { name: "22in block", sku: "HB-22", length: 48, width: 24, height: 22, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "22in HB" },
  { name: "22.25in Block", sku: "HB-22.25", length: 48, width: 24, height: 22.25, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "22in HB" },
  { name: "22.5in Block", sku: "HB-22.5", length: 48, width: 24, height: 22.5, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "22in HB" },
  { name: "22.75in Block", sku: "HB-22.75", length: 48, width: 24, height: 22.75, weight: 1, notes: "", color: "#059669", category: "Holey Board", parent_group: "22in HB" },
  { name: "23in block", sku: "HB-23", length: 48, width: 24, height: 23, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "23in HB" },
  { name: "23.25in Block", sku: "HB-23.25", length: 48, width: 24, height: 23.25, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "23in HB" },
  { name: "23.5in Block", sku: "HB-23.5", length: 48, width: 24, height: 23.5, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "23in HB" },
  { name: "23.75in Block", sku: "HB-23.75", length: 48, width: 24, height: 23.75, weight: 1, notes: "", color: "#9333EA", category: "Holey Board", parent_group: "23in HB" },
  { name: "24in block", sku: "HB-24", length: 48, width: 24, height: 24, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "24in HB" },
  { name: "24.25in Block", sku: "HB-24.25", length: 48, width: 24, height: 24.25, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "24in HB" },
  { name: "24.5in Block", sku: "HB-24.5", length: 48, width: 24, height: 24.5, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "24in HB" },
  { name: "24.75in Block", sku: "HB-24.75", length: 48, width: 24, height: 24.75, weight: 1, notes: "", color: "#0891B2", category: "Holey Board", parent_group: "24in HB" },
  { name: "25in block", sku: "HB-25", length: 48, width: 24, height: 25, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "25in HB" },
  { name: "25.25in Block", sku: "HB-25.25", length: 48, width: 24, height: 25.25, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "25in HB" },
  { name: "25.5in Block", sku: "HB-25.5", length: 48, width: 24, height: 25.5, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "25in HB" },
  { name: "25.75in Block", sku: "HB-25.75", length: 48, width: 24, height: 25.75, weight: 1, notes: "", color: "#CA8A04", category: "Holey Board", parent_group: "25in HB" },
  { name: "26in block", sku: "HB-26", length: 48, width: 24, height: 26, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "26in HB" },
  { name: "26.25in Block", sku: "HB-26.25", length: 48, width: 24, height: 26.25, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "26in HB" },
  { name: "26.5in Block", sku: "HB-26.5", length: 48, width: 24, height: 26.5, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "26in HB" },
  { name: "26.75in Block", sku: "HB-26.75", length: 48, width: 24, height: 26.75, weight: 1, notes: "", color: "#4F46E5", category: "Holey Board", parent_group: "26in HB" },
  { name: "27in block", sku: "HB-27", length: 48, width: 24, height: 27, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "27in HB" },
  { name: "27.25in Block", sku: "HB-27.25", length: 48, width: 24, height: 27.25, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "27in HB" },
  { name: "27.5in Block", sku: "HB-27.5", length: 48, width: 24, height: 27.5, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "27in HB" },
  { name: "27.75in Block", sku: "HB-27.75", length: 48, width: 24, height: 27.75, weight: 1, notes: "", color: "#EA580C", category: "Holey Board", parent_group: "27in HB" },
  { name: "28in block", sku: "HB-28", length: 48, width: 24, height: 28, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "28in HB" },
  { name: "28.25in Block", sku: "HB-28.25", length: 48, width: 24, height: 28.25, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "28in HB" },
  { name: "28.5in Block", sku: "HB-28.5", length: 48, width: 24, height: 28.5, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "28in HB" },
  { name: "28.75in Block", sku: "HB-28.75", length: 48, width: 24, height: 28.75, weight: 1, notes: "", color: "#16A34A", category: "Holey Board", parent_group: "28in HB" },
  { name: "29in block", sku: "HB-29", length: 48, width: 24, height: 29, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "29in HB" },
  { name: "29.25in Block", sku: "HB-29.25", length: 48, width: 24, height: 29.25, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "29in HB" },
  { name: "29.5in Block", sku: "HB-29.5", length: 48, width: 24, height: 29.5, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "29in HB" },
  { name: "29.75in Block", sku: "HB-29.75", length: 48, width: 24, height: 29.75, weight: 1, notes: "", color: "#0284C7", category: "Holey Board", parent_group: "29in HB" },
  { name: "30in block", sku: "HB-30", length: 48, width: 24, height: 30, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "30in HB" },
  { name: "30.25in Block", sku: "HB-30.25", length: 48, width: 24, height: 30.25, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "30in HB" },
  { name: "30.5in Block", sku: "HB-30.5", length: 48, width: 24, height: 30.5, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "30in HB" },
  { name: "30.75in Block", sku: "HB-30.75", length: 48, width: 24, height: 30.75, weight: 1, notes: "", color: "#BE123C", category: "Holey Board", parent_group: "30in HB" },
];
```

---

## Completion

Notify me when done and remind me to run the migration in the Cloudflare Dashboard Console before testing.
