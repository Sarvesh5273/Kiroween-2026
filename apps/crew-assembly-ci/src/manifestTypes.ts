/**
 * Shape of `disassembly-manifest.json`. This file has no imports so the Node CI script and the
 * browser dashboard (`ui/`) can both use it as a type-only dependency.
 */
export const MANIFEST_SCHEMA = "unboltkit.disassembly-manifest/v1";

export type AssemblyStatus = "solved" | "deadlocked" | "error";
export type CiVerdict = "pass" | "fail";

export interface ManifestSource {
  kind: "kit" | "glb";
  name: string;
}

export interface ManifestClashes {
  /** Collisions the independent Clash_Checker found when replaying the plan. Must be 0. */
  oracle: number;
  /** Collisions a naive radial explode would cause on the same assembly. */
  naive: number;
  /** Parts a naive radial explode would push through another part. */
  naiveObstructedParts: number;
  /** `naive - oracle`. */
  avoidedByPlan: number;
}

export interface ManifestStep {
  /** 1-based. Depth 1 comes out with nothing removed first. */
  depth: number;
  partId: string;
  name: string;
  primitive: string | null;
}

export interface ManifestSccEdge {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  dir: [number, number, number];
}

export interface ManifestScc {
  partIds: string[];
  names: string[];
  edges: ManifestSccEdge[];
}

export interface ManifestDeadlock {
  sccs: ManifestScc[];
  /** Parts that were not removed and are in no cycle. A cycle blocks them. */
  blockedByCycle: { partId: string; name: string }[];
}

export interface ManifestAssembly {
  source: ManifestSource;
  status: AssemblyStatus;
  partCount: number;
  totalTriangles: number;
  polyBudgetExceeded: boolean;
  clashes: ManifestClashes;
  repairability: { maxDepth: number; steps: ManifestStep[] };
  /** `null` unless `status` is `deadlocked`. */
  deadlock: ManifestDeadlock | null;
  error: { kind: string; message: string } | null;
}

export interface ManifestBaselineSummary {
  source: ManifestSource;
  status: AssemblyStatus;
  partCount: number;
  oracleClashes: number;
  naiveClashes: number;
}

export interface ManifestDepthChange {
  name: string;
  partId: string;
  baselineDepth: number | null;
  candidateDepth: number | null;
  delta: number | null;
}

export interface ManifestDiff {
  baseline: ManifestBaselineSummary;
  deadlockRegressed: boolean;
  newlyDeadlocked: boolean;
  newSccs: string[][];
  resolvedSccs: string[][];
  depthRegressions: ManifestDepthChange[];
  depthImprovements: ManifestDepthChange[];
  addedParts: string[];
  removedParts: string[];
}

export interface ManifestVerdict {
  ci: CiVerdict;
  summary: string;
  reasons: string[];
  warnings: string[];
}

export interface DisassemblyManifest {
  schema: typeof MANIFEST_SCHEMA;
  generatedAt: string;
  tool: { name: string; version: string };
  mode: "audit" | "diff";
  /** The audited assembly. In diff mode this is the candidate. */
  assembly: ManifestAssembly;
  /** Present in diff mode only. */
  diff: ManifestDiff | null;
  verdict: ManifestVerdict;
}
