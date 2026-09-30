// src/components/logistics/BolActions.tsx
// lgx-rows-01: four icon-only row actions, ALWAYS rendered in fixed positions so the column never
// shifts: 1 Build Load · 2 Loading sheet · 3 Signed BOL · 4 View BOL (default) / Generate BOL (primary).
// An action that doesn't apply is grayed out (IconAction disabledReason) with the reason as its tooltip.
// View/Generate toggles on `bol_count > 0` (or `bol_number`).
import { Eye, FileCheck, FilePlus, Printer, Truck } from "lucide-react";
import type { ShipmentListItem } from "./types";
import IconAction from "./IconAction";
import LoadingSheetButton from "./LoadingSheetButton";
import SignedBolButton from "./SignedBolButton";

interface BolActionsProps {
  shipment: ShipmentListItem;
  onViewBol: (jobId: string) => void;
  onGenerateBol: (jobId: string) => void;
}

const NO_JOB = "No linked job";

export default function BolActions({ shipment, onViewBol, onGenerateBol }: BolActionsProps) {
  const hasBol = Number(shipment.bol_count || 0) > 0 || Boolean(shipment.bol_number);
  const jobId = shipment.job_id;
  const isCancelled = shipment.status === "cancelled";
  const isDelivered = shipment.status === "delivered";

  const buildLoadReason = !jobId ? NO_JOB : isDelivered ? "Already delivered" : isCancelled ? "Cancelled" : null;
  const loadingSheetReason = !jobId ? NO_JOB : isCancelled ? "Cancelled" : null;

  return (
    <div className="flex flex-nowrap items-center justify-end gap-1.5">
      <IconAction
        icon={Truck}
        label="Open Load Builder"
        href={jobId ? `/logistics/load-builder.html?job_id=${jobId}` : ""}
        disabledReason={buildLoadReason}
      />

      {jobId ? (
        <LoadingSheetButton mode="order" jobId={jobId} disabledReason={loadingSheetReason} />
      ) : (
        <IconAction icon={Printer} label="Print loading sheet" disabledReason={NO_JOB} />
      )}

      {jobId ? (
        <SignedBolButton jobId={jobId} available={Boolean(shipment.has_signed_bol)} />
      ) : (
        <IconAction icon={FileCheck} label="View signed BOL" disabledReason={NO_JOB} />
      )}

      {hasBol ? (
        <IconAction
          icon={Eye}
          label="View Bill of Lading"
          disabledReason={!jobId ? NO_JOB : null}
          onClick={() => jobId && onViewBol(jobId)}
        />
      ) : (
        <IconAction
          icon={FilePlus}
          label="Generate Bill of Lading"
          variant="primary"
          disabledReason={!jobId ? NO_JOB : isCancelled ? "Cancelled" : null}
          onClick={() => jobId && onGenerateBol(jobId)}
        />
      )}
    </div>
  );
}
