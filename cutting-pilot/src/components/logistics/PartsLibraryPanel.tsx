"use client";
// src/components/logistics/PartsLibraryPanel.tsx
// Load Builder's modal host for the shared parts library (lb-ui-10). admin-06 moved the library itself to
// src/components/parts/PartsLibrary.tsx so /v2/admin's Parts tab renders the same component inline —
// one definition, two call sites. Props unchanged, so LoadPlanView.tsx needs no edit.
import Modal from "@/components/Modal";
import PartsLibrary from "@/components/parts/PartsLibrary";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function PartsLibraryPanel({ isOpen, onClose }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Parts library" size="xl">
      <PartsLibrary active={isOpen} layout="modal" />
    </Modal>
  );
}
