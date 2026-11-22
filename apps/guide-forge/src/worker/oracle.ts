/**
 * Independent clash oracle for a solved plan (Requirement 9).
 *
 * `runOracle` replays every plan step through Core `checkClashes` and sums the counts. The
 * verdict comes only from those counts. This module never reads `plan.status`.
 *
 * `checkClashes` is a parameter, so tests can stub it. It is imported as a type only, which
 * keeps this module free of a runtime Core import.
 */
import type { checkClashes, NormalizedPart, PlanStep, ResolvedSolverConfig, Vec3 } from "@unboltkit/core";
import type { OracleReport } from "../protocol";

export interface OracleJob {
  /** Part_ID of the Part that moves. */
  moving: string;
  /** Unit direction of the step. */
  dir: Vec3;
  /** Part_IDs of every Part whose step comes later in the plan. */
  statics: string[];
}

/**
 * Job `i` moves step `i`'s Part along step `i`'s `dir` against the Parts of steps `i + 1 .. n - 1`
 * (Requirement 9.1). Job order equals step order, and the statics keep step order.
 */
export function buildOracleJobs(steps: readonly PlanStep[]): OracleJob[] {
  return steps.map((step, index) => ({
    moving: step.partId,
    dir: [step.dir[0], step.dir[1], step.dir[2]] as Vec3,
    statics: steps.slice(index + 1).map((later) => later.partId),
  }));
}

/**
 * Calls `check` once per step with the Stage 1 normalized Parts and the resolved config
 * (Requirements 9.1 and 9.2). Returns the per-step counts and their sum (Requirement 9.3).
 *
 * @throws Error when a step names a Part that is not in `parts`. Errors thrown by `check`
 * propagate unchanged, so the worker reports them as a failure (Requirement 9.6).
 */
export function runOracle(
  steps: readonly PlanStep[],
  parts: readonly NormalizedPart[],
  config: ResolvedSolverConfig,
  check: typeof checkClashes,
): OracleReport {
  const byId = new Map<string, NormalizedPart>();
  for (const part of parts) {
    byId.set(part.partId, part);
  }
  const lookup = (partId: string): NormalizedPart => {
    const part = byId.get(partId);
    if (part === undefined) {
      throw new Error(`Oracle: plan step names Part "${partId}", which is not among the Stage 1 parts`);
    }
    return part;
  };

  const perStep: OracleReport["perStep"] = [];
  let totalClashes = 0;
  for (const job of buildOracleJobs(steps)) {
    const result = check(lookup(job.moving), job.dir, job.statics.map(lookup), config);
    perStep.push({ partId: job.moving, clashCount: result.count });
    totalClashes += result.count;
  }
  return { perStep, totalClashes };
}
