"use client";
// src/components/loading/PhotoGalleryModal.tsx
// Port of legacy shared/photo-gallery.js's lightbox, scoped to the loading dashboard's job-level
// use (photoGallery.openLightbox({ jobId })). View-only -- capture/upload during the Loaded
// checklist stays in LoadedChecklistModal, unchanged. Composes @/components/Modal.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Modal from "@/components/Modal";

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
}

const defaultImageSrc = (photoId: string) => `/v2/api/loading-photos/${encodeURIComponent(photoId)}/image`;

export default function PhotoGalleryModal({
  jobId,
  onClose,
  photos: providedPhotos,
  imageSrc = defaultImageSrc,
  startIndex,
}: PhotoGalleryModalProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  useEffect(() => {
    if (!jobId) return;
    if (providedPhotos) {
      setLoading(false);
      setError(null);
      setPhotos(providedPhotos);
      setIndex(Math.min(Math.max(startIndex ?? 0, 0), Math.max(providedPhotos.length - 1, 0)));
      return;
    }
    setLoading(true);
    setError(null);
    setIndex(0);
    fetch(`/v2/api/loading-photos?job_id=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) {
          setError("Couldn't load photos.");
          return;
        }
        setPhotos(json.photos ?? []);
      })
      .catch(() => setError("Couldn't load photos."))
      .finally(() => setLoading(false));
  }, [jobId, providedPhotos, startIndex]);

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
        </div>
      )}
    </Modal>
  );
}
