/**
 * Reducer state, actions and the initial state (design: "State and actions").
 *
 * Pure data and types. The state holds no animation field, so an exit animation
 * can never lock input (Req 11.6). Type-only imports from core and the protocol:
 * no DOM, React or Three.js module.
 */
import type { DeadlockedPlan, SolvedPlan, TrajectoryStep } from "@unboltkit/core";
import type {
  BundledLevelId,
  OverBudgetWarning,
  PartRenderData,
  SolveFailure,
  SolveResult,
} from "../protocol";
import type { RecoveryCause } from "../recovery/recoveryCause";
import type { EngineLevel, EngineState, ExplicitAxis, ExplicitPlan, StraightCheck } from "./blitzEngine";
import type { GameEvent } from "./events";

export type LevelRef =
  | { kind: "bundled"; levelId: BundledLevelId }
  | { kind: "custom"; fileName: string };

export interface LoadedLevel {
  ref: LevelRef;
  label: string;
  /** Increases on every (re)load. The Arena rebuilds its meshes when it changes. */
  epoch: number;
  /** Arena input. */
  parts: readonly PartRenderData[];
  plan: SolvedPlan | DeadlockedPlan;
  trajectories: readonly TrajectoryStep[] | null;
  displayNames: ReadonlyMap<string, string>;
  /** From `SolveResult.overBudget`. Drives the HUD notice; the level stays playable. */
  overBudget: OverBudgetWarning | null;
}

export type Screen =
  | { kind: "idle" }
  | { kind: "loading"; ref: LevelRef; label: string; requestId: number }
  | { kind: "recovery"; cause: RecoveryCause }
  | { kind: "level"; loaded: LoadedLevel };

export interface GameClock {
  accruedMs: number;
  runningSince: number | null;
}

export interface GameState {
  screen: Screen;
  latestRequestId: number;
  /** Score, combo, mistakes, falseAlarms and outcome live here. */
  engine: EngineState | null;
  /** Elapsed_Time inputs. */
  clock: GameClock;
  /** Set at completion; the stopwatch value never changes afterwards. */
  finalElapsedMs: number | null;
  nextEventSeq: number;
  /** Ordered, append-only within a level. */
  events: readonly GameEvent[];
  /**
   * The axis the player chose for explicit attempts, or null for the normal game, where a click
   * lets the engine pick the exit. A player preference, so it survives level changes.
   */
  attemptAxis: ExplicitAxis | null;
  /** The straight explicit attempt waiting for its check. At most one at a time. */
  pendingAttempt: { attemptId: number; plan: Extract<ExplicitPlan, { kind: "straight" }> } | null;
}

/** What came back for a straight explicit attempt. */
export type AttemptCheckResult =
  | { kind: "verdict"; check: StraightCheck }
  | { kind: "error"; message: string };

export type GameAction =
  | { type: "LEVEL_REQUESTED"; ref: LevelRef; label: string; requestId: number; at: number }
  | { type: "LEVEL_LOADED"; requestId: number; loaded: LoadedLevel; engineLevel: EngineLevel; at: number }
  | { type: "SOLVE_REJECTED"; requestId: number; cause: RecoveryCause; at: number }
  | { type: "SOLVE_FAILED"; requestId: number; failure: SolveFailure; at: number }
  /** Starts the stopwatch (Req 13.10). Ignored unless `epoch` is the current one. */
  | { type: "ARENA_READY"; epoch: number; at: number }
  | { type: "PART_CLICKED"; partId: string; at: number }
  /** Choosing a different axis, or Auto, cancels a pending attempt. The same axis changes nothing. */
  | { type: "ATTEMPT_AXIS_SET"; axis: ExplicitAxis | null; at: number }
  /** A click while an attempt axis is chosen: try exactly that axis. */
  | { type: "EXPLICIT_ATTEMPT"; partId: string; axis: ExplicitAxis; attemptId: number; at: number }
  /** The worker's answer for a straight explicit attempt. Ignored unless that attempt is pending. */
  | { type: "EXPLICIT_ATTEMPT_CHECKED"; attemptId: number; result: AttemptCheckResult; at: number }
  | { type: "TRAP_FLAGGED"; at: number }
  /** Same level data, fresh engine, epoch + 1. */
  | { type: "REPLAY"; at: number }
  | { type: "RECOVERY_DISMISSED" };

export const INITIAL_CLOCK: GameClock = { accruedMs: 0, runningSince: null };

export const initialGameState: GameState = {
  screen: { kind: "idle" },
  latestRequestId: 0,
  engine: null,
  clock: INITIAL_CLOCK,
  finalElapsedMs: null,
  nextEventSeq: 0,
  events: [],
  attemptAxis: null,
  pendingAttempt: null,
};

/**
 * Builds the `LoadedLevel` for a `SolveResult`. An over-budget result stays
 * playable: its warning is carried through unchanged in `overBudget`.
 */
export function loadedLevelFromSolve(
  result: SolveResult,
  ref: LevelRef,
  label: string,
  epoch: number,
): LoadedLevel {
  const displayNames = new Map<string, string>();
  for (const part of result.parts) displayNames.set(part.partId, part.displayName);
  return {
    ref,
    label,
    epoch,
    parts: result.parts,
    plan: result.plan,
    trajectories: result.trajectories,
    displayNames,
    overBudget: result.overBudget,
  };
}
