/**
 * Public API of `@unboltkit/core` (Req 30). Consumers import everything from the package root,
 * so no import path into `src/` subdirectories is needed.
 *
 * Every stage function returns its result directly, as a plain value and never a Promise
 * (Req 1.4), so it can be called synchronously from a Web Worker.
 */

/** Package version. Equal to the `version` field of `package.json` (Req 30.5). */
export const UNBOLT_CORE_VERSION = "0.1.0";

// Pipeline entry and the five stages.
export { solveDisassembly } from "./pipeline";
export { stage0ParseScene, computeSamplingMetadata, POLY_BUDGET } from "./stage0/stage0";
export { stage1Prepare } from "./stage1/stage1";
export { stage2BuildDbg } from "./stage2/dbgBuilder";
export { stage3Peel } from "./stage3/peelSolver";
export { stage4Compile } from "./stage4/trajectoryCompiler";

// Motion primitives.
export { createPrimitiveRegistry, createDefaultPrimitiveRegistry } from "./primitives/registry";

// Independent oracle and baseline.
export { checkClashes } from "./oracle/clashChecker";
export { verifyLinearMove, verifyTrajectory, combineVerdicts } from "./oracle/moveVerifier";
export { computeNaiveRadialClashes } from "./stage4/naiveBaseline";

// Configuration and constants.
export { validateConfig, DEFAULT_SOLVER_CONFIG, DEFAULT_SEED } from "./config";
export { CANONICAL_DIRECTIONS } from "./stage1/candidateAxes";

// Errors that stage functions throw.
export {
  UnboltCoreError,
  InvalidSampleCountError,
  Stage1FailureError,
  DeadlockWitnessInvariantError,
  PrimitiveRangeError,
  PrimitiveParamError,
  InvalidDirectionError,
  MovingPartInStaticSetError,
  AssemblyNotNormalizedError,
  InvalidSolverConfigError,
  InvalidMoveDistanceError,
  InvalidTrajectoryError,
} from "./errors";
export type { PlainNumber, Stage1Component } from "./errors";

// Types.
export type { SolverConfig, ResolvedSolverConfig, ConfigValidation } from "./config";
export type { DbgOptions } from "./stage2/dbgBuilder";
export type * from "./types";
export type * from "./primitives/types";
