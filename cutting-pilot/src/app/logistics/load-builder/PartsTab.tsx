"use client";
// src/app/logistics/load-builder/PartsTab.tsx
// lbr-05: the Parts tab — the shared admin-06 parts library rendered inline (layout "page"), the same
// component /v2/admin's Parts tab uses. Replaces the toolbar's "Parts library" modal button
// (PartsLibraryPanel.tsx, deleted). Like the modal it replaces, editing the library doesn't touch the
// current plan: a pulled load's SKUs are frozen at pull time (savedLoad.ts header), so a re-pull is
// what picks up changed parts — exactly the behaviour the modal path had.
import PartsLibrary from "@/components/parts/PartsLibrary";

export default function PartsTab({ active }: { active: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-surface p-4 overflow-x-auto">
      <PartsLibrary active={active} layout="page" />
    </div>
  );
}
