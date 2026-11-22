/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { blankLiterals, findBannedSources, maskSource, normalizeGlobKeys, stringLiterals } from "../helpers/sourceScan";
/**
 * Determinism sources (Req 3.2, 22.9): neither package's `src/`, and no test file, may use
 * `Math.random`, `crypto`, `Date` or `performance.now`. The only randomness is the Seeded_PRNG in
 * `src/prng.ts`.
 *
 * Sources are read with Vite raw glob imports. Comments and the contents of strings and regex
 * literals are masked first, so a comment or a message that mentions a banned name is not a use.
 * The banned names below are written as fragments, so this file does not contain them either.
 */
const coreSrc = import.meta.glob("../../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const kitSrc = import.meta.glob("../../../sample-kits/src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const coreTests = import.meta.glob("../../test/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const kitTests = import.meta.glob("../../../sample-kits/test/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const SOURCES = normalizeGlobKeys({ ...coreSrc, ...kitSrc });
const TESTS = normalizeGlobKeys({ ...coreTests, ...kitTests });
// The glob never includes the importing file, so `no-trivial-assert.test.ts` scans this one.
const violations = findBannedSources;
describe("no unseeded randomness or clock in either package's src (Req 3.2, 22.9)", () => {
  it("loads the sources of both packages", () => {
    expect(SOURCES.size).toBeGreaterThan(40);
    expect(SOURCES.has("src/prng.ts")).toBe(true);
    expect([...SOURCES.keys()].some((file) => file.startsWith("sample-kits/src/"))).toBe(true);
  });
  it("uses none of the banned names in src", () => {
    expect(violations(SOURCES)).toEqual([]);
  });
});
describe("no unseeded randomness or clock in any test file (Req 3.2, 25.2)", () => {
  it("loads the test files of both packages", () => {
    expect(TESTS.size).toBeGreaterThan(30);
    expect(TESTS.has("test/static/purity.test.ts")).toBe(true);
    expect(TESTS.has("test/helpers/sourceScan.ts")).toBe(true);
    expect([...TESTS.keys()].some((file) => file.startsWith("sample-kits/test/"))).toBe(true);
  });
  it("uses none of the banned names in test code", () => {
    expect(violations(TESTS)).toEqual([]);
  });
});
describe("the scanner finds what it should and skips what it should (guards against a vacuous pass)", () => {
  const bad = (name: string): string => `const value = ${name};`;
  it("flags each banned use in code", () => {
    const samples = [
      bad("Math" + ".ran" + "dom()"),
      bad("cry" + "pto.getRan" + "domValues(new Uint8Array(1))"),
      bad("new Da" + "te().getTime()"),
      bad("Da" + "te.now()"),
      bad("perform" + "ance.no" + "w()"),
      bad("Math" + " . ran" + "dom ()"),
    ];
    for (const sample of samples) {
      expect(violations(new Map([["sample.ts", sample]])).length, sample).toBeGreaterThan(0);
    }
  });
  it("skips comments, strings, templates and regex literals, and unrelated words", () => {
    const harmless = [
      "// Math" + ".ran" + "dom is banned",
      "/* Da" + "te.now() */ const x = 1;",
      'const message = "do not call Math' + '.ran' + 'dom";',
      "const t = `uses ${1 + 1} cry" + "pto`;",
      "const r = /Da" + "te/g;",
      "const update = 1; const candidate = 2; const mandate = 3;",
      "const seeded = rng.next();",
    ];
    for (const sample of harmless) {
      expect(violations(new Map([["sample.ts", sample]])), sample).toEqual([]);
    }
  });
  it("reports the line of the first match", () => {
    const text = ["const a = 1;", "const b = 2;", "const c = Da" + "te.now();"].join("\n");
    expect(violations(new Map([["sample.ts", text]]))).toEqual(["sample.ts:3: Date (any use)"]);
  });
});
describe("the tokenizer behind the static scans", () => {
  it("keeps length and line breaks in both modes, for every project file", () => {
    for (const [file, text] of [...SOURCES, ...TESTS]) {
      for (const strings of ["keep", "blank"] as const) {
        const masked = maskSource(text, { strings });
        expect(masked.length, `${file} (${strings})`).toBe(text.length);
        expect(masked.split("\n").length, `${file} (${strings}) line count`).toBe(text.split("\n").length);
      }
    }
  });
  it("masks comments, strings, templates with nested expressions and regex literals", () => {
    const source = [
      'const a = "x//y"; // trailing',
      "const b = `t ${ { k: `inner ${1}` }.k } end`;",
      "const c = /[/]\\//g.test(a) / 2;",
      "/* block",
      "   comment */ const d = 'it\\'s';",
    ].join("\n");
    const blank = blankLiterals(source);
    expect(blank).not.toContain("trailing");
    expect(blank).not.toContain("inner");
    expect(blank).not.toContain("block");
    expect(blank).toContain("const c =");
    expect(blank).toContain(".test(a) / 2;");
    expect(blank.split("\n")[4]).toContain("const d =");
    const literals = stringLiterals(source).map((literal) => literal.content);
    expect(literals).toContain("x//y");
    expect(literals).toContain("it\\'s");
    expect(literals.some((content) => content.startsWith("t "))).toBe(true);
    expect(literals.some((content) => content.startsWith("inner "))).toBe(true);
  });
});
