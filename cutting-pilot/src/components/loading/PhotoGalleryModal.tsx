"use client";
// src/components/loading/PhotoGalleryModal.tsx
// Port of legacy shared/photo-gallery.js's lightbox, scoped to the loading dashboard's job-level
// use (photoGallery.openLightbox({ jobId })). View-only unless `addTo` is set (dock-05: the dock
// board passes it for Loaded cards when the user can edit logistics.loading, so a forgotten photo
// can be added after the fact). Composes @/components/Modal.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Modal from "@/components/Modal";
import { uploadLoadingPhoto } from "@/lib/loadingPhotos";
import PhotoPicker, { type PendingPhoto } from "./PhotoPicker";

interface Photo {
  id: string;
  filename: string | null;
  uploaded_by: string | null;
  created_at: string | null;
}

interface PhotoGalleryModalProps {
  jobId: string | null; // still controls open/closed
  onClose: () => void;
  /** lgx-photos-01: when provided, use these instead of fetching /v2/api/loading-photos?job_id=. */
  photos?: Photo[];
  /** lgx-photos-01: image URL builder; default = `/v2/api/loading-photos/${id}/image` (unchanged). */
  imageSrc?: (photoId: string) => string;
  /** lgx-photos-01: initial index when opening with provided photos (default 0). */
  startIndex?: number;
  /** dock-05: when set, show an "Add photos" section that uploads to this assignment. */
  addTo?: { assignmentId: string; jobId: string } | null;
  /** dock-05: called after at least one photo uploads, so the caller can refetch counts. */
  onPhotosAdded?: () => void;
}

const defaultImageSrc = (photoId: string) => `/v2/api/loading-photos/${encodeURIComponent(photoId)}/image`;

export default function PhotoGalleryModal({
  jobId,
  onClose,
  photos: providedPhotos,
  imageSrc = defaultImageSrc,
  startIndex,
  addTo,
  onPhotosAdded,
}: PhotoGalleryModalProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // dock-05: factored out of the effect so it can re-run after an upload. Resolves to the fetched
  // list (null on failure) so the caller can jump to the newest photo.
  const refetch = useCallback(async (opts?: { silent?: boolean }): Promise<Photo[] | null> => {
    if (!jobId) return null;
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const json = await fetch(`/v2/api/loading-photos?job_id=${encodeURIComponent(jobId)}`).then((r) => r.json());
      if (!json.ok) {
        setError("Couldn't load photos.");
        return null;
      }
      const list: Photo[] = json.photos ?? [];
      setPhotos(list);
      return list;
    } catch {
      setError("Couldn't load photos.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    if (providedPhotos) {
      setLoading(false);
      setError(null);
      setPhotos(providedPhotos);
      setIndex(Math.min(Math.max(startIndex ?? 0, 0), Math.max(providedPhotos.length - 1, 0)));
      return;
    }
    setIndex(0);
    refetch();
  }, [jobId, providedPhotos, startIndex, refetch]);

  // Clear upload feedback whenever the modal closes (or reopens on another job).
  useEffect(() => {
    setUploadProgress(null);
    setUploadError(null);
  }, [jobId]);

  async function handleAdd(picked: PendingPhoto[]) {
    if (!addTo) return;
    setUploadError(null);
    setUploading(true);
    let succeeded = 0;
    let failed = 0;
    let firstError: string | null = null;
    for (let i = 0; i < picked.length; i++) {
      setUploadProgress(`Uploading ${i + 1} of ${picked.length}…`);
      const result = await uploadLoadingPhoto({
        assignmentId: addTo.assignmentId,
        jobId: addTo.jobId,
        dataUrl: picked[i].dataUrl,
        filename: picked[i].filename,
      });
      if (result.ok) succeeded++;
      else {
        failed++;
        if (!firstError) firstError = result.error;
      }
    }
    setUploadProgress(null);
    if (succeeded > 0) {
      const list = await refetch({ silent: true }); // silent: keep the viewer mounted, no flash
      if (list && list.length) setIndex(list.length - 1);
      onPhotosAdded?.();
    }
    if (failed > 0) setUploadError(`${failed} of ${picked.length} photo(s) didn't upload: ${firstError}`);
    setUploading(false);
  }

  const addSection = addTo ? (
    <div className="border-t border-[var(--line)] pt-3 space-y-2">
      <p className="text-xs font-semibold text-muted">Add photos</p>
      <PhotoPicker onPicked={handleAdd} disabled={uploading} />
      {uploadProgress && <p className="text-xs text-muted">{uploadProgress}</p>}
      {uploadError && <p className="text-xs text-[var(--danger-text)]">{uploadError}</p>}
    </div>
  ) : null;

  useEffect(() => {
    if (!jobId || photos.length < 2) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % photos.length);
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + photos.length) % photos.length);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [jobId, photos.length]);

  const current = photos[index];

  return (
    <Modal isOpen={!!jobId} onClose={onClose} title="Loading photos" size="lg">
      {loading && <p className="text-sm text-muted">Loading photos…</p>}
      {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
      {!loading && !error && photos.length === 0 && (
        <p className="text-sm text-text-faint">No photos taken for this shipment.</p>
      )}
      {!loading && !error && photos.length === 0 && addSection}
      {!loading && !error && photos.length > 0 && current && (
        <div className="space-y-3">
          <div
            className="relative flex items-center justify-center rounded overflow-hidden"
            style={{ minHeight: 320, background: "#111827" }}
            onTouchStart={(e) => {
              touchStartXRef.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (touchStartXRef.current == null || photos.length < 2) return;
              const dx = e.changedTouches[0].clientX - touchStartXRef.current;
              if (Math.abs(dx) > 40) {
                setIndex((i) => (dx < 0 ? (i + 1) % photos.length : (i - 1 + photos.length) % photos.length));
              }
              touchStartXRef.current = null;
            }}
          >
            {photos.length > 1 && (
              <button
                type="button"
                onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] rounded bg-white/10 text-white flex items-center justify-center cursor-pointer hover:bg-white/20"
              >
                <ChevronLeft size={22} aria-hidden="true" />
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageSrc(current.id)}
              alt={current.filename || `Photo ${index + 1}`}
              className="max-h-[60vh] max-w-full object-contain"
            />
            {photos.length > 1 && (
              <button
                type="button"
                onClick={() => setIndex((i) => (i + 1) % photos.length)}
                aria-label="Next photo"
                className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] rounded bg-white/10 text-white flex items-center justify-center cursor-pointer hover:bg-white/20"
              >
                <ChevronRight size={22} aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="text-xs text-muted text-center">
            {index + 1} of {photos.length}
            {current.uploaded_by ? ` · ${current.uploaded_by}` : ""}
            {current.created_at ? ` · ${current.created_at}` : ""}
          </p>
          {photos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`View photo ${i + 1}`}
                  className="shrink-0 w-16 h-16 rounded overflow-hidden cursor-pointer"
                  style={{
                    borderStyle: "solid",
                    borderColor: i === index ? "var(--accent)" : "var(--line)",
                    borderWidth: i === index ? 2 : 1,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageSrc(p.id)}
                    alt={p.filename || `Photo ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          {addSection}
        </div>
      )}
    </Modal>
  );
}
