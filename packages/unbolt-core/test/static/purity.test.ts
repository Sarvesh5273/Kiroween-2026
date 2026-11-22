/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  blankLiterals,
  extractSpecifiers,
  matchingBracket,
  normalizeGlobKeys,
  resolveRelative,
  stringLiterals,
  stripComments,
} from "../helpers/sourceScan";
import { KIT_CASES } from "../helpers/kitSet";
/**
 * Purity of the two packages (Req 1.1, 1.2, 1.7, 9.7, 15.6, 17.1, 22.3, 22.6).
 *
 * Sources and manifests are read with Vite raw glob imports, so the test needs no Node built-ins
 * and no `@types/node`. Comments and string contents are masked before any word scan, so a
 * comment that mentions `window` is not a use of `window`.
 */
const coreRaw = import.meta.glob("../../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const kitRaw = import.meta.glob("../../../sample-kits/src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const manifestRaw = import.meta.glob(["../../package.json", "../../../sample-kits/package.json"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const CORE = normalizeGlobKeys(coreRaw);
const KITS = normalizeGlobKeys(kitRaw);
const MANIFESTS = normalizeGlobKeys(manifestRaw);
const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);
function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || NODE_BUILTINS.has(specifier.split("/")[0] ?? "");
}
interface Manifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
function manifestOf(path: string): Manifest {
  const text = MANIFESTS.get(path);
  if (text === undefined) {
    throw new Error(`${path} was not loaded by the glob`);
  }
  return JSON.parse(text) as Manifest;
}
/** Package names a consumer must install: dependencies, peerDependencies and optionalDependencies. */
function runtimePackages(manifest: Manifest): string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ].sort();
}
/** Words that must not appear as identifiers in code. `.name` property accesses are not uses. */
function findForbiddenWords(source: string, words: readonly string[]): string[] {
  const code = blankLiterals(source);
  return words.filter((word) => new RegExp(`(?<![.\\w$])${word}(?![\\w$])`).test(code));
}
const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLCanvasElement",
  "OffscreenCanvas",
  "WebGLRenderingContext",
  "WebGL2RenderingContext",
];
/** Specifiers that are not `three`, `three-mesh-bvh` or a relative path. */
function foreignSpecifiers(source: string, allowed: ReadonlySet<string>): string[] {
  return extractSpecifiers(source).filter((specifier) => !specifier.startsWith(".") && !allowed.has(specifier));
}
describe("the glob loaded both packages", () => {
  it("finds the core and sample-kits sources and manifests", () => {
    expect(CORE.size).toBeGreaterThan(30);
    expect(KITS.size).toBeGreaterThan(5);
    expect(CORE.has("src/index.ts")).toBe(true);
    expect(KITS.has("sample-kits/src/index.ts")).toBe(true);
    expect([...MANIFESTS.keys()].sort()).toEqual(["package.json", "sample-kits/package.json"]);
    for (const file of CORE.keys()) expect(file.startsWith("src/"), file).toBe(true);
    for (const file of KITS.keys()) expect(file.startsWith("sample-kits/src/"), file).toBe(true);
  });
});
describe("manifest dependency sets (Req 1.1, 22.6)", () => {
  it("lists exactly three and three-mesh-bvh across the core dependencies and peerDependencies", () => {
    const manifest = manifestOf("package.json");
    expect(runtimePackages(manifest)).toEqual(["three", "three-mesh-bvh"]);
  });
  it("declares test-only packages in the core devDependencies only", () => {
    const manifest = manifestOf("package.json");
    for (const testOnly of ["fast-check", "vitest"]) {
      expect(Object.keys(manifest.devDependencies ?? {}), `${testOnly} is a devDependency`).toContain(testOnly);
      expect(runtimePackages(manifest), `${testOnly} is not a runtime dependency`).not.toContain(testOnly);
    }
    expect(Object.keys(manifest.devDependencies ?? {})).toContain("@types/three");
    expect(runtimePackages(manifest)).not.toContain("@types/three");
  });
  it("lists only three (and @types/three for types) as runtime packages of sample-kits", () => {
    const manifest = manifestOf("sample-kits/package.json");
    expect(runtimePackages(manifest).filter((name) => name !== "@types/three")).toEqual(["three"]);
    for (const testOnly of ["fast-check", "vitest"]) {
      expect(runtimePackages(manifest), `${testOnly} is not a runtime dependency`).not.toContain(testOnly);
    }
  });
});
describe("core src imports (Req 1.2, 1.7)", () => {
  const ALLOWED = new Set(["three", "three-mesh-bvh"]);
  it("imports only three, three-mesh-bvh and its own files", () => {
    const offenders: string[] = [];
    for (const [file, text] of CORE) {
      for (const specifier of foreignSpecifiers(text, ALLOWED)) offenders.push(`${file}: ${specifier}`);
      for (const specifier of extractSpecifiers(text)) {
        if (specifier.startsWith(".") && resolveRelative(file, specifier, CORE) === undefined) {
          offenders.push(`${file}: ${specifier} does not resolve to a core source file`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
  it("imports no Node built-in module and no node: specifier", () => {
    const offenders: string[] = [];
    for (const [file, text] of CORE) {
      for (const specifier of extractSpecifiers(text)) {
        if (isNodeBuiltin(specifier)) offenders.push(`${file}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("uses no DOM or WebGL global and no process", () => {
    const offenders: string[] = [];
    for (const [file, text] of CORE) {
      for (const word of findForbiddenWords(text, [...DOM_GLOBALS, "process", "require", "__dirname", "__filename"])) {
        offenders.push(`${file}: ${word}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("never reads userData (design R10)", () => {
    const offenders = [...CORE].filter(([, text]) => text.includes("userData")).map(([file]) => file);
    expect(offenders).toEqual([]);
  });
  it("detects the patterns it scans for", () => {
    const sample = ['import fs from "fs";', 'import { x } from "node:path";', 'import * as T from "three";', 'export { y } from "./y";'].join("\n");
    expect(extractSpecifiers(sample)).toEqual(["fs", "node:path", "three", "./y"]);
    expect(extractSpecifiers(sample).filter(isNodeBuiltin)).toEqual(["fs", "node:path"]);
    expect(foreignSpecifiers(sample, ALLOWED)).toEqual(["fs", "node:path"]);
    expect(findForbiddenWords("const a = window.innerWidth; // document\nconst s = 'navigator'; foo.process();", [...DOM_GLOBALS, "process"])).toEqual([
      "window",
    ]);
    expect(findForbiddenWords("typeof HTMLCanvasElement", DOM_GLOBALS)).toEqual(["HTMLCanvasElement"]);
  });
});
describe("no kit node-name literals in core src (Req 15.6)", () => {
  /** Role words of every mesh of every kit, built from the kits themselves, plus the documented set. */
  function kitRoles(): string[] {
    const roles = new Set<string>([
      "bottom_case",
      "top_frame",
      "pcb",
      "plate",
      "keycap",
      "switch",
      "case_screw",
      "sun_gear",
      "planet_gear",
      "carrier",
      "ring_gear",
      "housing",
      "housing_base",
      "housing_cover",
      "housing_fastener",
      "box_body",
      "lid",
      "clock_gear",
      "gear_spindle",
      "latch",
      "lid_fastener",
      "screw_standoff",
    ]);
    for (const kit of KIT_CASES) {
      kit.build().traverse((node) => {
        if ((node as { isMesh?: boolean }).isMesh === true) roles.add(node.name.replace(/_\d+$/, ""));
      });
    }
    return [...roles].sort();
  }
  function literalsNaming(source: string, roles: readonly string[]): string[] {
    const hits: string[] = [];
    for (const literal of stringLiterals(source)) {
      for (const role of roles) {
        if (new RegExp(`(?<![a-z0-9_-])${role}(?:_\\d+)?(?![a-z0-9_-])`).test(literal.content)) hits.push(`"${literal.content}" names ${role}`);
      }
    }
    return hits;
  }
  it("holds no string literal that names a kit Part category or a kit mesh", () => {
    const roles = kitRoles();
    expect(roles.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const [file, text] of CORE) {
      for (const hit of literalsNaming(text, roles)) offenders.push(`${file}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });
  it("finds a node-name literal when one is present", () => {
    expect(literalsNaming('if (name === "case_screw_2") {}', ["case_screw"])).toHaveLength(1);
    expect(literalsNaming('const s = "template"; // "pcb"', ["plate", "pcb"])).toEqual([]);
  });
});
describe("one source file per built-in primitive (Req 17.1)", () => {
  const BUILT_INS = ["linear_slide", "helical_unscrew", "two_step_l_slide"];
  const primitiveFiles = [...CORE].filter(([file]) => file.startsWith("src/primitives/"));
  function definitionsOf(name: string): string[] {
    return primitiveFiles
      .filter(([, text]) => new RegExp(`\\bname\\s*:\\s*["']${name}["']`).test(stripComments(text)))
      .map(([file]) => file);
  }
  it("defines each built-in in exactly one file under src/primitives, and no file defines two", () => {
    const owners = BUILT_INS.map((name) => definitionsOf(name));
    for (const [i, files] of owners.entries()) {
      expect(files, `files defining ${BUILT_INS[i]}`).toHaveLength(1);
    }
    expect(new Set(owners.flat()).size, "three different files").toBe(3);
  });
  it("defines no other primitive name in src/primitives", () => {
    const literalNames = primitiveFiles.flatMap(([file, text]) =>
      [...stripComments(text).matchAll(/\bname\s*:\s*["']([a-z][a-z0-9_]*)["']/g)].map((match) => `${file}: ${match[1]}`),
    );
    expect(literalNames.map((entry) => entry.split(": ")[1]).sort()).toEqual([...BUILT_INS].sort());
  });
});
describe("math/onb.ts inside stage1/ (Req 9.7)", () => {
  const stage1Files = [...CORE].filter(([file]) => file.startsWith("src/stage1/"));
  it("is imported by exactly one stage1 file, which calls it exactly once", () => {
    const importers = stage1Files
      .filter(([file, text]) => extractSpecifiers(text).some((specifier) => resolveRelative(file, specifier, CORE) === "src/math/onb.ts"))
      .map(([file]) => file);
    expect(importers).toEqual(["src/stage1/axisGenerator.ts"]);
    const calls = stage1Files.flatMap(([file, text]) =>
      [...blankLiterals(text).matchAll(/\borthonormalBasis\s*\(/g)].map((match) => `${file}@${match.index}`),
    );
    expect(calls).toHaveLength(1);
  });
  it("calls it only inside completeFrameF3, which runs only in the F3 branch after the collinearity check", () => {
    const source = CORE.get("src/stage1/axisGenerator.ts");
    if (source === undefined) throw new Error("axisGenerator.ts was not loaded");
    const code = blankLiterals(source);
    const declaration = /\bfunction\s+completeFrameF3\s*\(/.exec(code);
    expect(declaration, "completeFrameF3 is declared").not.toBeNull();
    const open = code.indexOf("{", code.indexOf(")", declaration?.index ?? 0));
    const close = matchingBracket(code, open);
    const call = /\borthonormalBasis\s*\(/.exec(code);
    expect(call?.index ?? -1).toBeGreaterThan(open);
    expect(call?.index ?? Number.POSITIVE_INFINITY).toBeLessThan(close);
    // The only call of completeFrameF3 (besides its declaration) follows the collinearity assertion
    // and records the F3 decision, inside one branch.
    const uses = [...code.matchAll(/\bcompleteFrameF3\s*\(/g)].filter((match) => match.index !== (declaration?.index ?? -1) + "function ".length);
    expect(uses).toHaveLength(1);
    const useIndex = uses[0]?.index ?? 0;
    const text = stripComments(source);
    expect(text.slice(Math.max(0, useIndex - 300), useIndex)).toContain("assertAllCollinearAssembly(");
    expect(text.slice(useIndex, useIndex + 300)).toContain('rule: "F3"');
    // The branch is guarded by the F3 direction found when F1 and F2 both fail.
    expect(text.slice(Math.max(0, useIndex - 400), useIndex)).toMatch(/if\s*\(\s*f3Direction\s*!==\s*null\s*\)\s*\{/);
  });
});
describe("sample-kits imports and I/O (Req 22.3, 22.6)", () => {
  const ALLOWED = new Set(["three"]);
  const IO_WORDS = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "localStorage",
    "sessionStorage",
    "readFile",
    "readFileSync",
    "writeFile",
    "writeFileSync",
    "TextureLoader",
    "FileLoader",
    "ImageLoader",
    "GLTFLoader",
    "FontLoader",
    "Image",
    "process",
    "require",
    ...DOM_GLOBALS,
  ];
  it("imports only three and its own files", () => {
    const offenders: string[] = [];
    for (const [file, text] of KITS) {
      for (const specifier of foreignSpecifiers(text, ALLOWED)) offenders.push(`${file}: ${specifier}`);
      for (const specifier of extractSpecifiers(text)) {
        if (specifier.startsWith(".") && resolveRelative(file, specifier, KITS) === undefined) {
          offenders.push(`${file}: ${specifier} does not resolve to a sample-kits source file`);
        }
      }
    }
    expect(offenders).toEqual([]);
    const all = [...KITS.values()].flatMap((text) => extractSpecifiers(text));
    expect(all, "the kits really import three").toContain("three");
    expect(all.some((specifier) => specifier.includes("three-bvh-csg"))).toBe(false);
  });
  it("makes no I/O call and uses no DOM global, loader or storage", () => {
    const offenders: string[] = [];
    for (const [file, text] of KITS) {
      for (const word of findForbiddenWords(text, IO_WORDS)) offenders.push(`${file}: ${word}`);
    }
    expect(offenders).toEqual([]);
  });
  it("detects I/O words it scans for", () => {
    expect(findForbiddenWords("const r = await fetch(url); new TextureLoader();", IO_WORDS)).toEqual(["fetch", "TextureLoader"]);
    expect(findForbiddenWords('// fetch\nconst s = "fetch";', IO_WORDS)).toEqual([]);
  });
});
