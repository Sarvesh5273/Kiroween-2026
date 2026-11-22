import type { Object3D } from "three";
import type { SolverConfig } from "../../src/config";
import { checkClashes } from "../../src/oracle/clashChecker";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import { stage2BuildDbg } from "../../src/stage2/dbgBuilder";
import { stage3Peel } from "../../src/stage3/peelSolver";
import type {
  DeadlockedPlan,
  ErrorResult,
  PlanStep,
  SolvedPlan,
  Stage0Result,
  Stage1Result,
  Vec3,
} from "../../src/types";
/**
 * A solve that keeps the intermediate stage results.
 *
 * `solveDisassembly` runs `stage0ParseScene → stage1Prepare → stage2BuildDbg → stage3Peel`
 * (Req 30.6), so this runs the same four calls. It keeps `stage0` (world-space Parts) and
 * `stage1` (the normalized Parts, in the coordinates the solver used) because the invariant
 * tests need both: the Clash_Checker oracle must see the solver's own `NormalizedPart` objects
 * and its resolved Solver_Config.
 */
export type StagedSolve =
  | { status: "ok"; stage0: Stage0Result; stage1: Stage1Result; plan: SolvedPlan | DeadlockedPlan }
  | { status: "error"; plan: ErrorResult };
/** Runs Stages 0 to 3 on `root`. Thrown solver errors propagate to the caller. */
export function solveStaged(root: Object3D, config?: SolverConfig): StagedSolve {
  const stage0 = stage0ParseScene(root, config);
  if (stage0.status === "error") {
    return { status: "error", plan: stage0 };
  }
  const stage1 = stage1Prepare(stage0, config);
  if (stage1.status === "error") {
    return { status: "error", plan: stage1 };
  }
  const graph = stage2BuildDbg(stage1, stage1.config);
  const plan = stage3Peel(stage1, graph, stage1.config);
  return { status: "ok", stage0, stage1, plan };
}
/** One Plan_Step whose move is not clash-free, with everything needed to reproduce it. */
export interface StepClash {
  stepIndex: number;
  partId: string;
  dir: Vec3;
  count: number;
  movingTriangles: number[];
  staticTriangles: { partId: string; triangles: number[] }[];
}
/**
 * The first step `i` of `steps` for which the Clash_Checker reports at least 1
 * Opposing_Normal_Collision, or `null` when every step is clash-free (Req 26.1, 27.4, 29.7).
 *
 * The moving Part is the step's Part moved along `dir`. The static set is exactly the Parts of
 * the steps after `i`, unmoved, in the normalized coordinates of `stage1`, and the oracle uses
 * the Solver_Config that produced the plan (`stage1.config`).
 *
 * Every call passes the same `NormalizedPart` objects of the one `stage1`, so the oracle's
 * per-Part ray-source cache is built once per Part per solve and not once per step.
 *
 * @throws RangeError when a step names a Part that is not in `stage1`.
 */
export function findFirstStepClash(stage1: Stage1Result, steps: readonly PlanStep[]): StepClash | null {
  const partById = new Map(stage1.parts.map((part) => [part.partId, part]));
  const ordered = steps.map((step) => {
    const part = partById.get(step.partId);
    if (part === undefined) {
      throw new RangeError(`plan step names Part ${step.partId}, which is not a Part of the Assembly`);
    }
    return part;
  });
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as PlanStep;
    const moving = ordered[i];
    if (moving === undefined) {
      throw new RangeError(`no Part for step ${i}`);
    }
    const result = checkClashes(moving, step.dir, ordered.slice(i + 1), stage1.config);
    if (result.count > 0) {
      return {
        stepIndex: i,
        partId: step.partId,
        dir: step.dir,
        count: result.count,
        movingTriangles: result.movingTriangles,
        staticTriangles: result.staticTriangles,
      };
    }
  }
  return null;
}
