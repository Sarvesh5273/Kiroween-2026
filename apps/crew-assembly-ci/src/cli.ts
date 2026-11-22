/**
 * Command line logic of `scripts/run-audit.mjs`.
 *
 * Exit codes: 0 the CI verdict is pass, 1 the verdict is fail (deadlock, regression, oracle
 * clash or audit error), 2 bad usage or the manifest could not be written.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { diffRepairability, inspectAssemblyDbg, listSampleKits } from "@unboltkit/cad-auditor-mcp/src/auditor.js";
import type { AssemblySource } from "@unboltkit/cad-auditor-mcp/src/auditor.js";
import { buildAuditManifest, buildDiffManifest } from "./manifest.js";
import type { DisassemblyManifest } from "./manifestTypes.js";
import { groupSccEdges } from "./sccEdges.js";

export const DEFAULT_MANIFEST_NAME = "disassembly-manifest.json";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  now: () => Date;
  cwd: string;
}

export const USAGE = `Usage: node scripts/run-audit.mjs <mode> [options]

Modes (give exactly one):
  --kit <name>                      Audit a bundled sample kit.
  --glb <path>                      Audit a .glb file.
  --baseline <kit|.glb> --candidate <kit|.glb>
                                    Diff a candidate against a baseline. A value that ends
                                    in .glb is a file path, anything else is a kit name.

Options:
  --out <path>                      Manifest path. Default: ./${DEFAULT_MANIFEST_NAME}
  --fail-on-depth-regression        Also fail when a part needs more removals before it than in the baseline.
  --quiet                           Print only the one-line verdict.
  --list-kits                       List the bundled sample kits and exit.
  --help                            Show this text.

Exit code: 0 pass, 1 CI fail (deadlock, regression, oracle clash or audit error), 2 usage error.
`;

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

interface Options {
  kit: string | undefined;
  glb: string | undefined;
  baseline: string | undefined;
  candidate: string | undefined;
  out: string;
  failOnDepthRegression: boolean;
  quiet: boolean;
  listKits: boolean;
  help: boolean;
}

function parseOptions(argv: readonly string[], cwd: string): Options {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        kit: { type: "string" },
        glb: { type: "string" },
        baseline: { type: "string" },
        candidate: { type: "string" },
        out: { type: "string" },
        "fail-on-depth-regression": { type: "boolean", default: false },
        quiet: { type: "boolean", default: false },
        "list-kits": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    }));
  } catch (cause) {
    throw new UsageError(cause instanceof Error ? cause.message : String(cause));
  }
  return {
    kit: values.kit,
    glb: values.glb,
    baseline: values.baseline,
    candidate: values.candidate,
    out: resolve(cwd, values.out ?? DEFAULT_MANIFEST_NAME),
    failOnDepthRegression: values["fail-on-depth-regression"] === true,
    quiet: values.quiet === true,
    listKits: values["list-kits"] === true,
    help: values.help === true,
  };
}

function toSource(value: string): AssemblySource {
  return value.toLowerCase().endsWith(".glb") ? { glbPath: value } : { kitName: value };
}

/** Resolves a relative `.glb` path against the caller's directory, not the script's. */
function anchor(source: AssemblySource, cwd: string): AssemblySource {
  return source.glbPath === undefined ? source : { glbPath: resolve(cwd, source.glbPath) };
}

function modeOf(options: Options): "kit" | "glb" | "diff" {
  const diff = options.baseline !== undefined || options.candidate !== undefined;
  const chosen = [options.kit !== undefined, options.glb !== undefined, diff].filter(Boolean).length;
  if (chosen !== 1) {
    throw new UsageError("Choose exactly one mode: --kit, --glb, or --baseline with --candidate.");
  }
  if (diff && (options.baseline === undefined || options.candidate === undefined)) {
    throw new UsageError("Diff mode needs both --baseline and --candidate.");
  }
  return options.kit !== undefined ? "kit" : options.glb !== undefined ? "glb" : "diff";
}

function formatDir(dir: readonly number[]): string {
  return `(${dir.map((value) => value.toFixed(2)).join(", ")})`;
}

function describe(manifest: DisassemblyManifest): string {
  const { assembly, diff, verdict } = manifest;
  const lines: string[] = [];
  lines.push(`Assembly: ${assembly.source.name} (${assembly.source.kind})`);
  lines.push(`Status:   ${assembly.status}, ${assembly.partCount} parts, ${assembly.totalTriangles} triangles`);
  lines.push(
    `Clashes:  oracle ${assembly.clashes.oracle} vs naive radial ${assembly.clashes.naive} ` +
      `(${assembly.clashes.naiveObstructedParts} parts obstructed, ${assembly.clashes.avoidedByPlan} avoided)`,
  );
  lines.push(`Depth:    ${assembly.repairability.steps.length} parts removed, max repairability depth ${assembly.repairability.maxDepth}`);
  for (const scc of assembly.deadlock?.sccs ?? []) {
    lines.push(`Tarjan SCC deadlock: {${scc.names.join(", ")}}`);
    for (const group of groupSccEdges(scc)) {
      lines.push(
        `  ${group.fromName} is blocked by ${group.toName} in ${group.directionCount} direction${group.directionCount === 1 ? "" : "s"}, e.g. ${formatDir(group.sampleDir)}`,
      );
    }
  }
  if (diff !== null) {
    lines.push(`Baseline: ${diff.baseline.source.name} is ${diff.baseline.status}`);
    for (const change of diff.depthRegressions) {
      lines.push(`Depth regression: ${change.name} ${change.baselineDepth ?? "none"} -> ${change.candidateDepth ?? "stuck"}`);
    }
  }
  for (const warning of verdict.warnings) {
    lines.push(`Warning: ${warning}`);
  }
  return lines.join("\n");
}

function runMode(mode: "kit" | "glb" | "diff", options: Options, generatedAt: string, cwd: string): DisassemblyManifest {
  if (mode === "diff") {
    const baseline = anchor(toSource(options.baseline ?? ""), cwd);
    const candidate = anchor(toSource(options.candidate ?? ""), cwd);
    const diff = diffRepairability({ baseline, candidate });
    return buildDiffManifest(inspectAssemblyDbg(candidate), diff, generatedAt, {
      failOnDepthRegression: options.failOnDepthRegression,
    });
  }
  const source = anchor(mode === "kit" ? { kitName: options.kit } : { glbPath: options.glb }, cwd);
  return buildAuditManifest(inspectAssemblyDbg(source), generatedAt);
}

export function runCli(argv: readonly string[], io: CliIo): number {
  let options: Options;
  let mode: "kit" | "glb" | "diff";
  try {
    options = parseOptions(argv, io.cwd);
    if (options.help) {
      io.stdout(USAGE);
      return 0;
    }
    if (options.listKits) {
      for (const kit of listSampleKits()) {
        io.stdout(`${kit.name}  (${kit.category})\n`);
      }
      return 0;
    }
    mode = modeOf(options);
  } catch (cause) {
    if (cause instanceof UsageError) {
      io.stderr(`${cause.message}\n\n${USAGE}`);
      return 2;
    }
    throw cause;
  }

  const manifest = runMode(mode, options, io.now().toISOString(), io.cwd);
  try {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (cause) {
    io.stderr(`Could not write ${options.out}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }

  if (!options.quiet) {
    io.stdout(`${describe(manifest)}\n`);
  }
  io.stdout(`CI verdict: ${manifest.verdict.summary}\n`);
  io.stdout(`Manifest written to ${options.out}\n`);
  return manifest.verdict.ci === "pass" ? 0 : 1;
}
