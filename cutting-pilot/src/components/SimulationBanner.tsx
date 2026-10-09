"use client";
// src/components/SimulationBanner.tsx — admin-02
// Global "Testing as" strip, rendered by the root layout only while a real administrator is simulating a
// role (X-User-Simulating-Role, set by middleware). Stop clears the session's simulating_role_id.
import { useState } from "react";

export default function SimulationBanner({ roleName }: { roleName: string }) {
  const [state, setState] = useState<"idle" | "stopping" | "error">("idle");

  async function stop() {
    setState("stopping");
    try {
      const res = await fetch("/v2/api/admin/simulate-role", { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      window.location.reload();
    } catch {
      setState("error");
    }
  }

  return (
    <div
      role="status"
      className="w-full bg-[var(--warn-bg)] border-b border-[var(--warn-border)] text-[var(--warn-text)] px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold"
    >
      <span>Testing as {roleName} — pages show what this role sees.</span>
      <span className="flex items-center gap-3">
        {state === "error" && <span>Couldn&apos;t stop — try again</span>}
        <a href="/v2/admin?tab=roles" className="underline">Roles</a>
        <button
          type="button"
          onClick={stop}
          disabled={state === "stopping"}
          className="min-h-[44px] px-3 rounded border border-[var(--warn-border)] disabled:opacity-60"
        >
          {state === "stopping" ? "Stopping…" : "Stop testing"}
        </button>
      </span>
    </div>
  );
}
