"use client";
// Placeholder client shell for the Block Nesting module. Parser + editable grid + block-size
// inputs land in P323; the offcut-recursive nester + cut-sheet renderer land in P324.

export default function BlocksApp() {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-2">
        <h2 className="text-lg font-semibold text-text">Block nesting</h2>
        <p className="text-sm text-muted">
          Module scaffold — parser and nester land in P323 / P324.
        </p>
      </div>
    </div>
  );
}
