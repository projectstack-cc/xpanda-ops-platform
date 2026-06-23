// src/app/cutting/page.tsx
// Served at /v2/cutting (basePath = /v2). Done-bar proof: this page only renders if the
// shared session validated in middleware. It reads identity from the injected headers —
// proving the auth bridge end to end before any real cutting UI is built.
import { headers } from "next/headers";

export default async function CuttingPage() {
  const h = await headers();
  const name = h.get("X-User-Name") ?? "unknown";
  const role = h.get("X-User-Role") ?? "unknown";

  return (
    <main className="min-h-screen bg-bg p-6 font-sans text-text">
      <h1 className="text-xl font-bold">Cutting Dashboard — v2 pilot</h1>
      <p className="mt-2 text-muted">
        Auth bridge live. Signed in as <strong>{name}</strong> ({role}) via the shared
        xpanda_session — validated against the same D1 as the legacy app.
      </p>
      <p className="mt-4 text-text-hint">
        Next: the clock-into-able queue (GET /api/v2/cutting/queue).
      </p>
    </main>
  );
}
