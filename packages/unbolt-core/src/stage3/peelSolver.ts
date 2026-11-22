import type { ResolvedSolverConfig } from "../config";
import type { Aabb } from "../math/aabb";
import { computePartMetrics } from "../stage1/partMetrics";
import type {
  BlockingEdge,
  BlockingGraph,
  DeadlockedPlan,
  Diagnostic,
  ErrorResult,
  NormalizationTransform,
  PlanStep,
  SamplingMetadata,
  SolvedPlan,
  Stage1Result,
  Vec3,
} from "../types";
import {
  buildUnionExtremes,
  chooseDirection,
  escapeDistance,
  unionExcluding,
  type DirectionChoice,
} from "./escapeDistance";
import { buildDeadlockWitness } from "./sccAnalyzer";
import { createStepVerifier, type StepVerifier } from "./stepVerifier";
import { compareCodeUnits, radialExposure, selectByCascade, type CascadeSteps, type TieBreakKey } from "./tieBreak";

/** What the solver reads of one Part. Plain data, so synthetic graphs can drive the solver. */
export interface PeelPartInput {
  partId: string;
  /** Exact AABB in normalized coordinates. */
  aabb: Aabb;
  obbCenter: Vec3;
  /** OBB half-extents. Slenderness and the Fastener flag are derived from these and the config. */
  obbHalfExtents: Vec3;
  /** The Part's Candidate_Axes, normally 32 unit vectors. */
  candidateAxes: readonly Vec3[];
}

export interface PeelInput {
  parts: readonly PeelPartInput[];
  edges: readonly BlockingEdge[];
  normalization: NormalizationTransform;
  sampling: SamplingMetadata;
  diagnostics: Diagnostic[];
}

/** One iteration of the peel, with every tie-break key and the survivors of each cascade step. */
export interface PeelTraceIteration {
  /** Removable Part_IDs, ascending. */
  removable: string[];
  /** Key and chosen direction of each removable Part, in the order of `removable`. */
  keys: (TieBreakKey & { dirIndex: number })[];
  steps: CascadeSteps;
  selected: string;
}
export interface PeelTrace {
  iterations: PeelTraceIteration[];
}

interface PartState {
  readonly input: PeelPartInput;
  readonly isFastener: boolean;
  readonly slenderness: number;
  removed: boolean;
  /** `blockers[k]`: distinct unremoved Parts B with an edge `(this, B, k)`. */
  readonly blockers: Int32Array;
}

interface RemovableChoice {
  readonly state: PartState;
  readonly index: number;
  readonly choice: DirectionChoice;
}

function copyVec3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

// The plan owns its data, so a consumer who edits it cannot change the Stage 1 result.
function cloneNormalization(normalization: NormalizationTransform): NormalizationTransform {
  return { scale: normalization.scale, translation: copyVec3(normalization.translation) };
}

function cloneDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({ ...diagnostic, nodePath: diagnostic.nodePath.slice() }));
}

/**
 * Adds the Blocking_Edges that step verification found for the selected move (Req 14.11).
 *
 * Every edge must be `(A, B, k)` for the selected Part A and axis k, with B an unremoved Part
 * other than A, and no B may repeat. `blockers[A][k]` was 0 when the move was selected, so no
 * edge `(A, B, k)` to an unremoved B was counted yet, and each edge here is a new triple. After
 * this call `blockers[A][k] >= 1`, so the same move cannot be selected again while B remains.
 */
function refineBlockers(
  selected: RemovableChoice,
  found: readonly BlockingEdge[],
  states: readonly PartState[],
  indexOf: ReadonlyMap<string, number>,
  edgesByBlocker: { from: number; dirIndex: number }[][],
  activeEdges: BlockingEdge[],
): void {
  const { state, index, choice } = selected;
  const k = choice.dirIndex;
  if (state.blockers[k] !== 0) {
    throw new RangeError(`step verification ran for ${state.input.partId} along the blocked axis ${k}`);
  }
  const seen = new Set<number>();
  for (const edge of found) {
    const to = indexOf.get(edge.to);
    if (edge.from !== state.input.partId || edge.dirIndex !== k) {
      throw new RangeError(`step verification of ${state.input.partId} along axis ${k} reported the edge ${edge.from} -> ${edge.to} along axis ${edge.dirIndex}`);
    }
    if (to === undefined || to === index || (states[to] as PartState).removed || seen.has(to)) {
      throw new RangeError(`step verification of ${state.input.partId} reported ${edge.to}, which is not a new unremoved blocker`);
    }
    seen.add(to);
    state.blockers[k] = (state.blockers[k] as number) + 1;
    (edgesByBlocker[to] as { from: number; dirIndex: number }[]).push({ from: index, dirIndex: k });
    activeEdges.push({
      from: edge.from,
      to: edge.to,
      dirIndex: k,
      dir: copyVec3(edge.dir),
      fromTriangles: edge.fromTriangles.slice(),
      toTriangles: edge.toTriangles.slice(),
    });
  }
}

/**
 * The Kahn-style peel of Req 14 and 15 over plain data.
 *
 * `blockers[A][k]` counts the distinct unremoved Parts B with a Blocking_Edge `(A, B, k)`, and
 * removing B decrements the entries listed in `edgesByBlocker[B]` (D5). Each iteration:
 *
 * 1. A is removable when some axis has a zero count (Req 14.1).
 * 2. For each removable A the direction is the unblocked axis of smallest Escape_Distance
 *    against the union of the other unremoved Parts, with `1e-9` ties going to the lowest axis
 *    index (Req 14.3). Slenderness, Fastener and Radial_Exposure use only the unremoved Parts
 *    (Req 15.4).
 * 3. The tolerance cascade picks one Part (Req 15.1).
 * 4. The step `{ partId, dir, dirIndex, escapeDistance, secondary: null }` is appended (Req 14.10).
 *
 * With no removable Part and Parts left, the SCC_Analyzer builds the witness (Req 16).
 *
 * **Lazy step verification (Req 14.11).** With `opts.verifyStep`, the selected move is checked
 * before step 4. When the verifier reports Blocking_Edges `(A, B, k)`, each one is added to
 * `blockers[A][k]`, `edgesByBlocker[B]` and the edges the SCC_Analyzer sees, A is not committed,
 * and the iteration runs again, so A takes another unblocked axis or another Part goes first.
 * The selected axis had `blockers[A][k] = 0` and every reported B is unremoved, so every reported
 * edge is a new `(A, B, k)` triple. There are finitely many triples, so the loop ends. Without
 * `verifyStep` the peel is exactly the plain-data peel above. The trace records committed
 * iterations only.
 *
 * @throws RangeError when an edge names an unknown Part or an axis index outside that Part's
 *   Candidate_Axes, when Part_IDs repeat, or when `verifyStep` reports an edge that is not a new
 *   `(A, B, k)` triple for the selected move against an unremoved Part B.
 */
export function runPeel(
  input: PeelInput,
  config: Pick<ResolvedSolverConfig, "fastenerSymmetryTolerance" | "fastenerSlendernessThreshold">,
  opts: { trace?: boolean; verifyStep?: StepVerifier } = {},
): { plan: SolvedPlan | DeadlockedPlan; trace?: PeelTrace } {
  const sortedInputs = input.parts.slice().sort((a, b) => compareCodeUnits(a.partId, b.partId));
  const indexOf = new Map<string, number>();
  const states: PartState[] = sortedInputs.map((part, index) => {
    if (indexOf.has(part.partId)) {
      throw new RangeError(`Part_ID ${part.partId} appears twice`);
    }
    indexOf.set(part.partId, index);
    const metrics = computePartMetrics(part.obbHalfExtents, config);
    return {
      input: part,
      isFastener: metrics.isFastener,
      slenderness: metrics.slenderness,
      removed: false,
      blockers: new Int32Array(part.candidateAxes.length),
    };
  });

  // Count distinct (A, B, k) triples. Sorting first keeps the work order fixed and lets a
  // repeated triple be dropped by comparing neighbors.
  const edgesByBlocker: { from: number; dirIndex: number }[][] = states.map(() => []);
  const sortedEdges = input.edges.slice().sort(
    (a, b) => compareCodeUnits(a.from, b.from) || compareCodeUnits(a.to, b.to) || a.dirIndex - b.dirIndex,
  );
  let previous: BlockingEdge | undefined;
  for (const edge of sortedEdges) {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined) {
      throw new RangeError(`edge ${edge.from} -> ${edge.to} names a Part that is not in the input`);
    }
    const fromState = states[from] as PartState;
    if (!Number.isInteger(edge.dirIndex) || edge.dirIndex < 0 || edge.dirIndex >= fromState.blockers.length) {
      throw new RangeError(`edge ${edge.from} -> ${edge.to} has the axis index ${edge.dirIndex}, outside the Candidate_Axes`);
    }
    if (from === to) {
      continue;
    }
    if (previous !== undefined && previous.from === edge.from && previous.to === edge.to && previous.dirIndex === edge.dirIndex) {
      continue;
    }
    previous = edge;
    fromState.blockers[edge.dirIndex] = (fromState.blockers[edge.dirIndex] as number) + 1;
    (edgesByBlocker[to] as { from: number; dirIndex: number }[]).push({ from, dirIndex: edge.dirIndex });
  }

  const steps: PlanStep[] = [];
  const trace: PeelTrace | undefined = opts.trace === true ? { iterations: [] } : undefined;
  const verifyStep = opts.verifyStep;
  // The input edges plus every edge found by step verification, for the SCC_Analyzer.
  const activeEdges: BlockingEdge[] = input.edges.slice();
  let remaining = states.length;

  while (remaining > 0) {
    const unremoved: { id: number; aabb: Aabb }[] = [];
    const meanCenter: Vec3 = [0, 0, 0];
    states.forEach((state, index) => {
      if (!state.removed) {
        unremoved.push({ id: index, aabb: state.input.aabb });
        for (let j = 0; j < 3; j++) {
          meanCenter[j] = (meanCenter[j] as number) + (state.input.obbCenter[j] as number);
        }
      }
    });
    for (let j = 0; j < 3; j++) {
      meanCenter[j] = (meanCenter[j] as number) / unremoved.length;
    }
    const extremes = buildUnionExtremes(unremoved);

    const removable: RemovableChoice[] = [];
    for (const { id } of unremoved) {
      const state = states[id] as PartState;
      const others = unionExcluding(extremes, id);
      const unblocked: DirectionChoice[] = [];
      for (let k = 0; k < state.blockers.length; k++) {
        if (state.blockers[k] === 0) {
          unblocked.push({ dirIndex: k, escapeDistance: escapeDistance(state.input.aabb, state.input.candidateAxes[k] as Vec3, others) });
        }
      }
      if (unblocked.length > 0) {
        removable.push({ state, index: id, choice: chooseDirection(unblocked) });
      }
    }

    if (removable.length === 0) {
      const unremovedIds = unremoved.map(({ id }) => (states[id] as PartState).input.partId);
      const witness = buildDeadlockWitness(unremovedIds, activeEdges);
      const plan: DeadlockedPlan = {
        status: "deadlocked",
        steps,
        witness,
        normalization: cloneNormalization(input.normalization),
        sampling: { ...input.sampling },
        diagnostics: cloneDiagnostics(input.diagnostics),
      };
      return trace === undefined ? { plan } : { plan, trace };
    }

    const keys = removable.map(({ state, choice }) => ({
      partId: state.input.partId,
      isFastener: state.isFastener,
      slenderness: state.slenderness,
      radialExposure: radialExposure(state.input.obbCenter, meanCenter),
      escapeDistance: choice.escapeDistance,
    }));
    const cascade = selectByCascade(keys);
    const selected = removable.find(({ state }) => state.input.partId === cascade.partId);
    if (selected === undefined) {
      throw new RangeError(`the cascade selected ${cascade.partId}, which is not removable`);
    }
    if (verifyStep !== undefined && unremoved.length > 1) {
      const found = verifyStep({
        partId: selected.state.input.partId,
        dirIndex: selected.choice.dirIndex,
        dir: copyVec3(selected.state.input.candidateAxes[selected.choice.dirIndex] as Vec3),
        unremovedPartIds: unremoved.filter(({ id }) => id !== selected.index).map(({ id }) => (states[id] as PartState).input.partId),
      });
      if (found.length > 0) {
        refineBlockers(selected, found, states, indexOf, edgesByBlocker, activeEdges);
        continue;
      }
    }
    if (trace !== undefined) {
      trace.iterations.push({
        removable: removable.map(({ state }) => state.input.partId),
        keys: keys.map((key, i) => ({ ...key, dirIndex: (removable[i] as RemovableChoice).choice.dirIndex })),
        steps: cascade.steps,
        selected: cascade.partId,
      });
    }

    steps.push({
      partId: selected.state.input.partId,
      dir: copyVec3(selected.state.input.candidateAxes[selected.choice.dirIndex] as Vec3),
      dirIndex: selected.choice.dirIndex,
      escapeDistance: selected.choice.escapeDistance,
      secondary: null,
    });
    selected.state.removed = true;
    remaining--;
    for (const { from, dirIndex } of edgesByBlocker[selected.index] as { from: number; dirIndex: number }[]) {
      const blockers = (states[from] as PartState).blockers;
      blockers[dirIndex] = (blockers[dirIndex] as number) - 1;
    }
  }

  const plan: SolvedPlan = {
    status: "solved",
    steps,
    normalization: cloneNormalization(input.normalization),
    sampling: { ...input.sampling },
    diagnostics: cloneDiagnostics(input.diagnostics),
  };
  return trace === undefined ? { plan } : { plan, trace };
}

/**
 * Stage 3: peels the Parts of `stage1` along the unblocked directions of `graph` (Req 14, 15)
 * and reports a deadlock witness when no Part can move (Req 16).
 *
 * - An incoming `ErrorResult` (from either argument) is returned unchanged, so a manual chain
 *   equals `solveDisassembly`.
 * - Every selected move is checked by lazy exact step verification before it is committed
 *   (Req 14.11, `stepVerifier.ts`). A move that collides adds its Blocking_Edges and is retried.
 * - `fastenerSymmetryTolerance`, `fastenerSlendernessThreshold`, and for step verification
 *   `microShrink`, `clearanceEpsilon` and `tau` of `config` are read.
 * - The same Assembly, graph and config always give the same plan (Req 14.9, 15.8).
 *
 * @throws DeadlockWitnessInvariantError when a deadlock has no sink SCC with 2 or more members
 *   (Req 16.7).
 */
export function stage3Peel(stage1: Stage1Result, graph: BlockingGraph, config: ResolvedSolverConfig): SolvedPlan | DeadlockedPlan;
export function stage3Peel(
  stage1: Stage1Result | ErrorResult,
  graph: BlockingGraph | ErrorResult,
  config: ResolvedSolverConfig,
): SolvedPlan | DeadlockedPlan | ErrorResult;
export function stage3Peel(
  stage1: Stage1Result | ErrorResult,
  graph: BlockingGraph | ErrorResult,
  config: ResolvedSolverConfig,
): SolvedPlan | DeadlockedPlan | ErrorResult {
  if (stage1.status === "error") {
    return stage1;
  }
  if ("status" in graph) {
    return graph;
  }
  const input: PeelInput = {
    parts: stage1.parts.map((part) => ({
      partId: part.partId,
      aabb: part.aabb,
      obbCenter: part.frame.obb.center,
      obbHalfExtents: part.frame.obb.halfExtents,
      candidateAxes: part.candidateAxes,
    })),
    edges: graph.edges,
    normalization: stage1.normalization,
    sampling: stage1.sampling,
    diagnostics: stage1.diagnostics,
  };
  // One verifier per call, so its per-Part source cache never outlives this solve.
  const verifier = createStepVerifier(stage1.parts, config);
  return runPeel(input, config, { verifyStep: verifier.verify }).plan;
}
