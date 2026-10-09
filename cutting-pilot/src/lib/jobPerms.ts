// admin-07 — granular Job Board edit rights for v2 routes. Mirrors legacy canJobAction() in
// _worker.js/routes/jobs.js: middleware-set X-User-Is-Admin / X-User-Permissions; admins always pass.
import type { NextRequest } from "next/server";
export type JobActionKey = "jobs.create" | "jobs.status" | "jobs.archive";
export function canJobAction(request: NextRequest, key: JobActionKey): boolean {
  if (request.headers.get("X-User-Is-Admin") === "1") return true;
  try { return JSON.parse(request.headers.get("X-User-Permissions") || "{}")?.[key]?.edit === true; }
  catch { return false; }
}
