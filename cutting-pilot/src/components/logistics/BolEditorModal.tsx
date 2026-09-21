"use client";
// src/components/logistics/BolEditorModal.tsx
// Replaces legacy's BolEditor.open + mountBolEditor/bolEditorApply (logistics/index.html). The
// canvas/drag/overlay editing surface itself lives in src/lib/bolEditorEngine.ts (ported from
// bol-editor.js, kept imperative — see that file's header for why); this component owns the
// Modal chrome, the multi-load picker (mirrors legacy's #log-bol-edit-select), and the FENCED
// save call (PUT /v2/api/bols/:id, full-row replace, preserves access_token server-side).
//
// A fenced/locked/failed save never discards the operator's edits: bolEditorEngine defers its
// own cleanup until `finishApply(true)` is called, so a 501/409/error just re-enables the Apply
// button in place with a clear banner above it — never an infinite spinner, never silent data
// loss.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/Modal";
import { mountBolEditor, type BolEditorHandle, type ActiveFieldInfo } from "@/lib/bolEditorEngine";
import TextStyleToolbar from "@/components/logistics/TextStyleToolbar";
import type { BolRecord } from "@/lib/bolShared";

export interface EditorTarget {
  jobId: string;
  bols: BolRecord[];
  index: number;
}

interface BolEditorModalProps {
  target: EditorTarget | null;
  onCancel: () => void;
  onSaved: () => void;
}

export default function BolEditorModal({ target, onCancel, onSaved }: BolEditorModalProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [localBols, setLocalBols] = useState<BolRecord[]>([]);
  const [savedIndices, setSavedIndices] = useState<Set<number>>(new Set());
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<BolEditorHandle | null>(null);
  // bol-style-03: the currently-focused styleable field (drives TextStyleToolbar) and the DOM node
  // (bolEditorEngine's own canvasWrap) its coordinates are relative to — the toolbar is portaled
  // into that node rather than rendered in this component's own tree, so its `left`/`top` line up
  // with the engine's canvas-overlay coordinate space without any offset math here.
  const [activeField, setActiveField] = useState<ActiveFieldInfo | null>(null);
  const [styleMountNode, setStyleMountNode] = useState<HTMLElement | null>(null);
  const localBolsRef = useRef<BolRecord[]>([]);
  const savedIndicesRef = useRef<Set<number>>(new Set());
  // True once the currently-mounted load has been Applied successfully (or hasn't been mounted
  // yet). Guards the picker's onChange -- switching away while this is false would silently
  // discard whatever the operator has typed for the load on screen (bolEditorEngine's cleanup()
  // wipes the DOM with no warning).
  const appliedSinceMountRef = useRef(true);
  // Tracks the last `target` this effect actually mounted for, so a target swap and a picker-
  // driven activeIndex change can share one effect without racing: setting activeIndex in
  // response to a NEW target used to run in a separate effect keyed only on [target], which
  // fired in the same commit as this one and could mount target.bols[<stale activeIndex>] for
  // one pass before the corrected index took effect. Not reachable today (the dashboard always
  // passes index 0), but real for any future caller of a nonzero EditorTarget.index.
  const prevTargetRef = useRef<EditorTarget | null>(null);

  // Resets the per-session shadow state -- ONLY when `target` itself changes (a fresh multi-load
  // editing session), never on a picker-driven activeIndex change. This is the fix for silently
  // discarding a different load's progress: activeIndex changing must not reset localBols.
  useEffect(() => {
    if (!target) return;
    localBolsRef.current = target.bols;
    setLocalBols(target.bols);
    savedIndicesRef.current = new Set();
    setSavedIndices(new Set());
  }, [target]);

  useEffect(() => {
    if (!target) return;
    if (prevTargetRef.current !== target) {
      prevTargetRef.current = target;
      setNotice(null);
      const wantIndex = target.index ?? 0;
      if (activeIndex !== wantIndex) {
        setActiveIndex(wantIndex);
        return; // re-run once activeIndex catches up -- never mount on the stale index
      }
    }
    const targetBols = target.bols;
    // Prefer the locally-saved copy of this load (if the operator already Applied it once this
    // session) over the original prop, so switching away and back shows the saved edit rather
    // than a stale re-derivation from target.bols. Falls back to target.bols before the reset
    // effect above has populated localBolsRef (e.g. the very first render of a new target).
    const bol = localBolsRef.current[activeIndex] ?? targetBols[activeIndex];
    const container = mountRef.current;
    if (!bol || !container) return;

    appliedSinceMountRef.current = false;
    let cancelled = false;

    async function handleApply(updated: BolRecord) {
      try {
        const payload: Record<string, unknown> = { ...updated, render_overrides: updated._overrides || null };
        delete payload._overrides;
        const res = await fetch(`/v2/api/bols/${encodeURIComponent(String(updated.id))}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 501) {
          setNotice("Save is disabled in the v2 preview phase — this edit was not persisted.");
          handleRef.current?.finishApply(false);
          return;
        }
        if (res.status === 409 || data.locked) {
          setNotice("This load has shipped — the BOL can no longer be edited.");
          handleRef.current?.finishApply(false);
          return;
        }
        if (!res.ok || !data.ok) {
          setNotice(data.error || "Could not save changes.");
          handleRef.current?.finishApply(false);
          return;
        }

        appliedSinceMountRef.current = true;
        handleRef.current?.finishApply(true);

        const savedBol = (data.bol as BolRecord | undefined) ?? updated;
        const nextLocalBols = [...localBolsRef.current];
        nextLocalBols[activeIndex] = savedBol;
        localBolsRef.current = nextLocalBols;
        setLocalBols(nextLocalBols);

        const nextSaved = new Set(savedIndicesRef.current);
        nextSaved.add(activeIndex);
        savedIndicesRef.current = nextSaved;
        setSavedIndices(nextSaved);

        if (nextSaved.size >= targetBols.length) {
          onSaved();
          return;
        }

        let nextIndex = activeIndex;
        for (let i = 0; i < targetBols.length; i++) {
          if (!nextSaved.has(i)) {
            nextIndex = i;
            break;
          }
        }
        setNotice(`Load ${activeIndex + 1} saved. Now editing load ${nextIndex + 1} of ${targetBols.length}.`);
        setActiveIndex(nextIndex);
      } catch {
        setNotice("Network error — could not save changes.");
        handleRef.current?.finishApply(false);
      }
    }

    (async () => {
      setNotice(null);
      setActiveField(null);
      setStyleMountNode(null);
      const handle = await mountBolEditor(container, bol, {
        onApply: (updated) => {
          if (!cancelled) void handleApply(updated);
        },
        onCancel: () => {
          if (!cancelled) onCancel();
        },
        onActiveFieldChange: (info) => {
          if (!cancelled) setActiveField(info);
        },
      });
      if (cancelled) {
        handle.cleanup();
        return;
      }
      handleRef.current = handle;
      setStyleMountNode(handle.getStyleMountNode());
    })();

    return () => {
      cancelled = true;
      handleRef.current?.cleanup();
      handleRef.current = null;
      setActiveField(null);
      setStyleMountNode(null);
    };
    // Re-mount only when the target BOL or the picker selection changes — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, activeIndex]);

  return (
    <Modal isOpen={!!target} onClose={onCancel} title="Edit BOL" size="xl">
      <div className="flex flex-col gap-2" style={{ height: "70vh" }}>
        {target && target.bols.length > 1 && (
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Editing load</label>
            <select
              className="w-full min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3"
              value={activeIndex}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (next === activeIndex) return;
                if (!appliedSinceMountRef.current) {
                  if (!window.confirm("You have unsaved changes for this load — discard them?")) return;
                }
                setActiveIndex(next);
              }}
            >
              {(localBols.length ? localBols : target.bols).map((b, i) => (
                <option key={String(b.id)} value={i}>
                  {`Load ${b.load_number ?? i + 1} — BOL ${b.bol_number || b.id}${savedIndices.has(i) ? " ✓" : ""}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {notice && (
          <div className="rounded-md bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)] text-sm px-3 py-2">
            {notice}
          </div>
        )}

        <div
          ref={mountRef}
          className="flex-1 min-h-0 rounded-lg border border-[var(--card-border)] overflow-hidden"
        />

        {activeField &&
          styleMountNode &&
          createPortal(
            <TextStyleToolbar
              value={activeField.value}
              onChange={(patch) => handleRef.current?.setFieldStyleValue(activeField.fieldKey, patch)}
              scope={activeField.scope}
              onScopeChange={(scope) => handleRef.current?.setScope(scope)}
              onReset={() => handleRef.current?.resetFieldStyle(activeField.fieldKey)}
              supportsLines={activeField.supportsLines}
              baseSize={activeField.baseSize}
              left={activeField.left}
              top={activeField.top}
            />,
            styleMountNode
          )}
      </div>
    </Modal>
  );
}
