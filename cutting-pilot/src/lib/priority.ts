// src/lib/priority.ts
// jb-11 — one "Priority" choice mapped onto the two existing jobs columns (no schema change):
// `priority` (normal | rush) + `priority_level` (0–3). Rush stores level 3 so it sorts with
// Critical. Reading mirrors PriorityBadge (components/board/badges.tsx). Pure, no React.

export type PriorityChoice = "normal" | "elevated" | "high" | "critical" | "rush";

export const PRIORITY_CHOICES: { value: PriorityChoice; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "elevated", label: "Elevated" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
  { value: "rush", label: "Rush" },
];

export function toPriorityChoice(priority: string | null | undefined, level: number | string | null | undefined): PriorityChoice {
  if (priority === "rush") return "rush";
  const n = Number(level);
  if (level === null || level === undefined || level === "" || !Number.isFinite(n)) return "normal";
  if (n >= 3) return "critical";
  if (n === 2) return "high";
  if (n === 1) return "elevated";
  return "normal";
}

export function fromPriorityChoice(choice: PriorityChoice): { priority: "normal" | "rush"; priority_level: 0 | 1 | 2 | 3 } {
  switch (choice) {
    case "rush": return { priority: "rush", priority_level: 3 };
    case "critical": return { priority: "normal", priority_level: 3 };
    case "high": return { priority: "normal", priority_level: 2 };
    case "elevated": return { priority: "normal", priority_level: 1 };
    default: return { priority: "normal", priority_level: 0 };
  }
}
