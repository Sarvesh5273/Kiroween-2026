import type { Object3D } from "three";
import { validateConfig, type SolverConfig } from "./config";
import { stage0ParseScene } from "./stage0/stage0";
import { stage1Prepare } from "./stage1/stage1";
import { stage2BuildDbg } from "./stage2/dbgBuilder";
import { stage3Peel } from "./stage3/peelSolver";
import type { DisassemblyPlan } from "./types";

/**
 * Solves the disassembly of the hierarchy under `root`. This runs exactly
 * `validateConfig → stage0ParseScene → stage1Prepare → stage2BuildDbg → stage3Peel`, so calling
 * those stage functions in order on the same input gives a deep-equal plan (Req 30.6).
 *
 * Every condition a caller can cause with ordinary input comes back as a value with
 * `status === 'error'`: an invalid Solver_Config, malformed or non-finite geometry, an empty
 * hierarchy, a monolithic mesh, or an Assembly that cannot be normalized (Req 30.7). The input
 * hierarchy is only read, never changed.
 *
 * Stage 4 is a separate call (`stage4Compile`).
 *
 * @throws Stage1FailureError when a BVH or frame cannot be built (Req 9.11).
 * @throws DeadlockWitnessInvariantError on a broken internal invariant (Req 16.7).
 */
export function solveDisassembly(root: Object3D, config?: SolverConfig): DisassemblyPlan {
  const validation = validateConfig(config);
  if (!validation.ok) {
    return { status: "error", error: validation.error, diagnostics: [] };
  }
  const stage0 = stage0ParseScene(root, config);
  const stage1 = stage1Prepare(stage0, config);
  if (stage1.status === "error") {
    return stage1;
  }
  const graph = stage2BuildDbg(stage1, stage1.config);
  return stage3Peel(stage1, graph, stage1.config);
}
