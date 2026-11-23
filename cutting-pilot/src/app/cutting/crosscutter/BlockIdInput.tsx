"use client";
// cc-blocks-01: block-ID entry for the Cross Cutter Stop/Complete modals. The operator enters the IDs
// ("MM/DD-XX") of the molded blocks used this run; the block count is the number of IDs. After an Add
// the field refills with the last-used "MM/DD-" prefix (lifted to ChunkBoard + localStorage), so the
// next block from the same molding sheet only needs its sequence. Pasting a list adds every valid ID.
// Invalid and duplicate entries (chips or `existing`, i.e. already recorded on this assignment) are
// shown inline and not added. A valid ID typed but not yet added is reported through onPendingChange
// so the modal can include it on submit (a floor operator may tap Stop without tapping Add).
import { useEffect, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { BLOCK_ID_HINT, normalizeBlockId, parseBlockIdList } from "@/lib/cutting/blockIds";

interface Props {
  id: string;
  label: string;
  optional?: boolean;
  value: string[];
  onChange: (ids: string[]) => void;
  existing?: string[];
  prefix: string;
  onPrefixChange: (prefix: string) => void;
  onPendingChange?: (pending: string | null) => void;
}

const NONE: string[] = [];

// "11/20-07" → "11/20-"
function prefixOf(id: string): string {
  return id.slice(0, id.indexOf("-") + 1);
}

export default function BlockIdInput({
  id,
  label,
  optional,
  value,
  onChange,
  existing = NONE,
  prefix,
  onPrefixChange,
  onPendingChange,
}: Props) {
  const [text, setText] = useState(prefix);
  const [message, setMessage] = useState<string | null>(null);

  // Pending = a valid, not-yet-added, non-duplicate ID sitting in the field.
  useEffect(() => {
    if (!onPendingChange) return;
    const n = normalizeBlockId(text);
    onPendingChange(n && !value.includes(n) && !existing.includes(n) ? n : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, value, existing]);

  function addFrom(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === prefix) return;
    const { ids, invalid } = parseBlockIdList(trimmed);
    const added: string[] = [];
    const dupes: string[] = [];
    const recorded: string[] = [];
    for (const n of ids) {
      if (value.includes(n) || added.includes(n)) dupes.push(n);
      else if (existing.includes(n)) recorded.push(n);
      else added.push(n);
    }
    const notes: string[] = [];
    if (invalid.length) {
      notes.push(
        invalid.length === 1
          ? `"${invalid[0]}" isn't a valid block ID — use ${BLOCK_ID_HINT}`
          : `${invalid.map((x) => `"${x}"`).join(", ")} aren't valid block IDs — use ${BLOCK_ID_HINT}`
      );
    }
    if (dupes.length) notes.push(`${dupes.join(", ")} already entered`);
    if (recorded.length) notes.push(`${recorded.join(", ")} already recorded on this assignment`);
    setMessage(notes.length ? notes.join(". ") + "." : null);

    if (added.length) {
      onChange([...value, ...added]);
      const nextPrefix = prefixOf(added[added.length - 1]);
      onPrefixChange(nextPrefix);
      setText(nextPrefix);
    } else if (!invalid.length) {
      // Only dupes — clear back to the prefix so the operator can type the next one.
      setText(prefix);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addFrom(text);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    // A pasted list (more than one piece) is added as a whole; a single ID pastes normally.
    if (/[\s,;]/.test(pasted.trim().replace(/\s*([/-])\s*/g, "$1"))) {
      e.preventDefault();
      addFrom(pasted);
    }
  }

  function remove(blockId: string) {
    onChange(value.filter((x) => x !== blockId));
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-text mb-1">
        {label}
        {optional && <span className="ml-1 text-xs text-muted font-normal">(optional)</span>}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={text}
          placeholder={BLOCK_ID_HINT}
          onChange={(e) => {
            setText(e.target.value);
            if (message) setMessage(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          aria-describedby={message ? `${id}-msg` : undefined}
          aria-invalid={message ? true : undefined}
          className="w-40 min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <button
          type="button"
          onClick={() => addFrom(text)}
          className="min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Add
        </button>
      </div>

      {message && (
        <p id={`${id}-msg`} role="alert" className="mt-1.5 text-xs text-[var(--danger-bg)] font-medium">
          {message}
        </p>
      )}

      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Block IDs entered">
          {value.map((blockId) => (
            <li
              key={blockId}
              className="inline-flex items-center min-h-[44px] pl-3 rounded border border-border bg-[var(--ghost-bg)] text-sm font-mono tabular-nums text-text"
            >
              {blockId}
              <button
                type="button"
                onClick={() => remove(blockId)}
                aria-label={`Remove ${blockId}`}
                className="w-11 h-11 flex items-center justify-center text-muted hover:text-text cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1.5 text-xs text-muted tabular-nums" aria-live="polite">
        Blocks cut this run: {value.length}
      </p>
    </div>
  );
}
