import type { Object3D } from "three";
import {
  stage0ParseScene,
  stage1Prepare,
  stage2BuildDbg,
  stage3Peel,
  stage4Compile,
} from "@unboltkit/core";
import type { TrajectoryStep } from "@unboltkit/core";
import type {
  BlitzEdge,
  OverBudgetWarning,
  SolveRequestMessage,
  SolveResult,
  StageName,
  WorkerRejection,
} from "../protocol";
import { payloadToObject } from "../scene/scenePayload";
import { buildKit } from "./buildKit";
import { buildRenderData } from "./renderData";
import { CompileFailureError, mapCoreError } from "./rejection";

/** Injectable pieces of the pipeline, so tests can spy on call order and on the clock. */
export interface BlitzSolveDeps {
  stage0ParseScene: typeof stage0ParseScene;
  stage1Prepare: typeof stage1Prepare;
  stage2BuildDbg: typeof stage2BuildDbg;
  stage3Peel: typeof stage3Peel;
  stage4Compile: typeof stage4Compile;
  now: () => number;
  onStage: (stage: StageName, state: "started" | "completed") => void;
}

export type BlitzSolveOutcome =
  | { kind: "solved"; result: SolveResult }
  | { kind: "rejected"; rejection: WorkerRejection };

function defaultDeps(): BlitzSolveDeps {
  return {
    stage0ParseScene,
    stage1Prepare,
    stage2BuildDbg,
    stage3Peel,
    stage4Compile,
    now: () => performance.now(),
    onStage: () => undefined,
  };
}

/**
 * Runs Core stages 0 to 4 on an existing root. Pure with respect to the DOM and to worker
 * globals, so Vitest calls it in Node.
 *
 * Stage 1 normalizes the assembly to `maxExtent = 1.0` before Stage 2 casts any ray, and every
 * BVH and Blocking_Graph build happens inside this function, which only runs in the worker.
 *
 * There is no early stop for large scenes: a multi-part scene above the Poly_Budget is solved in
 * full and reported through `SolveResult.overBudget`. A single-island scene is always rejected
 * as `monolithic` by Stage 0, whatever its triangle count.
 */
export function solveRoot(root: Object3D, overrides: Partial<BlitzSolveDeps> = {}): BlitzSolveOutcome {
  const d: BlitzSolveDeps = { ...defaultDeps(), ...overrides };
  const startedAt = d.now();
  const stageMs: Partial<Record<StageName, number>> = {};

  const timed = <T>(stage: StageName, run: () => T): T => {
    d.onStage(stage, "started");
    const began = d.now();
    const value = run();
    stageMs[stage] = d.now() - began;
    d.onStage(stage, "completed");
    return value;
  };

  const stage0 = timed("stage0", () => d.stage0ParseScene(root, {}));
  if (stage0.status === "error") {
    return { kind: "rejected", rejection: mapCoreError(stage0.error) };
  }

  const stage1 = timed("stage1", () => d.stage1Prepare(stage0, {}));
  if (stage1.status === "error") {
    return { kind: "rejected", rejection: mapCoreError(stage1.error) };
  }

  const graph = timed("stage2", () => d.stage2BuildDbg(stage1, stage1.config));
  const plan = timed("stage3", () => d.stage3Peel(stage1, graph, stage1.config));

  let trajectories: TrajectoryStep[] | null = null;
  if (plan.status === "solved") {
    const compiled = timed("stage4", () => d.stage4Compile(plan, stage1, stage1.config));
    if (!compiled.ok) {
      throw new CompileFailureError(compiled.error.kind, compiled.error.message);
    }
    trajectories = compiled.steps;
  }

  const { sampling } = stage0;
  const overBudget: OverBudgetWarning | null = sampling.polyBudgetExceeded
    ? { totalTriangles: sampling.totalTriangles, polyBudget: sampling.polyBudget, stride: sampling.stride }
    : null;

  const edges: BlitzEdge[] = graph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    dirIndex: edge.dirIndex,
  }));

  const parts = buildRenderData(stage1.parts, root);

  return {
    kind: "solved",
    result: {
      parts,
      edges,
      plan,
      trajectories,
      overBudget,
      timings: { totalMs: d.now() - startedAt, stageMs },
    },
  };
}

/** Builds the root for the request (kit builder or rebuilt payload), then calls {@link solveRoot}. */
export function runBlitzSolve(
  request: SolveRequestMessage,
  overrides: Partial<BlitzSolveDeps> = {},
): BlitzSolveOutcome {
  const root =
    request.source.kind === "bundled"
      ? buildKit(request.source.levelId)
      : payloadToObject(request.source.scene.root);
  return solveRoot(root, overrides);
}
