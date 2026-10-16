"use client";
// src/components/loading/DockModalHost.tsx
// dock-07: the six dock-board modals, rendered exactly as DockBoard.tsx rendered them inline
// before the extraction. State + confirm handlers come from useDockActions().modals.
import AssignBayModal from "./AssignBayModal";
import LoadedChecklistModal from "./LoadedChecklistModal";
import ShippingInfoModal from "./ShippingInfoModal";
import PullJobModal from "./PullJobModal";
import PhotoGalleryModal from "./PhotoGalleryModal";
import BolViewerModal from "@/components/logistics/BolViewerModal";
import type { DockModalsState } from "./useDockActions";
import type { DockAssignment, DockBay } from "./dockTypes";

interface DockModalHostProps {
  modals: DockModalsState;
  bays: DockBay[];
  assignments: DockAssignment[];
  pullJobDefaultBayId: string | null;
  onReload: () => void;
}

export default function DockModalHost({ modals, bays, assignments, pullJobDefaultBayId, onReload }: DockModalHostProps) {
  return (
    <>
      {modals.bayModalTarget && (
        <AssignBayModal bays={bays} onClose={() => modals.setBayModalTarget(null)} onConfirm={modals.confirmAssignBay} />
      )}

      <LoadedChecklistModal
        assignment={modals.checklistTarget}
        onClose={() => modals.setChecklistTarget(null)}
        onDone={() => {
          modals.setChecklistTarget(null);
          onReload();
        }}
      />

      <BolViewerModal
        jobId={modals.viewerTarget?.jobId ?? null}
        loadNumber={modals.viewerTarget?.loadNumber ?? null}
        viewOnly
        onClose={() => modals.setViewerTarget(null)}
        onEdit={() => {
          /* view-only on the dock dashboard -- Edit is unreachable (viewOnly hides the button) */
        }}
      />

      <ShippingInfoModal
        assignment={modals.shippingInfoTarget}
        jobCache={modals.jobCache}
        onClose={() => modals.setShippingInfoTarget(null)}
      />

      {modals.pullJobOpen && (
        <PullJobModal
          bays={bays}
          assignments={assignments}
          defaultBayId={pullJobDefaultBayId}
          onClose={() => modals.setPullJobOpen(false)}
          onDone={() => {
            modals.setPullJobOpen(false);
            onReload();
          }}
        />
      )}

      <PhotoGalleryModal
        jobId={modals.photoGalleryJobId}
        onClose={() => {
          modals.setPhotoGalleryJobId(null);
          modals.setPhotoAddTarget(null);
        }}
        addTo={modals.photoAddTarget}
        onPhotosAdded={onReload}
      />
    </>
  );
}
