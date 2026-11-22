/**
 * The Solver_Worker pipeline as a plain function (Requirements 5.1, 5.2, 5.5, 5.7, 5.8, 9.1, 9.2).
 *
 * `runSolve` holds no DOM, worker-global or React reference, so Vitest can call it in Node. The
 * clock, the clash checker and the progress sink are injectable through {@link PipelineDeps}. The
 * defaults use `performance.now`, Core `checkClashes` and a sink that drops events.
 *
 * Stage order: stage0, stage1, stage2, stage3, then for a solved plan stage4, oracle and naive,
 * and for a deadlocked plan naive only. Each executed stage posts `started` and `completed`.
 * The Core plan is returned as Core produced it. This module never edits `steps`, `witness`,
 * `normalization` or `sampling`.
 */
import type { Object3D } from "three";
import {
  checkClashes as coreCheckClashes,
  computeNaiveRadialClashes,
  stage0ParseScene,
  stage1Prepare,
  stage2BuildDbg,
  stage3Peel,
  stage4Compile,
  type CompileError,
  type DisassemblyPlan,
  type NaiveBaselineResult,
  type TrajectoryStep,
} from "@unboltkit/core";
import type {
  OracleReport,
  SolveRequestMessage,
  SolveResult,
  StageName,
  StageProgressEvent,
} from "../protocol";
import { payloadToObject } from "../scene/scenePayload";
import { buildKit } from "./buildKit";
import { buildRenderData } from "./renderData";
import { runOracle } from "./oracle";

export interface PipelineDeps {
  /** Millisecond clock. `performance.now` by default, a fake clock in tests. */
  now: () => number;
  /** Clash checker used by the oracle. Core `checkClashes` by default. */
  checkClashes: typeof coreCheckClashes;
  /** Receives every Stage_Progress_Event, in the order the events occur. */
  onProgress: (event: StageProgressEvent) => void;
}

/** Real dependencies. `onProgress` drops events, so `runSolve(request)` works without wiring. */
export const DEFAULT_PIPELINE_DEPS: PipelineDeps = {
  now: () => performance.now(),
  checkClashes: coreCheckClashes,
  onProgress: () => undefined,
};

/** Name of {@link CompileFailureError}. */
export const COMPILE_FAILURE_NAME = "CompileFailureError";

/**
 * Thrown when `stage4Compile` returns `ok: false` for a solved plan. `code` is the compile error
 * `kind`, so `toSolveFailure` carries it to the main thread.
 */
export class CompileFailureError extends Error {
  readonly code: string;
  readonly compileError: CompileError;

  constructor(compileError: CompileError) {
    super(compileError.message);
    this.name = COMPILE_FAILURE_NAME;
    this.code = compileError.kind;
    this.compileError = compileError;
  }
}

/** Rebuilds or builds the source `Object3D` root for a request (Requirements 6.3 and 7.8). */
function resolveRoot(request: SolveRequestMessage): Object3D {
  const { source } = request;
  if (source.kind === "kit") {
    return buildKit(source.kitName);
  }
  return payloadToObject(source.scene.root);
}

/**
 * Runs one solve.
 *
 * @param deps Any subset of {@link PipelineDeps}. Missing members take the defaults.
 * @throws UnknownKitError for a kit name outside the five bundled names.
 * @throws CompileFailureError when `stage4Compile` returns `ok: false`.
 * Errors thrown by Core stages, `checkClashes` or `computeNaiveRadialClashes` propagate unchanged.
 */
export function runSolve(request: SolveRequestMessage, deps: Partial<PipelineDeps> = {}): SolveResult {
  const now = deps.now ?? DEFAULT_PIPELINE_DEPS.now;
  const check = deps.checkClashes ?? DEFAULT_PIPELINE_DEPS.checkClashes;
  const onProgress = deps.onProgress ?? DEFAULT_PIPELINE_DEPS.onProgress;

  const solveStart = now();
  const stageMs: Partial<Record<StageName, number>> = {};

  /** Posts `started`, runs `fn`, posts `completed` with the stage duration. */
  const timed = <T>(stage: StageName, fn: () => T): T => {
    const stageStart = now();
    onProgress({ stage, state: "started", elapsedMs: stageStart - solveStart, durationMs: null });
    const value = fn();
    const stageEnd = now();
    const durationMs = stageEnd - stageStart;
    stageMs[stage] = durationMs;
    onProgress({ stage, state: "completed", elapsedMs: stageEnd - solveStart, durationMs });
    return value;
  };

  const finish = (
    plan: DisassemblyPlan,
    trajectory: TrajectoryStep[] | null,
    oracle: OracleReport | null,
    naive: NaiveBaselineResult | null,
    parts: SolveResult["parts"],
  ): SolveResult => ({
    plan,
    trajectory,
    oracle,
    naive,
    parts,
    timings: { totalMs: now() - solveStart, stageMs },
  });

  const root = resolveRoot(request);

  const stage0 = timed("stage0", () => stage0ParseScene(root, {}));
  const stage1 = timed("stage1", () => stage1Prepare(stage0, {}));
  if (stage1.status === "error") {
    // The error is the plan, as `solveDisassembly` returns it for the same input.
    return finish(stage1, null, null, null, []);
  }

  const graph = timed("stage2", () => stage2BuildDbg(stage1, stage1.config));
  const plan = timed("stage3", () => stage3Peel(stage1, graph, stage1.config));

  if (plan.status === "solved") {
    const compiled = timed("stage4", () => stage4Compile(plan, stage1, stage1.config));
    if (!compiled.ok) {
      throw new CompileFailureError(compiled.error);
    }
    const oracle = timed("oracle", () => runOracle(plan.steps, stage1.parts, stage1.config, check));
    const naive = timed("naive", () => computeNaiveRadialClashes(stage1, stage1.config));
    return finish(plan, compiled.steps, oracle, naive, buildRenderData(stage1.parts, root));
  }

  // Deadlocked: no trajectory and no oracle. The naive baseline still runs.
  const naive = timed("naive", () => computeNaiveRadialClashes(stage1, stage1.config));
  return finish(plan, null, null, naive, buildRenderData(stage1.parts, root));
}
