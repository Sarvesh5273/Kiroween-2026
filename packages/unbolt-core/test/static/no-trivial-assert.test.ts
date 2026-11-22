/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { blankLiterals, findCalls, matchingBracket, normalizeGlobKeys, splitTopLevel, stripComments } from "../helpers/sourceScan";
/**
 * No trivial assertions (Req 25.4, workspace rule "never write trivial assertions"). The scan
 * rejects, in every test file of both packages:
 *
 * - `expect(true)` and `expect(false)` with a literal boolean as the subject;
 * - `expect(x).toBe(x)`, `.toEqual(x)` and `.toStrictEqual(x)` where subject and expected value
 *   are the same call-free expression, so the assertion compares a value with itself;
 * - `fc.property(...)` and `fc.asyncProperty(...)` whose predicate is a constant: an empty body, or
 *   only `return true` (or another literal).
 *
 * Sources are read with Vite raw glob imports. Comments and string contents are masked before
 * the structure is parsed, so sample code inside a string is not a finding.
 */
const coreTests = import.meta.glob("../../test/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const kitTests = import.meta.glob("../../../sample-kits/test/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
// The glob never includes the importing file; `no-swallow.test.ts` is scanned here, and this
// file is checked by the sibling glob below.
const FILES = normalizeGlobKeys({ ...coreTests, ...kitTests });
const SIBLING = import.meta.glob("./no-swallow.test.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
interface Finding {
  line: number;
  rule: string;
  text: string;
}
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}
const SELF_COMPARING_MATCHERS = /^\s*\.\s*(toBe|toEqual|toStrictEqual)\s*\(/;
const LITERAL_VALUE = /^(?:true|false|null|undefined|-?\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?|(["'`])[^"'`]*\1)$/;
/** Findings of the `expect` rules in one file. */
function expectFindings(source: string): Finding[] {
  const code = blankLiterals(source);
  const kept = stripComments(source);
  const findings: Finding[] = [];
  for (const call of findCalls(code, "\\bexpect")) {
    const subject = kept.slice(call.argsStart, call.argsStart + call.args.length).replace(/\s+/g, "");
    if (/^(?:true|false)$/.test(subject)) {
      findings.push({ line: lineOf(code, call.index), rule: "literal boolean subject", text: `expect(${subject})` });
      continue;
    }
    const after = code.slice(call.argsStart + call.args.length + 1);
    const matcher = SELF_COMPARING_MATCHERS.exec(after);
    if (matcher === null || subject === "" || subject.includes("(")) {
      continue;
    }
    const open = call.argsStart + call.args.length + 1 + matcher[0].length - 1;
    const close = matchingBracket(code, open);
    if (close < 0) {
      throw new RangeError(`unbalanced matcher call on line ${lineOf(code, open)}`);
    }
    const expected = kept.slice(open + 1, close - 1).replace(/\s+/g, "");
    if (expected === subject) {
      findings.push({ line: lineOf(code, call.index), rule: "value compared with itself", text: `expect(${subject}).${matcher[1]}(${expected})` });
    }
  }
  return findings;
}
/** The body of a predicate argument as `{ block: boolean, text }`, or `null` for a non-function. */
function predicateBody(argument: string): { block: boolean; text: string } | null {
  const text = argument.trim().replace(/^async\s+/, "");
  let bodyStart: number;
  if (text.startsWith("function")) {
    const close = matchingBracket(text, text.indexOf("("));
    bodyStart = close < 0 ? -1 : close;
  } else {
    const arrow = text.indexOf("=>");
    bodyStart = arrow < 0 ? -1 : arrow + 2;
  }
  if (bodyStart < 0) {
    return null;
  }
  const body = text.slice(bodyStart).trim();
  if (body.startsWith("{")) {
    const close = matchingBracket(body, 0);
    return { block: true, text: body.slice(1, close < 0 ? body.length : close - 1).trim() };
  }
  return { block: false, text: body };
}
/** Findings of the constant-property rule in one file. */
function propertyFindings(source: string): Finding[] {
  const code = blankLiterals(source);
  const findings: Finding[] = [];
  for (const call of findCalls(code, "\\bfc\\s*\\.\\s*(?:property|asyncProperty)")) {
    const ranges = splitTopLevel(call.args);
    const last = ranges[ranges.length - 1];
    if (last === undefined) continue;
    const body = predicateBody(call.args.slice(last[0], last[1]));
    if (body === null) continue;
    const value = body.block ? /^return\s+([^;]*?)\s*;?$/.exec(body.text)?.[1] : body.text;
    const constant = (body.block && body.text === "") || (value !== undefined && LITERAL_VALUE.test(value.trim()));
    if (constant) {
      findings.push({ line: lineOf(code, call.index), rule: "constant property", text: body.text === "" ? "(empty body)" : body.text.slice(0, 60) });
    }
  }
  return findings;
}
function describeFindings(files: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [file, text] of files) {
    for (const finding of [...expectFindings(text), ...propertyFindings(text)]) {
      out.push(`${file}:${finding.line}: ${finding.rule}: ${finding.text}`);
    }
  }
  return out;
}
describe("no trivial assertions in any test file (Req 25.4)", () => {
  it("scans the tests of both packages and finds real assertions and properties", () => {
    expect(FILES.size).toBeGreaterThan(40);
    expect(FILES.has("test/unit/stage4.test.ts")).toBe(true);
    expect(FILES.has("test/properties/p18-pruning-soundness.property.test.ts")).toBe(true);
    expect(FILES.has("test/static/no-swallow.test.ts")).toBe(true);
    let expectCalls = 0;
    let propertyCalls = 0;
    for (const text of FILES.values()) {
      const code = blankLiterals(text);
      expectCalls += findCalls(code, "\\bexpect").length;
      propertyCalls += findCalls(code, "\\bfc\\s*\\.\\s*(?:property|asyncProperty)").length;
    }
    expect(expectCalls).toBeGreaterThan(500);
    expect(propertyCalls).toBeGreaterThanOrEqual(3);
  });
  it("contains no expect(true), no value compared with itself and no constant property", () => {
    expect(describeFindings(FILES)).toEqual([]);
  });
  it("also holds for this file", () => {
    const sibling = normalizeGlobKeys(SIBLING);
    expect([...sibling.keys()]).toEqual(["test/static/no-swallow.test.ts"]);
    expect(describeFindings(sibling)).toEqual([]);
  });
});
describe("the assertion scanner (guards against a vacuous pass)", () => {
  const found = (source: string): string[] => describeFindings(new Map([["sample.ts", source]])).map((line) => line.split(": ")[1] ?? "");
  it("flags literal booleans and self-comparisons", () => {
    expect(found("expect(true).toBe(true);")).toEqual(["literal boolean subject"]);
    expect(found("expect( false );")).toEqual(["literal boolean subject"]);
    expect(found("expect(value).toBe(value);")).toEqual(["value compared with itself"]);
    expect(found("expect(a.b[0]).toEqual( a.b[0] );")).toEqual(["value compared with itself"]);
    expect(found("expect(1).toStrictEqual(1);")).toEqual(["value compared with itself"]);
    expect(found("expect('x').toBe('x');")).toEqual(["value compared with itself"]);
  });
  it("accepts real comparisons, calls on both sides and sample code inside strings", () => {
    expect(found("expect(result).toBe(true);")).toEqual([]);
    expect(found("expect(a).toBe(b);")).toEqual([]);
    expect(found("expect('x').toBe('y');")).toEqual([]);
    expect(found("expect(solve(root)).toEqual(solve(root));")).toEqual([]);
    expect(found("expect(a).not.toBe(a);")).toEqual([]);
    expect(found("const sample = 'expect(true).toBe(true)'; // expect(a).toBe(a)")).toEqual([]);
  });
  it("flags properties whose predicate is a constant", () => {
    expect(found("fc.property(arb, () => true);")).toEqual(["constant property"]);
    expect(found("fc.property(arb, (x) => { return true; });")).toEqual(["constant property"]);
    expect(found("fc.property(arb, fc.context(), (x, ctx) => {});")).toEqual(["constant property"]);
    expect(found("fc.asyncProperty(arb, async function (x) { return false; });")).toEqual(["constant property"]);
    expect(found("fc.property(arb, () => 1);")).toEqual(["constant property"]);
  });
  it("accepts properties whose predicate depends on the generated value", () => {
    expect(found("fc.property(arb, (x) => solve(x).status === 'solved');")).toEqual([]);
    expect(found("fc.property(arb, (x) => { expect(solve(x).steps.length).toBe(x.n); return true; });")).toEqual([]);
    expect(found("fc.property(arb, check);")).toEqual([]);
    expect(found("fc.assert(fc.property(arb, (x) => { check(x); }), { seed: 1 });")).toEqual([]);
  });
});
