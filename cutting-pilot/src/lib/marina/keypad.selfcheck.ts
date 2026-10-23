// src/lib/marina/keypad.selfcheck.ts — marina-06
// Self-check for the fraction keypad entry state machine (keypad.ts). No DB, no network.
// Run with: npx tsx src/lib/marina/keypad.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import { parseInches } from "../inches";
import { EMPTY_KEYPAD, applyKey, keypadFromValue, keypadText, measureFeedback, type KeypadKey, type KeypadState } from "./keypad";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

const D = (d: string): KeypadKey => ({ kind: "digit", d });
const F = (f: string): KeypadKey => ({ kind: "frac", f });
const BACK: KeypadKey = { kind: "back" };
const CLEAR: KeypadKey = { kind: "clear" };
const UP: KeypadKey = { kind: "nudge", sixteenths: 1 };
const DOWN: KeypadKey = { kind: "nudge", sixteenths: -1 };
const run = (keys: KeypadKey[], from: KeypadState = EMPTY_KEYPAD) => keys.reduce(applyKey, from);
const text = (keys: KeypadKey[], from?: KeypadState) => keypadText(run(keys, from));

// ── digits ───────────────────────────────────────────────────────────────────────────────────
eq("digits append", text([D("1"), D("4"), D("7")]), "147");
eq("max 4 digits", run([D("1"), D("2"), D("3"), D("4"), D("5")]).whole, "1234");
eq("leading zeros collapse", run([D("0"), D("0"), D("5")]).whole, "5");
eq("single 0 stays", run([D("0")]).whole, "0");
eq("non-digit ignored", run([D("x")]), EMPTY_KEYPAD);
eq("digit past 2000\" refused", text([D("2"), D("0"), D("0"), D("1")]), "200");
eq("2000 allowed", text([D("2"), D("0"), D("0"), D("0")]), "2000");
eq("2000 + fraction refused", text([D("2"), D("0"), D("0"), D("0"), F("1/2")]), "2000");

// ── fractions ────────────────────────────────────────────────────────────────────────────────
eq("147 ½ → 147 1/2", text([D("1"), D("4"), D("7"), F("1/2")]), "147 1/2");
eq("frac replaces frac (¼ then ⅜)", text([D("4"), D("1"), F("1/4"), F("3/8")]), "41 3/8");
eq("same frac again clears it", text([D("4"), D("1"), F("3/8"), F("3/8")]), "41");
eq("frac reduced (6/16 → 3/8)", run([F("6/16")]).frac, "3/8");
eq("bad frac ignored (1/3)", run([F("1/3")]), EMPTY_KEYPAD);
eq("bad frac ignored (16/16)", run([F("16/16")]), EMPTY_KEYPAD);
eq("frac alone → 3/8", text([F("3/8")]), "3/8");
eq("0 + frac renders bare fraction", text([D("0"), F("3/8")]), "3/8");
eq("digit after frac keeps frac", text([D("4"), F("1/2"), D("1")]), "41 1/2");

// ── back / clear ─────────────────────────────────────────────────────────────────────────────
eq("back removes frac first", text([D("1"), D("4"), D("7"), F("1/2"), BACK]), "147");
eq("then the last digit", text([D("1"), D("4"), D("7"), F("1/2"), BACK, BACK]), "14");
eq("back on empty stays empty", run([BACK]), EMPTY_KEYPAD);
eq("clear", run([D("4"), F("1/8"), CLEAR]), EMPTY_KEYPAD);

// ── nudge ────────────────────────────────────────────────────────────────────────────────────
eq("41 15/16 + 1/16 → 42", text([UP], keypadFromValue(41 + 15 / 16)), "42");
eq("42 − 1/16 → 41 15/16", text([DOWN], keypadFromValue(42)), "41 15/16");
eq("41 3/8 + 1/16 → 41 7/16", text([UP], keypadFromValue(41.375)), "41 7/16");
eq("41 + 1/16 → 41 1/16", text([D("4"), D("1"), UP]), "41 1/16");
eq("empty nudges from 0 (+)", text([UP]), "1/16");
eq("empty − stays at 0", text([DOWN]), "0");
eq("1/16 − 1/16 → 0", text([DOWN], keypadFromValue(1 / 16)), "0");
eq("0 − 1/16 floor", text([DOWN, DOWN], keypadFromValue(0)), "0");
eq("nudge capped at 2000", text([UP], keypadFromValue(2000)), "2000");

// ── keypadFromValue ──────────────────────────────────────────────────────────────────────────
eq("fromValue 41.375", keypadFromValue(41.375), { whole: "41", frac: "3/8" });
eq("fromValue 0.5", keypadFromValue(0.5), { whole: "", frac: "1/2" });
eq("fromValue 56", keypadFromValue(56), { whole: "56", frac: null });
eq("fromValue null", keypadFromValue(null), EMPTY_KEYPAD);
eq("fromValue rounds to 1/16", keypadText(keypadFromValue(41.97)), "42");

// ── round-trip: keypadText → parseInches ─────────────────────────────────────────────────────
{
  const bad: string[] = [];
  for (let s = 0; s <= 48; s++) {
    const v = s / 16;
    const t = keypadText(keypadFromValue(v));
    if (parseInches(t) !== v) bad.push(`${v}→"${t}"→${parseInches(t)}`);
  }
  check("round-trip every 1/16 from 0 to 3", bad.length === 0, bad.join(", "));
  const t = text([D("1"), D("4"), D("7"), F("1/2")]);
  eq("round-trip 147 1/2", parseInches(t), 147.5);
  // Typed sequences round-trip too: every whole 0–3 × every keypad fraction.
  const typed: string[] = [];
  for (const w of ["", "0", "1", "2", "3"]) {
    for (const f of [null, "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8"]) {
      const st = run([...w.split("").filter(Boolean).map(D), ...(f ? [F(f)] : [])]);
      const tx = keypadText(st);
      if (tx && parseInches(tx) === null) typed.push(tx);
    }
  }
  check("typed entries always parse", typed.length === 0, typed.join(", "));
}

// ── measureFeedback ──────────────────────────────────────────────────────────────────────────
{
  const T = 0.1875;
  eq("feedback: unparseable → null", measureFeedback("41 3/", 41.375, T), null);
  eq("feedback: empty → null", measureFeedback("", 41.375, T), null);
  eq("feedback: exact", measureFeedback("41 3/8", 41.375, T), { inTol: true, text: "0" });
  eq("feedback: +1/16 in", measureFeedback("41 7/16", 41.375, T), { inTol: true, text: "+1/16" });
  eq("feedback: exactly 3/16 over is IN", measureFeedback("147 11/16", 147.5, T), { inTol: true, text: "+3/16" });
  eq("feedback: exactly 3/16 under is IN", measureFeedback("147 5/16", 147.5, T), { inTol: true, text: "−3/16" });
  eq("feedback: 1/4 under → UNDER", measureFeedback("55 3/4", 56, T), { inTol: false, text: "−1/4 UNDER" });
  eq("feedback: 1/4 over → OVER", measureFeedback("41 5/8", 41.375, T), { inTol: false, text: "+1/4 OVER" });
  eq("feedback: 3/8 under", measureFeedback("41", 41.375, T), { inTol: false, text: "−3/8 UNDER" });
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
