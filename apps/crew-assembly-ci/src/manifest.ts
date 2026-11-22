/**
 * Pure builders that turn auditor results into `disassembly-manifest.json`.
 *
 * Nothing here reads the clock, the disk or the environment. The caller passes `generatedAt`, so
 * the same audit always gives the same manifest.
 */
import type { AssemblyAudit, RepairabilityDiff } from "@unboltkit/cad-auditor-mcp/src/auditor.js";
import { MANIFEST_SCHEMA } from "./manifestTypes.js";
import type {
  DisassemblyManifest,
  ManifestAssembly,
  ManifestDeadlock,
  ManifestDiff,
  ManifestVerdict,
} from "./manifestTypes.js";

export const TOOL_INFO = Object.freeze({ name: "crew-assembly-ci", version: "0.1.0" });

export interface VerdictOptions {
  /** Treat any per-part repairability depth regression as a CI failure. Off by default. */
  failOnDepthRegression?: boolean;
}

export function buildAssembly(audit: AssemblyAudit): ManifestAssembly {
  const steps = audit.steps.map((step) => ({
    depth: step.repairabilityDepth,
    partId: step.partId,
    name: step.name,
    primitive: step.primitive,
  }));
  let deadlock: ManifestDeadlock | null = null;
  if (audit.deadlockWitness !== undefined) {
    deadlock = {
      sccs: audit.deadlockWitness.sccs.map((scc) => {
        const nameOf = new Map(scc.partIds.map((id, index) => [id, scc.names[index] ?? id]));
        return {
          partIds: scc.partIds.slice(),
          names: scc.names.slice(),
          edges: scc.edges.map((edge) => ({
            from: edge.from,
            to: edge.to,
            fromName: nameOf.get(edge.from) ?? edge.from,
            toName: nameOf.get(edge.to) ?? edge.to,
            dir: [edge.dir[0], edge.dir[1], edge.dir[2]] as [number, number, number],
          })),
        };
      }),
      blockedByCycle: audit.deadlockWitness.unassigned.map((entry) => ({ partId: entry.partId, name: entry.name })),
    };
  }
  return {
    source: { ...audit.source },
    status: audit.status,
    partCount: audit.partCount,
    totalTriangles: audit.totalTriangles,
    polyBudgetExceeded: audit.polyBudgetExceeded,
    clashes: {
      oracle: audit.oracleTotalClashes,
      naive: audit.naiveTotalClashes,
      naiveObstructedParts: audit.naiveObstructedParts,
      avoidedByPlan: audit.naiveTotalClashes - audit.oracleTotalClashes,
    },
    repairability: { maxDepth: steps.length === 0 ? 0 : Math.max(...steps.map((step) => step.depth)), steps },
    deadlock,
    error: audit.error === undefined ? null : { kind: audit.error.kind, message: audit.error.message },
  };
}

function describeSccs(assembly: ManifestAssembly): string {
  const sccs = assembly.deadlock?.sccs ?? [];
  const list = sccs.map((scc) => `{${scc.names.join(", ")}}`).join(" ");
  return `${sccs.length} Tarjan SCC deadlock${sccs.length === 1 ? "" : "s"} ${list}`.trim();
}

function finish(reasons: string[], warnings: string[], passMessage: string): ManifestVerdict {
  const ci = reasons.length === 0 ? "pass" : "fail";
  return {
    ci,
    summary: ci === "pass" ? passMessage : `FAIL: ${reasons.join(" ")}`,
    reasons,
    warnings,
  };
}

/** Verdict for one assembly with no baseline: it must be solved, and the oracle must find 0 clashes. */
export function auditVerdict(assembly: ManifestAssembly): ManifestVerdict {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (assembly.error !== null) {
    reasons.push(`Audit error ${assembly.error.kind}: ${assembly.error.message}`);
  } else if (assembly.status === "deadlocked") {
    reasons.push(`Deadlock: ${describeSccs(assembly)}.`);
  }
  if (assembly.status !== "error" && assembly.clashes.oracle > 0) {
    reasons.push(`The clash oracle found ${assembly.clashes.oracle} collisions in the removal plan.`);
  }
  if (assembly.polyBudgetExceeded) {
    warnings.push("The triangle budget was exceeded, so the engine sampled and the result is approximate.");
  }
  return finish(reasons, warnings, `PASS: solved in ${assembly.repairability.maxDepth} steps with 0 oracle clashes.`);
}

export function buildAuditManifest(audit: AssemblyAudit, generatedAt: string): DisassemblyManifest {
  const assembly = buildAssembly(audit);
  return {
    schema: MANIFEST_SCHEMA,
    generatedAt,
    tool: { ...TOOL_INFO },
    mode: "audit",
    assembly,
    diff: null,
    verdict: auditVerdict(assembly),
  };
}

export function buildDiffManifest(
  candidate: AssemblyAudit,
  diff: RepairabilityDiff,
  generatedAt: string,
  options: VerdictOptions = {},
): DisassemblyManifest {
  const assembly = buildAssembly(candidate);
  const manifestDiff: ManifestDiff = {
    baseline: {
      source: { ...diff.baseline.source },
      status: diff.baseline.status,
      partCount: diff.baseline.partCount,
      oracleClashes: diff.clashDeltas.oracleTotalClashes.baseline,
      naiveClashes: diff.clashDeltas.naiveTotalClashes.baseline,
    },
    deadlockRegressed: diff.deadlock.regressed,
    newlyDeadlocked: diff.deadlock.newlyDeadlocked,
    newSccs: diff.deadlock.newSccs.map((scc) => scc.slice()),
    resolvedSccs: diff.deadlock.resolvedSccs.map((scc) => scc.slice()),
    depthRegressions: diff.depthRegressions.map((change) => ({ ...change })),
    depthImprovements: diff.depthImprovements.map((change) => ({ ...change })),
    addedParts: diff.addedParts.slice(),
    removedParts: diff.removedParts.slice(),
  };
  const reasons: string[] = [];
  const warnings = diff.warnings.slice();
  if (!diff.passed) {
    reasons.push(...diff.reasons);
  }
  if (diff.passed && assembly.status !== "error" && assembly.clashes.oracle > 0) {
    reasons.push(`The clash oracle found ${assembly.clashes.oracle} collisions in the candidate plan.`);
  }
  if (options.failOnDepthRegression === true && diff.depthRegressions.length > 0) {
    reasons.push(`${diff.depthRegressions.length} part${diff.depthRegressions.length === 1 ? "" : "s"} regressed in repairability depth.`);
  }
  if (assembly.status === "deadlocked" && !diff.deadlock.regressed) {
    warnings.push(`The candidate is deadlocked, but the baseline already had the same cycles: ${describeSccs(assembly)}.`);
  }
  const verdict = finish(
    reasons,
    warnings,
    diff.depthRegressions.length > 0
      ? `PASS: no deadlock regression (${diff.depthRegressions.length} depth regression warning${diff.depthRegressions.length === 1 ? "" : "s"}).`
      : "PASS: no deadlock regression and no depth regression.",
  );
  return {
    schema: MANIFEST_SCHEMA,
    generatedAt,
    tool: { ...TOOL_INFO },
    mode: "diff",
    assembly,
    diff: manifestDiff,
    verdict,
  };
}
