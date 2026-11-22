/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * Req 20.11: the Clash_Checker shares no sampling code with the DBG_Builder. This test follows
 * the import specifiers of `src/oracle/clashChecker.ts` through every module it can reach and
 * fails if the stratified sampler, the Seeded_PRNG, the DBG hit filter or the DBG ray caster is
 * among them.
 *
 * Sources are read with Vite raw glob imports, so the test needs no Node built-ins and no
 * `@types/node`.
 */

const rawSources = import.meta.glob("../../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

/** Source text by project-relative path such as `src/oracle/clashChecker.ts`. */
const SOURCES: ReadonlyMap<string, string> = new Map(
  Object.entries(rawSources).map(([key, text]) => [key.replace(/^(\.\.\/)+/, ""), text]),
);

const ENTRY = "src/oracle/clashChecker.ts";
const FORBIDDEN = ["src/stage2/sampler.ts", "src/prng.ts", "src/stage2/hitFilter.ts", "src/stage2/rayCast.ts"] as const;
const ALLOWED_EXTERNALS = new Set(["three", "three-mesh-bvh"]);

/** Removes block and line comments, so a comment that mentions a module is not an import. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/.*$/gm, "$1");
}

/** Every module specifier of `import ... from`, `import "x"`, `export ... from` and `import("x")`. */
function extractSpecifiers(source: string): string[] {
  const text = stripComments(source);
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^;"']*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        specifiers.push(specifier);
      }
    }
  }
  return specifiers;
}

/** Joins a relative specifier onto the directory of `fromFile`, with `.` and `..` resolved. */
function joinPath(fromFile: string, specifier: string): string {
  const parts = fromFile.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") {
      continue;
    }
    if (segment === "..") {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

interface ImportGraph {
  /** Every module reachable from the entry, including the entry. */
  reachable: Set<string>;
  externals: Set<string>;
  unresolved: string[];
}

function walk(entry: string, sources: ReadonlyMap<string, string>): ImportGraph {
  const reachable = new Set<string>();
  const externals = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || reachable.has(file)) {
      continue;
    }
    reachable.add(file);
    const source = sources.get(file);
    if (source === undefined) {
      unresolved.push(file);
      continue;
    }
    for (const specifier of extractSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        externals.add(specifier);
        continue;
      }
      const base = joinPath(file, specifier);
      const resolved = [base, `${base}.ts`, `${base}/index.ts`].find((candidate) => sources.has(candidate));
      if (resolved === undefined) {
        unresolved.push(`${file} -> ${specifier}`);
      } else {
        queue.push(resolved);
      }
    }
  }
  return { reachable, externals, unresolved };
}

describe("Clash_Checker import isolation (Req 20.11)", () => {
  it("loads the project sources through the raw glob", () => {
    expect(SOURCES.has(ENTRY)).toBe(true);
    for (const forbidden of FORBIDDEN) {
      expect(SOURCES.has(forbidden), `${forbidden} should be present in the glob`).toBe(true);
    }
  });

  it("reaches none of the sampler, PRNG, DBG hit filter or DBG ray caster", () => {
    const graph = walk(ENTRY, SOURCES);
    expect(graph.unresolved).toEqual([]);
    for (const forbidden of FORBIDDEN) {
      expect(graph.reachable.has(forbidden), `${ENTRY} reaches ${forbidden}`).toBe(false);
    }
  });

  it("reaches no module of the pipeline stages, only types, config, errors and math helpers", () => {
    const allowed = new Set([
      ENTRY,
      "src/types.ts",
      "src/config.ts",
      "src/errors.ts",
      "src/math/vec3.ts",
      "src/math/aabb.ts",
    ]);
    const graph = walk(ENTRY, SOURCES);
    expect([...graph.reachable].filter((file) => !allowed.has(file)).sort()).toEqual([]);
    // The oracle really uses the box helpers, so the walk is not empty.
    expect(graph.reachable.has("src/math/aabb.ts")).toBe(true);
  });

  it("imports only three and three-mesh-bvh from outside the project", () => {
    const graph = walk(ENTRY, SOURCES);
    expect([...graph.externals].filter((specifier) => !ALLOWED_EXTERNALS.has(specifier))).toEqual([]);
    expect(graph.externals.has("three")).toBe(true);
  });

  it("never mentions the sampler or PRNG modules by name in its own imports", () => {
    const specifiers = extractSpecifiers(SOURCES.get(ENTRY) ?? "");
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier).not.toMatch(/sampler|prng|hitFilter|rayCast|stage2/);
    }
  });
});

describe("import walker (guards against a vacuous pass)", () => {
  it("finds the sampler, PRNG, hit filter and ray caster from the DBG_Builder", () => {
    const graph = walk("src/stage2/dbgBuilder.ts", SOURCES);
    expect(graph.unresolved).toEqual([]);
    for (const forbidden of FORBIDDEN) {
      expect(graph.reachable.has(forbidden), `walker misses ${forbidden} from the DBG_Builder`).toBe(true);
    }
  });

  it("follows transitive, re-export, side-effect and dynamic imports and skips comments", () => {
    const synthetic = new Map<string, string>([
      ["src/a.ts", `import type { X } from "./b";\n// import "./never";\n/* import "./never2"; */\nconst url = "http://example.com";`],
      ["src/b.ts", `export * from "./sub/c";\nexport { y } from "../src/d.ts";`],
      ["src/sub/c.ts", `import "./e";\nconst lazy = () => import("../f");`],
      ["src/sub/e.ts", `import * as THREE from "three";`],
      ["src/f.ts", ""],
      ["src/d.ts", ""],
      ["src/never.ts", ""],
      ["src/never2.ts", ""],
    ]);
    const graph = walk("src/a.ts", synthetic);
    expect([...graph.reachable].sort()).toEqual(["src/a.ts", "src/b.ts", "src/d.ts", "src/f.ts", "src/sub/c.ts", "src/sub/e.ts"]);
    expect([...graph.externals]).toEqual(["three"]);
    expect(graph.unresolved).toEqual([]);
  });

  it("reports an import that cannot be resolved", () => {
    const graph = walk("src/a.ts", new Map([["src/a.ts", `import { x } from "./missing";`]]));
    expect(graph.unresolved).toEqual(["src/a.ts -> ./missing"]);
  });
});

describe("library query options in src/", () => {
  it("no source file names a nearest-hit-only query option (Req 13.5, 20.8)", () => {
    // Built from parts so this test file does not contain the tokens itself.
    const banned = ["first" + "HitOnly", "raycast" + "First"];
    const offenders: string[] = [];
    for (const [file, text] of SOURCES) {
      for (const token of banned) {
        if (text.includes(token)) {
          offenders.push(`${file}: ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
