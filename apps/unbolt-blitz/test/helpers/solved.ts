import type { Object3D } from "three";
import {
  buildDeadlockCageDumbbellRing,
  buildDeadlockCageShipInBottle,
  buildHauntedClockworkLockbox,
} from "@unboltkit/sample-kits";
import type { SolveRequestMessage, SolveResult } from "../../src/protocol";
import { runBlitzSolve, solveRoot } from "../../src/worker/runBlitzSolve";
import type { BlitzSolveOutcome } from "../../src/worker/runBlitzSolve";

/**
 * Memoized real solves for the slow tests. Each solve runs the real Core stages 0 to 4 once per
 * Vitest worker, and every test file that needs the same kit shares the cached outcome. The
 * helper holds no randomness: the kit builders are deterministic.
 *
 * Callers must treat the returned outcomes as read-only. A test that needs to mutate a result
 * should copy it first.
 */

export const MIN_GEAR_COUNT = 2;
export const MAX_GEAR_COUNT = 5;

/** The request that loads the default Lockbox through the worker pipeline. */
export const DEFAULT_LOCKBOX_REQUEST: SolveRequestMessage = Object.freeze({
  type: "solve",
  requestId: 1,
  source: Object.freeze({ kind: "bundled", levelId: "lockbox" }),
}) as SolveRequestMessage;

const lockboxByGearCount = new Map<number, BlitzSolveOutcome>();
const cageOutcomes = new Map<"dumbbell-ring" | "ship-in-bottle", BlitzSolveOutcome>();
let defaultLockboxViaRunner: BlitzSolveOutcome | undefined;

function assertGearCount(gearCount: number): void {
  if (!Number.isInteger(gearCount) || gearCount < MIN_GEAR_COUNT || gearCount > MAX_GEAR_COUNT) {
    throw new RangeError(
      `gearCount must be an integer from ${MIN_GEAR_COUNT} to ${MAX_GEAR_COUNT}, got ${gearCount}`,
    );
  }
}

/** A fresh Haunted Clockwork Lockbox root. Not memoized, so callers may inspect or mutate it. */
export function buildLockboxRoot(gearCount: number): Object3D {
  assertGearCount(gearCount);
  return buildHauntedClockworkLockbox({ gearCount });
}

/** Memoized `solveRoot` outcome for `buildHauntedClockworkLockbox({ gearCount })`, gearCount 2 to 5. */
export function solvedLockbox(gearCount: number): BlitzSolveOutcome {
  assertGearCount(gearCount);
  const cached = lockboxByGearCount.get(gearCount);
  if (cached !== undefined) {
    return cached;
  }
  const outcome = solveRoot(buildLockboxRoot(gearCount));
  lockboxByGearCount.set(gearCount, outcome);
  return outcome;
}

/** Memoized `solveRoot` outcome for the Dumbbell-in-Ring Deadlock Cage. */
export function solvedDumbbellCage(): BlitzSolveOutcome {
  const cached = cageOutcomes.get("dumbbell-ring");
  if (cached !== undefined) {
    return cached;
  }
  const outcome = solveRoot(buildDeadlockCageDumbbellRing());
  cageOutcomes.set("dumbbell-ring", outcome);
  return outcome;
}

/** Memoized `solveRoot` outcome for the Ship-in-Bottle Deadlock Cage. */
export function solvedShipInBottle(): BlitzSolveOutcome {
  const cached = cageOutcomes.get("ship-in-bottle");
  if (cached !== undefined) {
    return cached;
  }
  const outcome = solveRoot(buildDeadlockCageShipInBottle());
  cageOutcomes.set("ship-in-bottle", outcome);
  return outcome;
}

/**
 * Memoized `runBlitzSolve` outcome for the default Lockbox, requested through
 * `{ type: "solve", requestId: 1, source: { kind: "bundled", levelId: "lockbox" } }`.
 */
export function solvedDefaultLockboxViaRunner(): BlitzSolveOutcome {
  if (defaultLockboxViaRunner === undefined) {
    defaultLockboxViaRunner = runBlitzSolve(DEFAULT_LOCKBOX_REQUEST);
  }
  return defaultLockboxViaRunner;
}

/** Narrows an outcome to its `SolveResult`. Throws when the pipeline rejected the scene. */
export function requireSolveResult(outcome: BlitzSolveOutcome): SolveResult {
  if (outcome.kind !== "solved") {
    throw new Error(`expected a solved outcome, got rejection "${outcome.rejection.reason}"`);
  }
  return outcome.result;
}
