// src/lib/permissions.ts — admin-02
// Single source of truth for role-permission keys and notification types on the v2 side. Ported 1:1 from
// legacy admin/roles.html (PERMISSION_LABELS / NOTIFICATION_TYPE_LABELS); that copy retires at the admin
// cutover. Keys are persisted in roles.permissions / roles.notification_types JSON — never rename one here
// without a data migration. Insertion order is display order within each group.

export const PERMISSION_LABELS: Record<string, { group: string; label: string }> = {
  "jobs":                           { group: "Jobs",          label: "Job Board" },
  "jobs.manage":                    { group: "Jobs",          label: "Job Board — Assign Production (manager)" },
  "jobs.create":                    { group: "Jobs",          label: "Job Board — Create jobs / upload packing slips" },
  "jobs.status":                    { group: "Jobs",          label: "Job Board — Change job status (board moves, mark shipped)" },
  "jobs.archive":                   { group: "Jobs",          label: "Job Board — Archive / delete jobs" },
  "logistics.dashboard":            { group: "Logistics",     label: "Dashboard & Shipments" },
  "logistics.bol":                  { group: "Logistics",     label: "BOL Generator" },
  "logistics.load-builder":         { group: "Logistics",     label: "Load Builder" },
  "logistics.loading":              { group: "Logistics",     label: "Loading Dashboard" },
  "logistics.loading.manage":       { group: "Logistics",     label: "Loading — Bay Management (manager)" },
  "logistics.loading.tv":           { group: "Logistics",     label: "Loading Board (TV)" },
  "logistics.carrier_view":         { group: "Logistics",     label: "Carrier 2-Day View" },
  "logistics.v2":                   { group: "Logistics",     label: "v2 Migration (dark launch — admin only)" },
  "manufacturing.calculators":      { group: "Manufacturing", label: "Calculators" },
  "manufacturing.cutting":          { group: "Manufacturing", label: "Cutting Dashboard" },
  "manufacturing.cutting.manage":   { group: "Manufacturing", label: "Cutting — Manage (assign/reorder chunk tasks)" },
  "manufacturing.cutting.override": { group: "Manufacturing", label: "Cutting — Override (kick operators)" },
  "notes":                          { group: "Shift Notes",   label: "Shift Notes (view / add)" },
  "notes.manage":                   { group: "Shift Notes",   label: "Shift Notes — Mark viewed (manager)" },
  "manufacturing.blocks":           { group: "Manufacturing", label: "Block nesting" },
  "production.log":                 { group: "Production",    label: "Production Log (Molding / Expansion)" },
  "production.manage":              { group: "Production",    label: "Production Log — Manage (add dropdown options, hide sheets)" },
  "production.tv":                  { group: "Production",    label: "Production Board (TV)" },
  "qc":                             { group: "QC",            label: "Quality Control" },
  "safety":                         { group: "Safety",        label: "Safety Portal" },
  "reports":                        { group: "Reports",       label: "Reports & Analytics" },
  "orders":                         { group: "Orders",        label: "Order Entry" },
  "schedule":                       { group: "Schedule",      label: "Schedule Board (TV)" },
  "schedule.desk":                  { group: "Schedule",      label: "Schedule Board (Desk)" },
  "admin":                          { group: "Admin",         label: "Administration" },
};

/** Group display order = order of first appearance in PERMISSION_LABELS. */
export const PERMISSION_GROUPS: readonly string[] = Array.from(
  new Set(Object.values(PERMISSION_LABELS).map((p) => p.group))
);

export const NOTIFICATION_TYPES: readonly { key: string; label: string }[] = [
  { key: "loading.assigned",    label: "Job assigned to loading" },
  { key: "loading.started",     label: "Trailer loading started" },
  { key: "loading.loaded",      label: "Trailer loaded" },
  { key: "loading.in_transit",  label: "Trailer in transit" },
  { key: "loading.delivered",   label: "Delivery confirmed" },
  { key: "carrier.fees_added",  label: "Carrier fees added" },
  { key: "qb.review",           label: "QuickBooks change to review" },
  { key: "qb.error",            label: "QuickBooks sync error" },
  { key: "loading.late_pickup", label: "Late pickup" },
  { key: "cutting.shift_risk",  label: "Cutting at risk (shift end)" },
];
