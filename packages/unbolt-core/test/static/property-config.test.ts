/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { blankLiterals, findCalls, normalizeGlobKeys, splitTopLevel } from "../helpers/sourceScan";
/**
 * Property-file seeds and run counts (Req 25.2, 26.2, 27.1, 28.7, 29.3).
 *
 * Every `*.property.test.ts` file of both packages is parsed. Each `fc.assert` call must have:
 *
 * - a literal integer `seed`, written either inline or as a named top-level `const` with a
 *   literal value (the files declare `const SEED = 0x...`);
 * - a `numRuns` that is either an integer literal of at least 100 (inline or a named literal
 *   constant) or the identifier `FULL_KB_RUNS`;
 * - no option that can end a run early (`interruptAfterTimeLimit`, `skipAllAfterTimeLimit`,
 *   `endOnFailure`, `timeout`), because that would lower the effective run count.
 *
 * `FULL_KB_RUNS` may appear only in the three Full_Keyboard files of Invariants 1, 2 and 4, and
 * each of them must use it as its `numRuns`. The invariant files must also carry their tag
 * comment and the documented timeout, and all 14 of them must exist.
 *
 * Sources are read with Vite raw glob imports. Comments and the contents of string literals are
 * masked before the structure is parsed, so a mention inside a comment or message is not a use.
 */
const coreFiles = import.meta.glob("../**/*.property.test.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const kitFiles = import.meta.glob("../../../sample-kits/test/**/*.property.test.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const coreSources = import.meta.glob("../../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const FILES = normalizeGlobKeys({ ...coreFiles, ...kitFiles });
const SOURCES = normalizeGlobKeys(coreSources);
const FULL_KEYBOARD_FILES: readonly string[] = [1, 2, 4].map((n) => `test/invariants/invariant${n}-full-keyboard.property.test.ts`);
const MIN_RUNS = 100;
const EARLY_END_OPTIONS: readonly string[] = ["interruptAfterTimeLimit", "skipAllAfterTimeLimit", "endOnFailure", "timeout"];
/** Expected invariant files, the design property each one implements, and its timeout. */
const INVARIANT_FILES: readonly { file: string; property: number; timeout: number }[] = [
  ...["lockbox", "gearbox", "keyboard-fixture", "full-keyboard"].flatMap((kit) =>
    [
      { n: 1, property: 34 },
      { n: 2, property: 35 },
      { n: 4, property: 37 },
    ].map(({ n, property }) => ({
      file: `test/invariants/invariant${n}-${kit}.property.test.ts`,
      property,
      timeout: kit === "full-keyboard" ? 1_800_000 : 600_000,
    })),
  ),
  ...["dumbbell-ring", "ship-in-bottle"].map((cage) => ({ file: `test/invariants/invariant3-cages-${cage}.property.test.ts`, property: 36, timeout: 600_000 })),
];
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}
/** Value of an integer literal such as `100`, `1_800_000`, `0x1A2B3C4D`, or `null`. */
function integerLiteral(text: string): number | null {
  const match = /^(-?)(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*)$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const value = Number((match[2] ?? "").replace(/_/g, ""));
  return Number.isSafeInteger(value) ? (match[1] === "-" ? -value : value) : null;
}
/** Named top-level constants with an integer literal value. */
function literalConstants(code: string): Map<string, number> {
  const constants = new Map<string, number>();
  for (const match of code.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*([^;\n]+);?\s*$/gm)) {
    const value = integerLiteral(match[2] ?? "");
    if (value !== null && match[1] !== undefined) {
      constants.set(match[1], value);
    }
  }
  return constants;
}
/** `key: value` and shorthand `key` entries of an object literal body, in source order. */
function objectEntries(body: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [from, to] of splitTopLevel(body)) {
    const entry = body.slice(from, to).trim();
    if (entry === "") continue;
    const keyed = /^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/.exec(entry);
    const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(entry);
    if (keyed?.[1] !== undefined && keyed[2] !== undefined) entries.set(keyed[1], keyed[2].trim());
    else if (shorthand?.[1] !== undefined) entries.set(shorthand[1], shorthand[1]);
  }
  return entries;
}
function resolveInteger(expression: string, constants: ReadonlyMap<string, number>): number | null {
  const literal = integerLiteral(expression);
  if (literal !== null) {
    return literal;
  }
  return /^[A-Za-z_$][\w$]*$/.test(expression.trim()) ? (constants.get(expression.trim()) ?? null) : null;
}
interface AssertInfo {
  line: number;
  seed: number | null;
  numRuns: number | "FULL_KB_RUNS" | null;
}
/** Findings and the parsed options of every `fc.assert` call of one file. */
function analyzeFile(text: string): { findings: string[]; asserts: AssertInfo[] } {
  const code = blankLiterals(text);
  const constants = literalConstants(code);
  const findings: string[] = [];
  const asserts: AssertInfo[] = [];
  for (const call of findCalls(code, "\\bfc\\s*\\.\\s*assert")) {
    const line = lineOf(code, call.index);
    const ranges = splitTopLevel(call.args);
    const optionsRange = ranges[1];
    const options = optionsRange === undefined ? "" : call.args.slice(optionsRange[0], optionsRange[1]).trim();
    const info: AssertInfo = { line, seed: null, numRuns: null };
    asserts.push(info);
    if (!options.startsWith("{") || !options.endsWith("}")) {
      findings.push(`line ${line}: fc.assert has no object literal of options`);
      continue;
    }
    const entries = objectEntries(options.slice(1, -1));
    for (const key of EARLY_END_OPTIONS) {
      if (entries.has(key)) {
        findings.push(`line ${line}: option "${key}" can end a run early`);
      }
    }
    const seedExpression = entries.get("seed");
    info.seed = seedExpression === undefined ? null : resolveInteger(seedExpression, constants);
    if (seedExpression === undefined) {
      findings.push(`line ${line}: fc.assert has no seed`);
    } else if (info.seed === null) {
      findings.push(`line ${line}: seed "${seedExpression}" is not an integer literal or a named integer constant`);
    }
    const runsExpression = entries.get("numRuns");
    if (runsExpression === undefined) {
      findings.push(`line ${line}: fc.assert has no numRuns`);
    } else if (runsExpression === "FULL_KB_RUNS") {
      info.numRuns = "FULL_KB_RUNS";
    } else {
      info.numRuns = resolveInteger(runsExpression, constants);
      if (info.numRuns === null) {
        findings.push(`line ${line}: numRuns "${runsExpression}" is neither an integer literal nor FULL_KB_RUNS`);
      } else if (info.numRuns < MIN_RUNS) {
        findings.push(`line ${line}: numRuns ${info.numRuns} is below ${MIN_RUNS}`);
      }
    }
  }
  if (asserts.length === 0) {
    findings.push("the file has no fc.assert call");
  }
  return { findings, asserts };
}
/** Findings of the `FULL_KB_RUNS` rule for a set of property files. */
function fullKeyboardFindings(files: ReadonlyMap<string, string>): string[] {
  const findings: string[] = [];
  for (const [file, text] of files) {
    const mentions = /\bFULL_KB_RUNS\b/.test(blankLiterals(text));
    const allowed = FULL_KEYBOARD_FILES.includes(file);
    if (mentions && !allowed) {
      findings.push(`${file}: FULL_KB_RUNS is used outside the three Full_Keyboard invariant files`);
    }
    if (allowed && !analyzeFile(text).asserts.some((entry) => entry.numRuns === "FULL_KB_RUNS")) {
      findings.push(`${file}: the Full_Keyboard file does not use numRuns: FULL_KB_RUNS`);
    }
  }
  return findings;
}
/** Findings of the tag-comment and timeout rules for the invariant files present in `files`. */
function invariantFindings(files: ReadonlyMap<string, string>): string[] {
  const findings: string[] = [];
  for (const expected of INVARIANT_FILES) {
    const text = files.get(expected.file);
    if (text === undefined) {
      findings.push(`${expected.file}: the invariant file does not exist`);
      continue;
    }
    const tag = /^\s*\/\/ Feature: unbolt-core-engine, Property (\d+): \S/m.exec(text);
    if (tag === null || Number(tag[1]) !== expected.property) {
      findings.push(`${expected.file}: missing the tag "// Feature: unbolt-core-engine, Property ${expected.property}: <title>"`);
    }
    const timeout = literalConstants(blankLiterals(text)).get("TEST_TIMEOUT");
    if (timeout !== expected.timeout) {
      findings.push(`${expected.file}: TEST_TIMEOUT is ${String(timeout)}, expected ${expected.timeout}`);
    }
  }
  return findings;
}
describe("every property file declares a literal seed and a run count (Req 25.2)", () => {
  it("finds the property files of both packages, including the 14 invariant files", () => {
    expect(FILES.size).toBeGreaterThan(18);
    expect(FILES.has("test/properties/p18-pruning-soundness.property.test.ts")).toBe(true);
    expect([...FILES.keys()].some((file) => file.startsWith("sample-kits/test/"))).toBe(true);
    for (const expected of INVARIANT_FILES) {
      expect(FILES.has(expected.file), expected.file).toBe(true);
    }
  });
  it("gives every fc.assert a literal integer seed, at least 100 runs (or FULL_KB_RUNS), and no early end", () => {
    const findings: string[] = [];
    let asserts = 0;
    for (const [file, text] of FILES) {
      const result = analyzeFile(text);
      asserts += result.asserts.length;
      findings.push(...result.findings.map((finding) => `${file}: ${finding}`));
    }
    expect(asserts).toBeGreaterThanOrEqual(18);
    expect(findings).toEqual([]);
  });
  it("uses FULL_KB_RUNS only in the three Full_Keyboard invariant files, and in each of them", () => {
    expect(fullKeyboardFindings(FILES)).toEqual([]);
  });
  it("tags every invariant file with its property and gives it the documented timeout", () => {
    expect(invariantFindings(FILES)).toEqual([]);
  });
  it("keeps UNBOLT_FULL_KB_RUNS out of solver code (only the test helper reads it)", () => {
    expect(SOURCES.size).toBeGreaterThan(40);
    const readers = [...SOURCES].filter(([, text]) => text.includes("UNBOLT_FULL_KB_RUNS")).map(([file]) => file);
    expect(readers).toEqual([]);
  });
});
describe("the property-file scanner (guards against a vacuous pass)", () => {
  const analyze = (source: string): string[] => analyzeFile(source).findings;
  const withAssert = (options: string, prefix = ""): string => `${prefix}\nfc.assert(fc.property(arb, (x) => check(x)), ${options});`;
  it("accepts inline and named literal seeds and run counts", () => {
    expect(analyze(withAssert("{ seed: 42, numRuns: 100 }"))).toEqual([]);
    expect(analyze(withAssert("{ seed: 0x1A2B_3C4D, numRuns: 1_000 }"))).toEqual([]);
    expect(analyze(withAssert("{ seed: SEED, numRuns: NUM_RUNS }", "const SEED = 0x3a;\nconst NUM_RUNS = 250;"))).toEqual([]);
    expect(analyze(withAssert("{ seed: SEED, numRuns: FULL_KB_RUNS }", "const SEED = 7;"))).toEqual([]);
    expect(analyze(withAssert("{ seed, numRuns: 100 }", "const seed = 7;"))).toEqual([]);
  });
  it("rejects a missing or non-literal seed", () => {
    expect(analyze(withAssert("{ numRuns: 100 }")).join("\n")).toContain("no seed");
    expect(analyze(withAssert("{ seed: clockSeed, numRuns: 100 }")).join("\n")).toContain("not an integer literal");
    expect(analyze(withAssert("{ seed: SEED, numRuns: 100 }", "const SEED = compute();")).join("\n")).toContain("not an integer literal");
    expect(analyze(withAssert("{ seed: 1.5, numRuns: 100 }")).join("\n")).toContain("not an integer literal");
    expect(analyze("fc.assert(fc.property(arb, (x) => check(x)));").join("\n")).toContain("no object literal");
  });
  it("rejects a missing, small or non-literal numRuns", () => {
    expect(analyze(withAssert("{ seed: 1 }")).join("\n")).toContain("no numRuns");
    expect(analyze(withAssert("{ seed: 1, numRuns: 99 }")).join("\n")).toContain("below 100");
    expect(analyze(withAssert("{ seed: 1, numRuns: runs }")).join("\n")).toContain("neither an integer literal nor FULL_KB_RUNS");
    expect(analyze(withAssert("{ seed: 1, numRuns: 5 * 100 }")).join("\n")).toContain("neither an integer literal nor FULL_KB_RUNS");
  });
  it("rejects options that end a run early and files without any fc.assert", () => {
    expect(analyze(withAssert("{ seed: 1, numRuns: 100, interruptAfterTimeLimit: 1000 }")).join("\n")).toContain("can end a run early");
    expect(analyze(withAssert("{ seed: 1, numRuns: 100, endOnFailure: true }")).join("\n")).toContain("can end a run early");
    expect(analyze("const x = 1;").join("\n")).toContain("no fc.assert");
  });
  it("ignores fc.assert mentioned in comments and strings", () => {
    expect(analyze('// fc.assert(p, {});\nconst s = "fc.assert(p)";').join("\n")).toContain("no fc.assert");
  });
  it("flags FULL_KB_RUNS outside the allowed files and a Full_Keyboard file that does not use it", () => {
    const usesIt = withAssert("{ seed: 1, numRuns: FULL_KB_RUNS }");
    const plain = withAssert("{ seed: 1, numRuns: 100 }");
    expect(fullKeyboardFindings(new Map([["test/invariants/invariant1-lockbox.property.test.ts", usesIt]])).join("\n")).toContain("outside");
    expect(fullKeyboardFindings(new Map([[FULL_KEYBOARD_FILES[0] as string, plain]])).join("\n")).toContain("does not use numRuns");
    expect(fullKeyboardFindings(new Map([[FULL_KEYBOARD_FILES[0] as string, usesIt]]))).toEqual([]);
    expect(fullKeyboardFindings(new Map([["test/properties/p01.property.test.ts", "// FULL_KB_RUNS is only mentioned\n" + plain]]))).toEqual([]);
  });
  it("checks the tag comment and the timeout of an invariant file", () => {
    const [first] = INVARIANT_FILES;
    if (first === undefined) throw new Error("no invariant files are listed");
    const good = `// Feature: unbolt-core-engine, Property ${first.property}: some title\nconst TEST_TIMEOUT = ${first.timeout};`;
    const found = (text: string): string => invariantFindings(new Map([[first.file, text]])).filter((line) => line.startsWith(first.file)).join("\n");
    expect(found(good)).not.toContain("tag");
    expect(found(good)).not.toContain("TEST_TIMEOUT");
    expect(found(good.replace(`Property ${first.property}`, "Property 1"))).toContain("missing the tag");
    expect(found(good.replace(String(first.timeout), "5_000"))).toContain("TEST_TIMEOUT is 5000");
    expect(found("")).toContain("missing the tag");
  });
});
