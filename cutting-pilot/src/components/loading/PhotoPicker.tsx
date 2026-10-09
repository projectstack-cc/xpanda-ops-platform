"use client";
// src/components/loading/PhotoPicker.tsx
// dock-05: the dock's photo capture UI ("Take photo" / "Upload from library" + their hidden file
// inputs), moved out of LoadedChecklistModal so the checklist and PhotoGalleryModal's after-the-fact
// "Add photos" section share one picker. Compresses each file (1200 px / 0.6, the dock values) and
// reports files that fail to compress instead of skipping them silently.
import { useRef, useState } from "react";
import { Camera, Upload } from "lucide-react";
import { compressPhoto } from "@/lib/compressPhoto";

export interface PendingPhoto {
  dataUrl: string;
  filename: string;
}

export default function PhotoPicker({
  onPicked,
  disabled,
}: {
  onPicked: (photos: PendingPhoto[]) => void;
  disabled?: boolean;
}) {
  const [failedCount, setFailedCount] = useState(0);
  const captureRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || !fileList.length) return;
    setFailedCount(0);
    const next: PendingPhoto[] = [];
    let failed = 0;
    for (const file of Array.from(fileList)) {
      try {
        const dataUrl = await compressPhoto(file, 1200, 0.6);
        next.push({ dataUrl, filename: file.name });
      } catch {
        failed++;
      }
    }
    setFailedCount(failed);
    if (next.length) onPicked(next);
  }

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => captureRef.current?.click()}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-default"
        >
          <Camera size={14} aria-hidden="true" /> Take photo
        </button>
        <button
          type="button"
          onClick={() => uploadRef.current?.click()}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-default"
        >
          <Upload size={14} aria-hidden="true" /> Upload from library
        </button>
      </div>
      <input
        ref={captureRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {failedCount > 0 && (
        <p className="text-xs text-[var(--danger-text)]">
          {failedCount} photo(s) couldn&apos;t be processed — try again or choose a different photo.
        </p>
      )}
    </>
  );
}
