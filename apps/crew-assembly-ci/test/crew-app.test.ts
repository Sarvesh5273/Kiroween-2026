import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DisassemblyManifest, ManifestScc } from "../src/manifestTypes.js";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(appRoot, "..", "..");
const path = (...parts: string[]): string => join(appRoot, ...parts);
const readJson = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

let workDir = "";

beforeAll(() => {
  // `dist/` is not committed, so build once when a fresh checkout runs the tests.
  if (!existsSync(path("dist", "engine.mjs")) || !existsSync(path("ui", "dist", "index.mjs"))) {
    execFileSync("npm", ["run", "build"], { cwd: appRoot, stdio: "pipe" });
  }
  workDir = mkdtempSync(join(tmpdir(), "crew-assembly-ci-"));
});

afterAll(() => {
  if (workDir !== "") {
    rmSync(workDir, { recursive: true, force: true });
  }
});

interface AuditRun {
  status: number | null;
  stdout: string;
  stderr: string;
  manifest: DisassemblyManifest | null;
}

function runAudit(name: string, args: string[]): AuditRun {
  const out = join(workDir, `${name}.json`);
  const result = spawnSync(process.execPath, [path("scripts", "run-audit.mjs"), ...args, "--out", out], {
    cwd: appRoot,
    encoding: "utf8",
  });
  const manifest = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as DisassemblyManifest) : null;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, manifest };
}

function requireManifest(run: AuditRun): DisassemblyManifest {
  expect(run.manifest, `no manifest written. stderr: ${run.stderr}`).not.toBeNull();
  return run.manifest as DisassemblyManifest;
}

/** True when every member of the SCC can reach every other member along the witness edges. */
function isStronglyConnected(scc: ManifestScc): boolean {
  const members = new Set(scc.partIds);
  const next = new Map<string, string[]>();
  for (const edge of scc.edges) {
    expect(members.has(edge.from) && members.has(edge.to), "witness edge leaves the SCC").toBe(true);
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
  }
  return scc.partIds.every((start) => {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      for (const to of next.get(queue.shift() as string) ?? []) {
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return seen.size === members.size;
  });
}

describe("app.json", () => {
  const app = readJson(path("app.json"));

  it("has the required manifest fields", () => {
    expect(app["name"]).toBe("crew-assembly-ci");
    expect(app["version"]).toBe("0.1.0");
    expect(app["displayName"]).toBe("UnboltKit Assembly CI");
    expect(typeof app["description"]).toBe("string");
    expect(app["iconPath"]).toBe("assets/icon.png");
    expect(app["agents"]).toEqual(["agents/assembly-auditor.json"]);
    expect(app["skills"]).toEqual(["skills/assembly-ci-audit"]);
    expect(app["ui"]).toEqual({
      entry: "ui/dist/index.mjs",
      pages: [{ route: "/apps/crew-assembly-ci", label: "Assembly CI", icon: "Wrench" }],
    });
    expect(Array.isArray(app["permissions"])).toBe(true);
    expect((app["permissions"] as unknown[]).length).toBeGreaterThan(0);
  });

  it("points every path at a file or folder that exists", () => {
    for (const key of ["iconPath"] as const) {
      expect(existsSync(path(app[key] as string))).toBe(true);
    }
    for (const agent of app["agents"] as string[]) {
      expect(existsSync(path(agent))).toBe(true);
    }
    for (const skill of app["skills"] as string[]) {
      expect(existsSync(path(skill, "SKILL.md"))).toBe(true);
    }
  });
});

describe("assets/icon.png", () => {
  const png = readFileSync(path("assets", "icon.png"));

  it("starts with the PNG magic bytes and is 256x256 RGBA", () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(256);
    expect(png.readUInt32BE(20)).toBe(256);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    expect(png.length).toBeGreaterThan(1000);
  });

  it("has a pixel payload that inflates to exactly 256 filtered RGBA rows and ends with IEND", () => {
    const idat: Buffer[] = [];
    const types: string[] = [];
    for (let offset = 8; offset < png.length; ) {
      const length = png.readUInt32BE(offset);
      const type = png.subarray(offset + 4, offset + 8).toString("ascii");
      types.push(type);
      if (type === "IDAT") {
        idat.push(png.subarray(offset + 8, offset + 8 + length));
      }
      offset += 12 + length;
    }
    expect(types[0]).toBe("IHDR");
    expect(types[types.length - 1]).toBe("IEND");
    expect(inflateSync(Buffer.concat(idat)).length).toBe((256 * 4 + 1) * 256);
  });
});

describe("agents/assembly-auditor.json", () => {
  const agent = readJson(path("agents", "assembly-auditor.json"));
  const prompt = agent["prompt"] as string;

  it("registers the cad-assembly-auditor MCP server that exists in the workspace", () => {
    const servers = agent["mcpServers"] as Record<string, { command: string; args: string[] }>;
    const server = servers["cad-assembly-auditor"];
    expect(server).toBeDefined();
    expect(server?.command).toBe("node");
    expect(existsSync(join(repoRoot, "tools", "cad-auditor-mcp", "src", "server.ts"))).toBe(true);
    expect(server?.args).toEqual(["tools/cad-auditor-mcp/dist/server.js"]);
    expect(agent["tools"]).toContain("@cad-assembly-auditor");
  });

  it("calls both MCP tools, alerts on both regressions and emits the manifest", () => {
    expect(agent["name"]).toBe("assembly-auditor");
    for (const phrase of ["inspect_assembly_dbg", "diff_repairability", "Tarjan", "repairability", "disassembly-manifest.json", ".glb"]) {
      expect(prompt, phrase).toContain(phrase);
    }
  });

  it("watches .glb files at session start", () => {
    const hooks = agent["hooks"] as { trigger: string; action: { command: string } }[];
    expect(hooks.some((hook) => hook.trigger === "SessionStart" && hook.action.command.includes("*.glb"))).toBe(true);
  });
});

describe("skills/assembly-ci-audit/SKILL.md", () => {
  const skill = readFileSync(path("skills", "assembly-ci-audit", "SKILL.md"), "utf8");

  it("has front matter whose name matches the folder", () => {
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toMatch(/^name: assembly-ci-audit$/m);
    expect(skill).toMatch(/^description: .+/m);
  });

  it("covers deadlock triage, depth diffing and manifest generation", () => {
    for (const heading of ["## 1. Deadlock cycle triage", "## 2. Repairability depth diffing", "## 3. Manifest generation"]) {
      expect(skill).toContain(heading);
    }
    for (const phrase of ["inspect_assembly_dbg", "diff_repairability", "run-audit.mjs", "disassembly-manifest.json", "deadlockWitness"]) {
      expect(skill, phrase).toContain(phrase);
    }
  });
});

describe("ui/dist/index.mjs", () => {
  const bundle = readFileSync(path("ui", "dist", "index.mjs"), "utf8");

  it("imports the SDK, React and the JSX runtime from the host and does not bundle them", () => {
    for (const specifier of ["@kirocrew/app-sdk", "@kirocrew/app-sdk/ui", "react", "react/jsx-runtime"]) {
      expect(bundle, specifier).toMatch(new RegExp(`from\\s*["']${specifier.replace(/[/.]/g, "\\$&")}["']`));
    }
    expect(bundle).not.toMatch(/function useAppApi|function useAppEvents|const useAppApi\s*=/);
    expect(bundle).not.toContain("__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED");
    expect(bundle).not.toContain("react.transitional.element");
  });

  it("is a small ESM module with a default export", () => {
    expect(statSync(path("ui", "dist", "index.mjs")).size).toBeLessThan(80 * 1024);
    expect(bundle).toMatch(/export\s*\{[^}]*\bas default\b/);
  });

  it("does not install @kirocrew/app-sdk anywhere", () => {
    const uiPackage = readFileSync(path("ui", "package.json"), "utf8");
    const appPackage = readFileSync(path("package.json"), "utf8");
    const dependencyBlocks = (text: string): string =>
      JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text) as Record<string, unknown>).filter(([key]) => /ependencies/.test(key))));
    expect(dependencyBlocks(uiPackage)).not.toContain("@kirocrew");
    expect(dependencyBlocks(appPackage)).not.toContain("@kirocrew");
    expect(existsSync(join(repoRoot, "node_modules", "@kirocrew"))).toBe(false);
  });
});

describe("scripts/run-audit.mjs", () => {
  it("exits 2 with usage when no mode is given", () => {
    const run = runAudit("usage", []);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Choose exactly one mode");
    expect(run.manifest).toBeNull();
  });

  it("passes haunted-clockwork-lockbox with a collision-free plan", () => {
    const run = runAudit("lockbox", ["--kit", "haunted-clockwork-lockbox"]);
    expect(run.status, run.stderr).toBe(0);
    const manifest = requireManifest(run);
    const { assembly } = manifest;
    expect(manifest.schema).toBe("unboltkit.disassembly-manifest/v1");
    expect(Number.isNaN(Date.parse(manifest.generatedAt))).toBe(false);
    expect(manifest.mode).toBe("audit");
    expect(manifest.verdict.ci).toBe("pass");
    expect(assembly.status).toBe("solved");
    expect(assembly.deadlock).toBeNull();
    // Independent oracle: replaying the plan finds no collision, and the naive explode never does better.
    expect(assembly.clashes.oracle).toBe(0);
    expect(assembly.clashes.naive).toBeGreaterThanOrEqual(assembly.clashes.oracle);
    expect(assembly.clashes.avoidedByPlan).toBe(assembly.clashes.naive - assembly.clashes.oracle);
    // Valid removal order: every part removed exactly once, with depths 1..n in sequence.
    const depths = assembly.repairability.steps.map((step) => step.depth);
    expect(depths).toEqual(depths.map((_, index) => index + 1));
    expect(new Set(assembly.repairability.steps.map((step) => step.partId)).size).toBe(assembly.partCount);
    expect(assembly.repairability.maxDepth).toBe(assembly.partCount);
    expect(run.stdout).toContain("CI verdict: PASS");
  });

  it("fails deadlock-cage-dumbbell-ring and writes a Tarjan SCC witness", () => {
    const run = runAudit("cage", ["--kit", "deadlock-cage-dumbbell-ring"]);
    expect(run.status, run.stderr).toBe(1);
    const manifest = requireManifest(run);
    const deadlock = manifest.assembly.deadlock;
    expect(manifest.verdict.ci).toBe("fail");
    expect(manifest.assembly.status).toBe("deadlocked");
    expect(deadlock).not.toBeNull();
    expect(deadlock?.sccs.length).toBeGreaterThan(0);
    for (const scc of deadlock?.sccs ?? []) {
      expect(scc.partIds.length).toBeGreaterThanOrEqual(2);
      expect(scc.names).toHaveLength(scc.partIds.length);
      expect(isStronglyConnected(scc)).toBe(true);
    }
    // A deadlocked part is never given a removal step.
    const removed = new Set(manifest.assembly.repairability.steps.map((step) => step.partId));
    for (const scc of deadlock?.sccs ?? []) {
      for (const partId of scc.partIds) {
        expect(removed.has(partId)).toBe(false);
      }
    }
    expect(manifest.verdict.summary).toContain("Tarjan SCC");
    expect(run.stdout).toContain("Tarjan SCC deadlock");
    expect(run.stdout).toContain("CI verdict: FAIL");
  });

  it("reports an unknown kit as an audit error with a non-zero exit", () => {
    const run = runAudit("unknown", ["--kit", "no-such-kit"]);
    expect(run.status).toBe(1);
    const manifest = requireManifest(run);
    expect(manifest.assembly.status).toBe("error");
    expect(manifest.assembly.error?.message).toContain("Unknown kitName");
    expect(manifest.verdict.ci).toBe("fail");
  });

  it("diffs a candidate against a baseline and fails on a new deadlock", () => {
    const run = runAudit("diff-regression", ["--baseline", "haunted-clockwork-lockbox", "--candidate", "deadlock-cage-dumbbell-ring"]);
    expect(run.status, run.stderr).toBe(1);
    const manifest = requireManifest(run);
    expect(manifest.mode).toBe("diff");
    expect(manifest.diff?.baseline.status).toBe("solved");
    expect(manifest.diff?.newlyDeadlocked).toBe(true);
    expect(manifest.diff?.newSccs.length).toBeGreaterThan(0);
    expect(manifest.verdict.ci).toBe("fail");
  });

  it("diffs a kit against itself with no regressions", () => {
    const run = runAudit("diff-same", ["--baseline", "haunted-clockwork-lockbox", "--candidate", "haunted-clockwork-lockbox"]);
    expect(run.status, run.stderr).toBe(0);
    const manifest = requireManifest(run);
    expect(manifest.diff?.deadlockRegressed).toBe(false);
    expect(manifest.diff?.depthRegressions).toEqual([]);
    expect(manifest.verdict.ci).toBe("pass");
  });
});
