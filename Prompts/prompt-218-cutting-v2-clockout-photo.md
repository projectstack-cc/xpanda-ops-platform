# Prompt 218 — Cutting v2: clock-out cut-list photo (optional capture → R2 → job-card viewer)

> Applies on top of 214/216/217. Anchors sit on lines those leave intact. **Run the migration in D1
> before deploying the worker.**

## Agents
**Lead: React Component Agent (§9b)** — capture field, job-card badge, viewer.
**Next/Cloudflare Platform Agent (§9a)** — migration, upload + serve routes (R2), queue payload.

## Required reading (both)
- `AGENTS.md`; `xpanda-ops-agents.md` §9a/§9b; `agent-react-component.md`.
- Constraints: migration surface only; tokens-only; no hardcoded hex; build-must-be-green; operator
  identity from middleware `X-User-*` headers, never the client body; shared R2 bucket `BOL_PHOTOS`.

## Context
A cut-list photo is captured **at clock-out** as a proof-of-completion (supervisor request).
**Optional — it must never block clock-out.** Stored in the shared R2 bucket (`BOL_PHOTOS`, binding
already wired in `src/lib/db.ts` and `wrangler.toml`) under `cutting-photos/<session_id>/<uuid>.<ext>`;
the object key is recorded on the session (`cutting_sessions.photo_key`). Viewable **from the job
card** in the queue list (a camera badge → a viewer showing the latest cut-list photo per line).

## Scope decisions (LOCKED)
- **Optional.** Photo upload is best-effort: attempted before the existing clock-out call; on failure,
  toast and proceed with clock-out anyway. The clock-out route is **unchanged**.
- **Storage:** R2 `BOL_PHOTOS`, key `cutting-photos/<session_id>/<uuid>.<ext>`; `photo_key` on the
  session. New migration (manual D1).
- **Viewer on the job card:** queue payload surfaces, per job, the latest closed session per line that
  has a photo. A camera badge with count sits on the card (DOM sibling of the select button — no
  nested buttons); tapping opens a `<PhotoViewer>` (composes the existing `<Modal>`) that streams each
  photo from an authed serve route.
- No change to clock-in/clock-out/complete routes or middleware.

## Scope (files)
- **NEW:** `DB_Migrations/add-cutting-session-photo.sql`
- **NEW:** `cutting-pilot/src/app/api/cutting/clock-out-photo/route.ts`
- **NEW:** `cutting-pilot/src/app/api/cutting/photo/[sessionId]/route.ts`
- **NEW:** `cutting-pilot/src/app/cutting/PhotoViewer.tsx`
- **EDIT:** `cutting-pilot/src/app/api/cutting/queue/route.ts`
- **EDIT:** `cutting-pilot/src/app/cutting/types.ts`
- **EDIT:** `cutting-pilot/src/app/cutting/HandoffModal.tsx`
- **EDIT:** `cutting-pilot/src/app/cutting/JobRow.tsx`
- **EDIT:** `cutting-pilot/src/app/cutting/CuttingBoard.tsx`

---

## Task 1 — NEW `DB_Migrations/add-cutting-session-photo.sql`
```sql
-- add-cutting-session-photo.sql
-- Optional cut-list photo captured at clock-out; stored in R2, key recorded here.
-- MANUAL STEP: run in the Cloudflare D1 Dashboard Console before deploying the worker.
ALTER TABLE cutting_sessions ADD COLUMN photo_key TEXT DEFAULT NULL;
```

## Task 2 — NEW `src/app/api/cutting/clock-out-photo/route.ts`
```ts
// POST /v2/api/cutting/clock-out-photo  — store a cut-list photo for an open session in R2.
// Optional, best-effort. Operator (from session headers) must own the session.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export async function POST(request: NextRequest) {
  const { DB, BOL_PHOTOS } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    const isAdmin = request.headers.get("X-User-Is-Admin") === "1";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const form = await request.formData();
    const sessionId = String(form.get("session_id") || "");
    const file = form.get("file");
    if (!sessionId || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "session_id and file are required." },
        { status: 400 }
      );
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "File must be an image." }, { status: 400 });
    }

    const session = await DB.prepare(
      `SELECT id, operator_id, status FROM cutting_sessions WHERE id = ? LIMIT 1`
    ).bind(sessionId).first<{ id: string; operator_id: string; status: string }>();

    if (!session) {
      return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });
    }
    if (session.operator_id !== operatorId && !isAdmin) {
      return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
    }

    const ext = EXT[file.type] || "jpg";
    const key = `cutting-photos/${sessionId}/${crypto.randomUUID()}.${ext}`;
    const bytes = await file.arrayBuffer();

    await BOL_PHOTOS.put(key, bytes, { httpMetadata: { contentType: file.type } });

    await DB.prepare(`UPDATE cutting_sessions SET photo_key = ? WHERE id = ?`)
      .bind(key, sessionId)
      .run();

    return NextResponse.json({ ok: true, photo_key: key });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
```

## Task 3 — NEW `src/app/api/cutting/photo/[sessionId]/route.ts`
> Next 14 → `params` is a plain object (NOT a Promise).
```ts
// GET /v2/api/cutting/photo/[sessionId]  — stream the session's cut-list photo from R2.
// Gated by middleware (manufacturing.cutting). 404 when the session has no photo.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const { DB, BOL_PHOTOS } = await getEnv();
  try {
    const { sessionId } = params;
    const row = await DB.prepare(
      `SELECT photo_key FROM cutting_sessions WHERE id = ? LIMIT 1`
    ).bind(sessionId).first<{ photo_key: string | null }>();

    if (!row?.photo_key) {
      return NextResponse.json({ ok: false, error: "No photo." }, { status: 404 });
    }

    const object = await BOL_PHOTOS.get(row.photo_key);
    if (!object) {
      return NextResponse.json({ ok: false, error: "Photo missing." }, { status: 404 });
    }

    const contentType = object.httpMetadata?.contentType || "image/jpeg";
    return new Response(object.body as any, {
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
```

## Task 4 — NEW `src/app/cutting/PhotoViewer.tsx`
```tsx
"use client";
import Modal from "@/components/Modal";
import type { CuttingJob } from "./types";

interface Props {
  job: CuttingJob | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PhotoViewer({ job, isOpen, onClose }: Props) {
  const photos = job?.photos ?? [];
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={job ? `Cut-list photos — ${job.customer}` : "Cut-list photos"}
    >
      {photos.length === 0 ? (
        <p className="text-sm text-muted">No cut-list photos for this job yet.</p>
      ) : (
        <div className="space-y-4">
          {photos.map((p) => (
            <figure key={p.session_id} className="space-y-1">
              <figcaption className="text-xs font-semibold text-muted">{p.line}</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/v2/api/cutting/photo/${p.session_id}`}
                alt={`Cut list — ${p.line}`}
                className="w-full rounded border border-border"
                loading="lazy"
              />
            </figure>
          ))}
        </div>
      )}
    </Modal>
  );
}
```

## Task 5 — `queue/route.ts` (§9a)

5a. Carry the session id + photo key on the latest-closed-session query. Anchor (exact, once):
```ts
      `SELECT cs.job_id, cs.line, cs.handoff_note
```
Replace with:
```ts
      `SELECT cs.id, cs.job_id, cs.line, cs.handoff_note, cs.photo_key
```

5b. Build per-job photos and attach them to each job (rides the `{ ...job }` spread). Anchor
(exact, once):
```ts
    const handoffByKey = new Map<string, string>();
    for (const row of (lastHandoffRows.results || [])) {
      handoffByKey.set(`${row.job_id}:${row.line}`, row.handoff_note || "");
    }
```
Insert IMMEDIATELY AFTER it:
```ts

    // Cut-list photos: latest closed session per line that carries a photo, grouped per job.
    // Assigned onto each job object so the existing `{ ...job, ... }` return spreads it through.
    const photosByJob = new Map<string, { session_id: string; line: string }[]>();
    for (const row of (lastHandoffRows.results || [])) {
      if (!row.photo_key) continue;
      if (!photosByJob.has(row.job_id)) photosByJob.set(row.job_id, []);
      photosByJob.get(row.job_id)!.push({ session_id: row.id, line: row.line });
    }
    for (const job of jobs) {
      (job as any).photos = photosByJob.get(job.id) || [];
    }
```

## Task 6 — `types.ts`
Anchor (exact, once):
```ts
  lines: CuttingLine[];
```
Replace with:
```ts
  lines: CuttingLine[];
  photos: { session_id: string; line: string }[];
```

## Task 7 — `HandoffModal.tsx` (capture field)

7a. Prop signature. Anchor (exact, once):
```ts
  onSubmit: (note: string, qty?: number) => void;
```
Replace with:
```ts
  onSubmit: (note: string, qty?: number, photo?: File | null) => void;
```

7b. Photo state + reset. Anchor (exact, once):
```ts
  const [qty, setQty] = useState("");

  useEffect(() => {
    if (isOpen) {
      setNote("");
      setQty("");
    }
  }, [isOpen]);
```
Replace with:
```ts
  const [qty, setQty] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  useEffect(() => {
    if (isOpen) {
      setNote("");
      setQty("");
      setPhoto(null);
    }
  }, [isOpen]);
```

7c. Pass the photo on submit. Anchor (exact, once):
```ts
    onSubmit(note, !isNaN(qtyNum) && qtyNum > 0 ? qtyNum : undefined);
```
Replace with:
```ts
    onSubmit(note, !isNaN(qtyNum) && qtyNum > 0 ? qtyNum : undefined, photo);
```

7d. Capture input in the form. Anchor (exact, once — the qty field's closing, just before the
buttons):
```tsx
            className="w-28 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div className="flex gap-3 pt-1">
```
Replace with:
```tsx
            className="w-28 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Cut-list photo
            <span className="ml-1 text-xs text-muted font-normal">(optional)</span>
          </label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted file:mr-3 file:py-2 file:px-3 file:rounded file:border file:border-border file:bg-[var(--ghost-bg)] file:text-text file:text-sm file:font-semibold file:cursor-pointer"
          />
          {photo && (
            <p className="mt-1 text-xs text-muted truncate">Selected: {photo.name}</p>
          )}
        </div>
        <div className="flex gap-3 pt-1">
```

## Task 8 — `JobRow.tsx` (camera badge, DOM sibling of the select button)

8a. Icon import. Anchor (exact, once):
```ts
import { MessageSquare } from "lucide-react";
```
Replace with:
```ts
import { MessageSquare, Camera } from "lucide-react";
```

8b. Prop. Anchor (exact, once):
```ts
  onClick: () => void;
```
Replace with:
```ts
  onClick: () => void;
  onViewPhotos: () => void;
```

8c. Destructure. Anchor (exact, once):
```ts
export default function JobRow({ job, isActive, onClick }: Props) {
```
Replace with:
```ts
export default function JobRow({ job, isActive, onClick, onViewPhotos }: Props) {
```

8d. Wrap the select button so a real photo button can sit beside it (no nested buttons).
Anchor (exact, once):
```tsx
  return (
    <button
```
Replace with:
```tsx
  return (
    <div className="relative">
    <button
```

8e. Close the wrapper + add the camera badge. Anchor (exact, once):
```tsx
    </button>
  );
}
```
Replace with:
```tsx
    </button>
      {job.photos.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewPhotos();
          }}
          aria-label={`View cut-list photos (${job.photos.length})`}
          className="absolute bottom-2 right-2 z-10 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-surface text-muted text-xs font-mono tabular-nums cursor-pointer hover:text-text hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Camera size={13} aria-hidden="true" />
          {job.photos.length}
        </button>
      )}
    </div>
  );
}
```

## Task 9 — `CuttingBoard.tsx`

9a. Import the viewer. Anchor (exact, once):
```ts
import HandoffModal from "./HandoffModal";
```
Insert AFTER it:
```ts
import PhotoViewer from "./PhotoViewer";
```

9b. State. Anchor (exact, once):
```ts
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
```
Insert AFTER it:
```ts
  const [photosJob, setPhotosJob] = useState<CuttingJob | null>(null);
```

9c. Upload the photo before clock-out (best-effort). Anchor (exact, once):
```ts
  async function submitClockOut(note: string, qty?: number) {
    if (!clockOutTarget) return;
    setActing(true);
    try {
      const body: Record<string, unknown> = {
```
Replace with:
```ts
  async function submitClockOut(note: string, qty?: number, photo?: File | null) {
    if (!clockOutTarget) return;
    setActing(true);
    try {
      // Optional cut-list photo — best-effort, never blocks clock-out.
      if (photo) {
        try {
          const fd = new FormData();
          fd.append("session_id", clockOutTarget.sessionId);
          fd.append("file", photo);
          const pRes = await fetch("/v2/api/cutting/clock-out-photo", {
            method: "POST",
            body: fd,
          });
          if (!pRes.ok) showToast("Photo upload failed — clocking out anyway.", false);
        } catch {
          showToast("Photo upload failed — clocking out anyway.", false);
        }
      }

      const body: Record<string, unknown> = {
```

9d. Pass `onViewPhotos` to `JobRow`. Anchor (exact, once):
```tsx
              isActive={job.id === selectedJobId}
```
Replace with:
```tsx
              isActive={job.id === selectedJobId}
              onViewPhotos={() => setPhotosJob(job)}
```

9e. Render the viewer. Anchor (exact, once):
```tsx
      {/* Clock-out handoff modal */}
```
Insert IMMEDIATELY BEFORE it:
```tsx
      {/* Cut-list photo viewer (opened from a job card) */}
      <PhotoViewer
        job={photosJob}
        isOpen={!!photosJob}
        onClose={() => setPhotosJob(null)}
      />

```

---

## Build verification (MANDATORY — loop until green)
```
cd cutting-pilot
npx tsc --noEmit
npx opennextjs-cloudflare build
```
Both must pass. `capture="environment"` is valid in React 18 input types. The raw `<img>` carries an
eslint-disable; Next's `no-img-element` is a warning, not a build error. Do not hand back a
non-building tree.

> **Verification gate needs the deployed Worker** (R2 put/get + middleware-injected `X-User-*` +
> camera capture only exercise on the real host). Local build green is the bar for handing back; the
> live clock-in → photo → clock-out → view-on-card walk is Steve's on-host check.

## Manual step
Run `DB_Migrations/add-cutting-session-photo.sql` in the Cloudflare D1 Console **before** deploying
the worker (the upload route writes `photo_key`).

## BACKLOG.md / CHANGELOG.md (same commit)

**CHANGELOG.md** — top of **Manufacturing / Cutting (React pilot)**:
> - **P218** — Cutting v2 clock-out cut-list photo (optional, never blocks clock-out): capture field
>   in the handoff modal (`capture="environment"`), best-effort upload to R2 (`BOL_PHOTOS`,
>   `cutting-photos/<session>/…`) via new `POST /v2/api/cutting/clock-out-photo` before the existing
>   clock-out call; `cutting_sessions.photo_key` column (migration `add-cutting-session-photo.sql`).
>   Authed serve route `GET /v2/api/cutting/photo/[sessionId]` streams from R2. Queue payload surfaces
>   the latest photo per line per job; a camera badge on the job card opens a `<PhotoViewer>` (composes
>   `<Modal>`). `tsc --noEmit` + `cf-build` green. **Migration run required.**

**BACKLOG.md** — under **Manufacturing / Cutting (React pilot)**: remove the
"Photo capture/upload at clock-out" item (delivered here). Add:
- `[ ] Cut-list photo polish if asked: multi-photo per session, lightbox zoom, delete/replace, retention cleanup`

## Out of scope
- No change to clock-in/clock-out/complete routes or middleware.
- No required-photo enforcement; no lightbox/zoom/delete; no retention job.
- No legacy-module edits.
