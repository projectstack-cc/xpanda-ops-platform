// src/lib/loadingPhotos.ts
// dock-05: the one client-side caller of POST /v2/api/loading-photos. Shared by LoadedChecklistModal
// (photos taken during the Loaded checklist) and PhotoGalleryModal (photos added to a Loaded card
// after the fact). Never throws -- every failure comes back as { ok: false, error } so callers can
// surface it instead of swallowing it.

export type UploadResult = { ok: true; id: string } | { ok: false; error: string };

export async function uploadLoadingPhoto(args: {
  assignmentId: string;
  jobId: string;
  dataUrl: string;
  filename: string;
}): Promise<UploadResult> {
  const base64 = args.dataUrl.split(",")[1] || args.dataUrl;
  try {
    const res = await fetch("/v2/api/loading-photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignment_id: args.assignmentId,
        job_id: args.jobId,
        photo_data: base64,
        filename: args.filename,
      }),
    });
    let json: { ok?: boolean; id?: string; error?: string } | null = null;
    try {
      json = await res.json();
    } catch {
      // non-JSON error body (e.g. a platform 413 page) -- fall through to the status mapping
    }
    if (res.ok && json?.ok) return { ok: true, id: String(json.id) };
    if (res.status === 401) return { ok: false, error: "Your session expired — log in again, then retry." };
    if (res.status === 403) return { ok: false, error: "You don't have permission to add loading photos." };
    return { ok: false, error: json?.error || `Upload failed (HTTP ${res.status}).` };
  } catch {
    return { ok: false, error: "Network error — photo not uploaded." };
  }
}
