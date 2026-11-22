/**
 * Pure audit core. It runs the UnboltKit disassembly pipeline (Stages 0 to 4), the independent
 * clash oracle and the naive radial baseline on one assembly, and returns plain JSON.
 *
 * No function here writes to stdout or stderr, and none reads the clock or a random source, so
 * the same assembly always gives the same audit.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkClashes,
  computeNaiveRadialClashes,
  stage0ParseScene,
  stage1Prepare,
  stage2BuildDbg,
  stage3Peel,
  stage4Compile,
} from "@unboltkit/core";
import type { CoreError, NormalizedPart, SolvedPlan, Stage1Result, TrajectoryStep, Vec3 } from "@unboltkit/core";
import { DEADLOCK_CAGES, SHOWCASE_KITS } from "@unboltkit/sample-kits";
import type { Group } from "three";
import { parseGlb } from "./glbReader.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Selects one assembly. Give exactly one of the two fields. */
export interface AssemblySource {
  /** Name of a bundled sample kit, see {@link listSampleKits}. */
  kitName?: string | undefined;
  /** Path to a `.glb` file. A relative path is resolved against the server's working directory. */
  glbPath?: string | undefined;
}

export interface SampleKitInfo {
  name: string;
  category: "showcase" | "deadlock-cage";
}

export interface AuditStep {
  /** 1-based position in the peel order. Depth 1 can be pulled out with nothing removed first. */
  repairabilityDepth: number;
  partId: string;
  name: string;
  primitive: string | null;
  escapeDistance: number;
  dir: Vec3;
}

export interface AuditWitnessEdge {
  from: string;
  to: string;
  dirIndex: number;
  dir: Vec3;
  fromTriangleCount: number;
  toTriangleCount: number;
}

export interface AuditScc {
  partIds: string[];
  names: string[];
  edges: AuditWitnessEdge[];
}

export interface AuditDeadlockWitness {
  /** The cycles. Their members are never removed. */
  sccs: AuditScc[];
  /** Parts that were not removed and are in no SCC. They are blocked by a cycle but are not part of one. */
  unassigned: { partId: string; name: string }[];
}

export interface AssemblyAudit {
  status: "solved" | "deadlocked" | "error";
  source: { kind: "kit" | "glb"; name: string };
  partCount: number;
  totalTriangles: number;
  polyBudgetExceeded: boolean;
  /** Sum of Clash_Checker collisions over every plan step. Must be 0 for a correct plan. */
  oracleTotalClashes: number;
  /** Collisions if every part simply moved radially away from the assembly centroid. */
  naiveTotalClashes: number;
  naiveObstructedParts: number;
  /** In removal order. For a deadlocked assembly these are only the parts removed before the deadlock. */
  steps: AuditStep[];
  deadlockWitness?: AuditDeadlockWitness;
  error?: { kind: string; message: string };
}

export interface DepthChange {
  name: string;
  partId: string;
  baselineDepth: number | null;
  candidateDepth: number | null;
  /** `candidateDepth - baselineDepth`, or `null` when either side has no depth. */
  delta: number | null;
}

export interface Delta {
  baseline: number;
  candidate: number;
  delta: number;
}

export interface AuditSummary {
  source: { kind: "kit" | "glb"; name: string };
  status: AssemblyAudit["status"];
  partCount: number;
  error?: { kind: string; message: string };
}

export interface RepairabilityDiff {
  /** `false` on any deadlock regression or any audit error. */
  passed: boolean;
  verdict: string;
  reasons: string[];
  warnings: string[];
  baseline: AuditSummary;
  candidate: AuditSummary;
  deadlock: {
    regressed: boolean;
    /** The baseline was not deadlocked and the candidate is. */
    newlyDeadlocked: boolean;
    /** Candidate SCCs (part names) that no baseline SCC contains. */
    newSccs: string[][];
    /** Baseline SCCs (part names) that no candidate SCC contains. */
    resolvedSccs: string[][];
  };
  depthRegressions: DepthChange[];
  depthImprovements: DepthChange[];
  clashDeltas: {
    oracleTotalClashes: Delta;
    naiveTotalClashes: Delta;
    naiveObstructedParts: Delta;
  };
  addedParts: string[];
  removedParts: string[];
  errors: string[];
}

export interface DiffInput {
  baseline: AssemblySource;
  candidate: AssemblySource;
  /**
   * Limits the depth comparison to matching parts. Each entry is a part key, name or Part_ID,
   * and `*` matches any run of characters. Deadlock and clash checks are never filtered.
   */
  targetPartFilter?: string | string[] | undefined;
}

// ---------------------------------------------------------------------------
// Sample kits
// ---------------------------------------------------------------------------

const KITS: { entry: (typeof SHOWCASE_KITS)[number]; category: SampleKitInfo["category"] }[] = [
  ...SHOWCASE_KITS.map((entry) => ({ entry, category: "showcase" as const })),
  ...DEADLOCK_CAGES.map((entry) => ({ entry, category: "deadlock-cage" as const })),
];

/** The five bundled kits: three showcase kits and two deadlock cages. */
export function listSampleKits(): SampleKitInfo[] {
  return KITS.map(({ entry, category }) => ({ name: entry.name, category }));
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

class AuditInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditInputError";
  }
}

function describeSource(source: AssemblySource): { kind: "kit" | "glb"; name: string } {
  if (typeof source.kitName === "string" && source.kitName !== "") {
    return { kind: "kit", name: source.kitName };
  }
  if (typeof source.glbPath === "string" && source.glbPath !== "") {
    return { kind: "glb", name: source.glbPath };
  }
  return { kind: "kit", name: "" };
}

function loadAssembly(source: AssemblySource): Group {
  const hasKit = source.kitName !== undefined;
  const hasGlb = source.glbPath !== undefined;
  if (hasKit === hasGlb) {
    throw new AuditInputError("Provide exactly one of kitName or glbPath.");
  }
  if (hasKit) {
    const kit = KITS.find(({ entry }) => entry.name === source.kitName);
    if (kit === undefined) {
      const known = KITS.map(({ entry }) => entry.name).join(", ");
      throw new AuditInputError(`Unknown kitName "${String(source.kitName)}". Known kits: ${known}.`);
    }
    return kit.entry.build();
  }
  const path = source.glbPath;
  if (typeof path !== "string" || path === "") {
    throw new AuditInputError("glbPath must be a non-empty string.");
  }
  return parseGlb(readFileSync(resolve(path)));
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

interface InternalAudit {
  audit: AssemblyAudit;
  /** Every part of the assembly, with the 1-based depth or `null` when unassigned. */
  parts: { partId: string; name: string; depth: number | null }[];
  /** SCCs as Part_IDs, for matching in a diff. */
  sccPartIds: string[][];
}

function errorAudit(source: AssemblySource, error: { kind: string; message: string }, partial?: Partial<AssemblyAudit>): InternalAudit {
  return {
    audit: {
      status: "error",
      source: describeSource(source),
      partCount: 0,
      totalTriangles: 0,
      polyBudgetExceeded: false,
      oracleTotalClashes: 0,
      naiveTotalClashes: 0,
      naiveObstructedParts: 0,
      steps: [],
      ...partial,
      error,
    },
    parts: [],
    sccPartIds: [],
  };
}

function coreErrorInfo(error: CoreError): { kind: string; message: string } {
  return { kind: error.kind, message: error.message };
}

function runAudit(source: AssemblySource): InternalAudit {
  const root = loadAssembly(source);

  const stage0 = stage0ParseScene(root);
  if (stage0.status === "error") {
    return errorAudit(source, coreErrorInfo(stage0.error));
  }
  const counts = { totalTriangles: stage0.totalTriangles, polyBudgetExceeded: stage0.sampling.polyBudgetExceeded };
  const stage1 = stage1Prepare(stage0);
  if (stage1.status === "error") {
    return errorAudit(source, coreErrorInfo(stage1.error), counts);
  }
  const graph = stage2BuildDbg(stage1, stage1.config);
  const plan = stage3Peel(stage1, graph, stage1.config);

  const partsById = new Map<string, NormalizedPart>(stage1.parts.map((part) => [part.partId, part]));
  const nameOf = (partId: string): string => partsById.get(partId)?.sourceNodeName ?? "";

  // Stage 4 only compiles solved plans. The steps of a deadlocked plan are a valid partial peel,
  // so they are compiled as one to give each of them its motion primitive.
  const compilable: SolvedPlan = {
    status: "solved",
    steps: plan.steps,
    normalization: plan.normalization,
    sampling: plan.sampling,
    diagnostics: plan.diagnostics,
  };
  const compiled = stage4Compile(compilable, stage1, stage1.config);
  if (!compiled.ok) {
    return errorAudit(source, { kind: compiled.error.kind, message: compiled.error.message }, counts);
  }
  const trajectory: TrajectoryStep[] = compiled.steps;

  const steps: AuditStep[] = plan.steps.map((step, index) => ({
    repairabilityDepth: index + 1,
    partId: step.partId,
    name: nameOf(step.partId),
    primitive: trajectory[index]?.primitive ?? null,
    escapeDistance: step.escapeDistance,
    dir: step.dir,
  }));

  // Independent oracle: replay each step against every part that is still in the assembly.
  // That is the parts of the later steps and, for a deadlock, every part that never got a step
  // (the witnessed SCC members and the parts outside them).
  const stepParts = plan.steps.map((step) => requirePart(partsById, step.partId));
  const stepIds = new Set(plan.steps.map((step) => step.partId));
  const neverRemoved = stage1.parts.filter((part) => !stepIds.has(part.partId));
  let oracleTotalClashes = 0;
  plan.steps.forEach((step, index) => {
    const statics = [...stepParts.slice(index + 1), ...neverRemoved];
    oracleTotalClashes += checkClashes(stepParts[index] as NormalizedPart, step.dir, statics, stage1.config).count;
  });

  const naive = computeNaiveRadialClashes(stage1 as Stage1Result, stage1.config);
  const naiveObstructedParts = naive.perPart.filter((entry) => entry.clashCount > 0).length;

  const depthOf = new Map<string, number>(steps.map((step) => [step.partId, step.repairabilityDepth]));
  const audit: AssemblyAudit = {
    status: plan.status,
    source: describeSource(source),
    partCount: stage1.parts.length,
    totalTriangles: plan.sampling.totalTriangles,
    polyBudgetExceeded: plan.sampling.polyBudgetExceeded,
    oracleTotalClashes,
    naiveTotalClashes: naive.totalClashes,
    naiveObstructedParts,
    steps,
  };
  let sccPartIds: string[][] = [];
  if (plan.status === "deadlocked") {
    sccPartIds = plan.witness.sccs.map((scc) => scc.partIds.slice());
    audit.deadlockWitness = {
      sccs: plan.witness.sccs.map((scc) => ({
        partIds: scc.partIds.slice(),
        names: scc.partIds.map(nameOf),
        edges: scc.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          dirIndex: edge.dirIndex,
          dir: edge.dir,
          fromTriangleCount: edge.fromTriangles.length,
          toTriangleCount: edge.toTriangles.length,
        })),
      })),
      unassigned: plan.witness.unassignedPartIds.map((partId) => ({ partId, name: nameOf(partId) })),
    };
  }
  return {
    audit,
    parts: stage1.parts.map((part) => ({ partId: part.partId, name: part.sourceNodeName, depth: depthOf.get(part.partId) ?? null })),
    sccPartIds,
  };
}

function requirePart(partsById: ReadonlyMap<string, NormalizedPart>, partId: string): NormalizedPart {
  const part = partsById.get(partId);
  if (part === undefined) {
    throw new RangeError(`The plan names Part ${partId}, which is not in the Stage 1 result`);
  }
  return part;
}

/** Runs {@link runAudit} and turns any failure into an `error` audit, so callers get plain data. */
function safeAudit(source: AssemblySource): InternalAudit {
  try {
    return runAudit(source);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    return errorAudit(source, { kind: error.name, message: error.message });
  }
}

/**
 * Runs Stages 0 to 4, the independent clash oracle and the naive radial baseline on one
 * assembly. Every failure, including an unknown kit, an unreadable file or a malformed `.glb`,
 * comes back as `status: "error"` with an `error` object, never as a thrown exception.
 */
export function inspectAssemblyDbg(source: AssemblySource): AssemblyAudit {
  return safeAudit(source).audit;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** Part key used to match parts across two assemblies: the name when unique, else the Part_ID. */
function keyParts(parts: InternalAudit["parts"]): Map<string, InternalAudit["parts"][number]> {
  const nameCounts = new Map<string, number>();
  for (const part of parts) {
    nameCounts.set(part.name, (nameCounts.get(part.name) ?? 0) + 1);
  }
  const keyed = new Map<string, InternalAudit["parts"][number]>();
  for (const part of parts) {
    const unique = part.name !== "" && nameCounts.get(part.name) === 1;
    keyed.set(unique ? part.name : part.partId, part);
  }
  return keyed;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function summarize(internal: InternalAudit): AuditSummary {
  const { audit } = internal;
  const summary: AuditSummary = { source: audit.source, status: audit.status, partCount: audit.partCount };
  if (audit.error !== undefined) {
    summary.error = audit.error;
  }
  return summary;
}

function delta(baseline: number, candidate: number): Delta {
  return { baseline, candidate, delta: candidate - baseline };
}

function sccNameSets(internal: InternalAudit, keyOf: Map<string, string>): string[][] {
  return internal.sccPartIds.map((ids) => ids.map((id) => keyOf.get(id) ?? id).sort(compareStrings));
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isSubset(inner: readonly string[], outer: readonly string[]): boolean {
  const set = new Set(outer);
  return inner.every((item) => set.has(item));
}

/**
 * Audits `baseline` and `candidate` and reports what got worse.
 *
 * - Deadlock regression: the candidate has a Tarjan SCC that no baseline SCC contains. A
 *   candidate that deadlocks where the baseline was solved is the plain case.
 * - Depth regression: a part present in both has a larger 1-based `repairabilityDepth` in the
 *   candidate, or lost its depth because it is stuck in a deadlock.
 * - `passed` is `false` on any deadlock regression and on any audit error. Depth regressions and
 *   oracle clashes in the candidate are reported as warnings.
 *
 * Parts are matched across the two assemblies by name when the name is unique within its
 * assembly, and by Part_ID otherwise.
 */
export function diffRepairability(input: DiffInput): RepairabilityDiff {
  const base = safeAudit(input.baseline);
  const cand = safeAudit(input.candidate);
  const errors: string[] = [];
  for (const [label, internal] of [["baseline", base], ["candidate", cand]] as const) {
    if (internal.audit.error !== undefined) {
      errors.push(`${label} audit failed: ${internal.audit.error.kind}: ${internal.audit.error.message}`);
    }
  }

  const baseParts = keyParts(base.parts);
  const candParts = keyParts(cand.parts);
  const baseKeyOf = new Map([...baseParts].map(([key, part]) => [part.partId, key]));
  const candKeyOf = new Map([...candParts].map(([key, part]) => [part.partId, key]));

  // Deadlocks.
  const baseSccs = sccNameSets(base, baseKeyOf);
  const candSccs = sccNameSets(cand, candKeyOf);
  const newSccs = candSccs.filter((scc) => !baseSccs.some((old) => isSubset(scc, old)));
  const resolvedSccs = baseSccs.filter((scc) => !candSccs.some((now) => isSubset(scc, now)));
  const newlyDeadlocked = cand.audit.status === "deadlocked" && base.audit.status !== "deadlocked";
  const deadlockRegressed = newSccs.length > 0;

  // Depth.
  const filters = (input.targetPartFilter === undefined ? [] : Array.isArray(input.targetPartFilter) ? input.targetPartFilter : [input.targetPartFilter]).map(globToRegExp);
  const selected = (key: string, part: InternalAudit["parts"][number]): boolean =>
    filters.length === 0 || filters.some((re) => re.test(key) || re.test(part.name) || re.test(part.partId));
  const depthRegressions: DepthChange[] = [];
  const depthImprovements: DepthChange[] = [];
  const addedParts: string[] = [];
  const removedParts: string[] = [];
  const bothUsable = errors.length === 0;
  if (bothUsable) {
    for (const [key, candPart] of candParts) {
      const basePart = baseParts.get(key);
      if (basePart === undefined) {
        addedParts.push(key);
        continue;
      }
      if (!selected(key, candPart)) {
        continue;
      }
      const change: DepthChange = {
        name: candPart.name,
        partId: candPart.partId,
        baselineDepth: basePart.depth,
        candidateDepth: candPart.depth,
        delta: basePart.depth !== null && candPart.depth !== null ? candPart.depth - basePart.depth : null,
      };
      const lostDepth = basePart.depth !== null && candPart.depth === null;
      const gainedDepth = basePart.depth === null && candPart.depth !== null;
      if (lostDepth || (change.delta !== null && change.delta > 0)) {
        depthRegressions.push(change);
      } else if (gainedDepth || (change.delta !== null && change.delta < 0)) {
        depthImprovements.push(change);
      }
    }
    for (const key of baseParts.keys()) {
      if (!candParts.has(key)) {
        removedParts.push(key);
      }
    }
  }

  const reasons: string[] = [];
  if (errors.length > 0) {
    reasons.push(...errors);
  }
  if (deadlockRegressed) {
    reasons.push(
      newlyDeadlocked
        ? `The candidate deadlocks (${newSccs.length} SCC${newSccs.length === 1 ? "" : "s"}) and the baseline did not.`
        : `The candidate has ${newSccs.length} deadlock SCC${newSccs.length === 1 ? "" : "s"} that the baseline does not have.`,
    );
  }
  const warnings: string[] = [];
  if (depthRegressions.length > 0) {
    warnings.push(`${depthRegressions.length} part${depthRegressions.length === 1 ? "" : "s"} became harder to reach (repairability depth regression).`);
  }
  if (cand.audit.status !== "error" && cand.audit.oracleTotalClashes > 0) {
    warnings.push(`The oracle found ${cand.audit.oracleTotalClashes} clashes in the candidate plan.`);
  }

  const passed = errors.length === 0 && !deadlockRegressed;
  return {
    passed,
    verdict: passed ? "PASS: no deadlock regression." : "FAIL: " + reasons.join(" "),
    reasons,
    warnings,
    baseline: summarize(base),
    candidate: summarize(cand),
    deadlock: { regressed: deadlockRegressed, newlyDeadlocked, newSccs, resolvedSccs },
    depthRegressions,
    depthImprovements,
    clashDeltas: {
      oracleTotalClashes: delta(base.audit.oracleTotalClashes, cand.audit.oracleTotalClashes),
      naiveTotalClashes: delta(base.audit.naiveTotalClashes, cand.audit.naiveTotalClashes),
      naiveObstructedParts: delta(base.audit.naiveObstructedParts, cand.audit.naiveObstructedParts),
    },
    addedParts,
    removedParts,
    errors,
  };
}
