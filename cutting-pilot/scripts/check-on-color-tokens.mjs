// ui-tokens-01 — build-time guard against invisible white-on-white text.
//
// --danger-text / --success-text / --primary-text are ON-COLOR tokens: white in both themes,
// valid only for text sitting on their matching --danger-bg / --success-bg / --primary-bg.
// For red/green text on a normal surface use --danger-ink / --success-ink.
//
// Rule: every place that sets the TEXT color to var(--X-text) must, on the same element, also
// set the background to var(--X-bg). "Same element" =
//   - the same string literal (className string, template literal, ternary branch), or
//   - the enclosing array literal when the string is an array element (`[...].join(" ")`), or
//   - the enclosing object literal when the string is a property value
//     (style objects; `{ bg: "...", text: "..." }` variant maps).
// Variant prefixes must match: `hover:text-[var(--danger-text)]` needs `hover:bg-[var(--danger-bg)]`.
// A color-mix(...) hover tint does NOT count. Borders/fills using the token are not text, so ignored.
// When unsure the script flags; silence a reviewed false positive with a comment on the line
// directly above:   // on-color-ok: <reason>     (or {/* on-color-ok: <reason> */} in JSX)
//
// Dependency-free. Exits 1 with file:line diagnostics on any misuse.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");
const TOKEN_RE = /var\(--(danger|success|primary)-text\)/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineOf(text, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// Is idx inside a // or /* */ comment? Checked locally (line + nearest block-comment markers).
function inComment(text, idx) {
  const lineStart = text.lastIndexOf("\n", idx - 1) + 1;
  const before = text.slice(lineStart, idx);
  // `//` not preceded by ':' (keeps https:// in strings from counting)
  if (/(^|[^:])\/\//.test(before)) return true;
  const open = text.lastIndexOf("/*", idx);
  if (open !== -1 && text.lastIndexOf("*/", idx) < open) return true;
  return false;
}

// The string literal containing idx: nearest " or ` before it, closed by the same char after.
function enclosingString(text, idx) {
  for (let i = idx - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '"' || c === "`") {
      const end = text.indexOf(c, idx);
      if (end === -1) return null;
      return { start: i, end: end + 1, quote: c };
    }
    if (c === "\n" && text[i - 1] !== undefined) {
      // double-quoted strings never span lines; keep scanning only for a backtick
      const bt = text.lastIndexOf("`", i);
      const dq = text.lastIndexOf('"', i);
      if (bt > dq && bt !== -1) {
        const end = text.indexOf("`", idx);
        if (end === -1) return null;
        return { start: bt, end: end + 1, quote: "`" };
      }
      return null;
    }
  }
  return null;
}

// Match the bracket that encloses position `from` (scanning backward), skipping string contents.
function enclosingOpen(text, from) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  let i = from - 1;
  while (i >= 0) {
    const c = text[i];
    if (c === '"' || c === "`" || c === "'") {
      // skip back over a string literal (single-line for ' and ")
      const prev = text.lastIndexOf(c, i - 1);
      if (prev === -1) return null;
      if (c !== "`" && text.slice(prev, i).includes("\n")) { i--; continue; }
      i = prev - 1;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") stack.push(c);
    else if (c === "(" || c === "[" || c === "{") {
      if (stack.length === 0) return { idx: i, ch: c };
      const top = stack.pop();
      if (pairs[top] !== c) return null;
    }
    i--;
  }
  return null;
}

function matchingClose(text, openIdx) {
  const open = text[openIdx];
  const close = { "(": ")", "[": "]", "{": "}" }[open];
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "`" || c === "'") {
      const next = text.indexOf(c, i + 1);
      if (next === -1) return -1;
      if (c !== "`" && text.slice(i, next).includes("\n")) continue;
      i = next;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return c === close ? i : -1;
    }
  }
  return -1;
}

function prevNonSpace(text, idx) {
  let i = idx - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  return i;
}

// Property key when the string at `start` is an object property value (`key: "..."`, also
// `key: cond ? "..." : "..."`). Returns null when the string isn't a property value.
function propertyKey(text, start, groupStart) {
  const seg = text.slice(groupStart + 1, start);
  const m = [...seg.matchAll(/(?:^|[{,\s])["']?([A-Za-z_$][\w$-]*)["']?\s*:(?!:)/g)];
  if (!m.length) return null;
  return m[m.length - 1][1];
}

const files = walk(SRC);
const problems = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index;
    const kind = m[1];
    if (inComment(text, idx)) continue;
    const line = lineOf(text, idx);
    const above = (lines[line - 2] || "");
    if (/on-color-ok:/.test(above)) continue;

    const str = enclosingString(text, idx);
    const pre = text.slice(Math.max(0, idx - 80), idx);
    const classCtx = pre.match(/(^|[\s"'`])((?:[\w-]+:)*)text-\[$/);
    let usage; // "class" | "style" | "other"
    let variant = "";
    if (classCtx) {
      usage = "class";
      variant = classCtx[2];
    } else if (/(?:^|[\s"'`:])(?:[\w-]+:)*(?:bg|border|ring|outline|fill|stroke|decoration|from|to|via|divide|shadow|accent|caret|placeholder)(?:-[a-z]+)?-\[$/.test(pre)) {
      continue; // not a text color
    } else {
      usage = "style";
    }

    const unitTexts = [];
    if (str) unitTexts.push(text.slice(str.start, str.end));
    let styleKey = null;
    if (str) {
      const grp = enclosingOpen(text, str.start);
      if (grp && (grp.ch === "[" || grp.ch === "{")) {
        const close = matchingClose(text, grp.idx);
        const p = prevNonSpace(text, str.start);
        const isArrayElem = grp.ch === "[" && close !== -1;
        const key = grp.ch === "{" ? propertyKey(text, str.start, grp.idx) : null;
        if (isArrayElem || (grp.ch === "{" && key && close !== -1 && text[p] !== "{")) {
          unitTexts.push(text.slice(grp.idx, close + 1));
        }
        styleKey = key;
      }
    }
    const unit = unitTexts.join("\n");

    let ok = false;
    if (usage === "class") {
      const need = new RegExp(`(^|[\\s"'\`])${escapeRe(variant)}bg-\\[var\\(--${kind}-bg\\)\\]`);
      ok = need.test(unit);
    } else {
      if (styleKey && !/^color$/i.test(styleKey)) {
        // style key other than color (background, borderColor, …) — not a text color
        if (/^(background|backgroundColor|borderColor|borderTopColor|borderBottomColor|borderLeftColor|borderRightColor|outlineColor|fill|stroke)$/.test(styleKey)) continue;
      }
      ok = new RegExp(`background(?:Color)?\\s*:\\s*["'\`]var\\(--${kind}-bg\\)`).test(unit) ||
        new RegExp(`(^|[\\s"'\`])bg-\\[var\\(--${kind}-bg\\)\\]`).test(unit);
    }
    if (!ok) {
      problems.push(`${relative(ROOT, file).replace(/\\/g, "/")}:${line}: var(--${kind}-text) used as text color without bg var(--${kind}-bg) on the same element — use --${kind === "primary" ? "text" : kind + "-ink"} (or add the matching background)`);
    }
  }
}

if (problems.length) {
  console.error(`check-on-color-tokens: ${problems.length} on-color token misuse(s):\n`);
  for (const p of problems) console.error("  " + p);
  console.error(`\n--*-text tokens are white on-color text for their matching --*-bg only.` +
    `\nUse --danger-ink / --success-ink for colored text on a normal surface.` +
    `\nReviewed false positive? Put  // on-color-ok: <reason>  on the line above.`);
  process.exit(1);
}
console.log(`check-on-color-tokens: OK (${files.length} files)`);
