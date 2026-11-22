/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { blankLiterals, extractSpecifiers, findCalls, normalizeGlobKeys, resolveRelative } from "../helpers/sourceScan";
/**
 * One SE3_Arbitrary (Req 25.9). `test/arbitraries/se3.ts` is the only definition. The Invariant 1,
 * 2 and 3 files must import it and draw their SE3_Transforms from it, and no other file may
 * build an SE3 arbitrary of its own.
 *
 * An SE3 arbitrary here is a `fast-check` arbitrary of an SE3_Transform: a value with both a
 * `quaternion` and a `translation`. The scan flags a file other than `se3.ts` when
 *
 * - it types an arbitrary as `Arbitrary<Se3Transform>`, or
 * - one `fc.*` call in it names both a `quaternion` key and a `translation` key.
 *
 * Sources are read with Vite raw glob imports. Comments and the contents of string literals are
 * masked first.
 */
const coreTests = import.meta.glob("../../test/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const kitTests = import.meta.glob("../../../sample-kits/test/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
// The glob never includes the importing file. This file only mentions the scanned words inside
// strings and regular expressions, so leaving it out cannot hide a definition.
const FILES = normalizeGlobKeys({ ...coreTests, ...kitTests });
const SE3_MODULE = "test/arbitraries/se3.ts";
const SE3_EXPORT = "se3Arbitrary";
const INVARIANT_123 = /^test\/invariants\/invariant[123]-[a-z-]+\.property\.test\.ts$/;
/** Files that build an SE3 arbitrary, as `file: reason` lines. */
function builders(files: ReadonlyMap<string, string>): string[] {
  const found: string[] = [];
  for (const [file, text] of files) {
    if (file === SE3_MODULE) {
      continue;
    }
    const code = blankLiterals(text);
    if (/\bArbitrary\s*<\s*Se3Transform\b/.test(code)) {
      found.push(`${file}: declares an Arbitrary<Se3Transform>`);
    }
    for (const call of findCalls(code, "\\bfc\\s*\\.\\s*[A-Za-z]+")) {
      if (/\bquaternion\s*:/.test(call.args) && /\btranslation\s*:/.test(call.args)) {
        found.push(`${file}:${code.slice(0, call.index).split("\n").length}: an fc call names both quaternion and translation`);
      }
    }
  }
  return found;
}
/** Invariant 1, 2 and 3 files that do not import `se3.ts` or do not draw from `se3Arbitrary`. */
function missingImports(files: ReadonlyMap<string, string>): string[] {
  const found: string[] = [];
  for (const [file, text] of files) {
    if (!INVARIANT_123.test(file)) {
      continue;
    }
    const imported = extractSpecifiers(text).some((specifier) => specifier.startsWith(".") && resolveRelative(file, specifier, files) === SE3_MODULE);
    if (!imported) {
      found.push(`${file}: does not import ${SE3_MODULE}`);
      continue;
    }
    const code = blankLiterals(text);
    const draws = findCalls(code, "\\bfc\\s*\\.\\s*(?:property|asyncProperty)").some((call) => new RegExp(`\\b${SE3_EXPORT}\\b`).test(call.args));
    if (!draws) {
      found.push(`${file}: no fc.property or fc.asyncProperty draws from ${SE3_EXPORT}`);
    }
  }
  return found;
}
describe("the shared SE3_Arbitrary is the only one (Req 25.9)", () => {
  it("scans the test files of both packages and finds the shared module", () => {
    expect(FILES.size).toBeGreaterThan(60);
    expect(FILES.has(SE3_MODULE)).toBe(true);
    expect(FILES.get(SE3_MODULE)).toContain(`export const ${SE3_EXPORT}`);
  });
  it("is imported and used by all 10 Invariant 1, 2 and 3 files", () => {
    const invariantFiles = [...FILES.keys()].filter((file) => INVARIANT_123.test(file));
    expect(invariantFiles).toHaveLength(10);
    expect(missingImports(FILES)).toEqual([]);
  });
  it("is the only place that builds an SE3 arbitrary", () => {
    expect(builders(FILES)).toEqual([]);
  });
  it("is exported once, and every other file that uses it imports it from se3.ts", () => {
    const users = [...FILES].filter(([file, text]) => file !== SE3_MODULE && new RegExp(`\\b${SE3_EXPORT}\\b`).test(blankLiterals(text)));
    expect(users.length).toBeGreaterThanOrEqual(10);
    for (const [file, text] of users) {
      const imported = extractSpecifiers(text).some((specifier) => specifier.startsWith(".") && resolveRelative(file, specifier, FILES) === SE3_MODULE);
      expect(imported, `${file} uses ${SE3_EXPORT} without importing it from ${SE3_MODULE}`).toBe(true);
    }
  });
});
describe("the SE3 scanner (guards against a vacuous pass)", () => {
  const files = (entries: Record<string, string>): ReadonlyMap<string, string> => new Map(Object.entries(entries));
  it("flags a second SE3 arbitrary", () => {
    const own = "const own = fc.record({ quaternion: unitQuaternion, translation: fc.tuple(a, b, c) });";
    expect(builders(files({ "test/unit/own.test.ts": own })).join("\n")).toContain("names both quaternion and translation");
    const typed = "export const other: fc.Arbitrary<Se3Transform> = build();";
    expect(builders(files({ "test/arbitraries/other.ts": typed })).join("\n")).toContain("Arbitrary<Se3Transform>");
  });
  it("accepts se3.ts itself, a rotation-only arbitrary, and the words in comments or strings", () => {
    const own = "const own = fc.record({ quaternion: q, translation: t });";
    expect(builders(files({ [SE3_MODULE]: own }))).toEqual([]);
    expect(builders(files({ "test/arbitraries/layers.ts": "const r = fc.record({ rotation: q, layers: l });" }))).toEqual([]);
    expect(builders(files({ "test/unit/a.test.ts": "// fc.record({ quaternion: q, translation: t })\nconst s = 'quaternion: translation:';" }))).toEqual([]);
    expect(builders(files({ "test/arbitraries/assemblies.ts": "const r = fc.record({ se3: se3Arbitrary, parts: p });" }))).toEqual([]);
  });
  it("flags an invariant file that does not import or use the shared arbitrary", () => {
    const base = "test/invariants/invariant1-lockbox.property.test.ts";
    const good = `import { se3Arbitrary } from "../arbitraries/se3";\nfc.assert(fc.property(se3Arbitrary, (t) => check(t)), opts);`;
    const se3 = [SE3_MODULE, "export const se3Arbitrary = x;"] as const;
    expect(missingImports(files({ [base]: good, [se3[0]]: se3[1] }))).toEqual([]);
    expect(missingImports(files({ [base]: good.replace("fc.property(", "fc.asyncProperty("), [se3[0]]: se3[1] }))).toEqual([]);
    expect(missingImports(files({ [base]: good.replace("../arbitraries/se3", "../arbitraries/other"), [se3[0]]: se3[1] })).join("\n")).toContain("does not import");
    expect(missingImports(files({ [base]: good.replace("fc.property(se3Arbitrary,", "fc.property(fc.nat(),"), [se3[0]]: se3[1] })).join("\n")).toContain("no fc.property or fc.asyncProperty draws");
    // Invariant 4 does not draw SE3 transforms, so it is not required to import the module.
    expect(missingImports(files({ "test/invariants/invariant4-lockbox.property.test.ts": "const x = 1;" }))).toEqual([]);
  });
});
