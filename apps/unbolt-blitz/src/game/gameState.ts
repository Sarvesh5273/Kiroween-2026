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
import type { EngineLevel, EngineState } from "./blitzEngine";
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
}

export type GameAction =
  | { type: "LEVEL_REQUESTED"; ref: LevelRef; label: string; requestId: number; at: number }
  | { type: "LEVEL_LOADED"; requestId: number; loaded: LoadedLevel; engineLevel: EngineLevel; at: number }
  | { type: "SOLVE_REJECTED"; requestId: number; cause: RecoveryCause; at: number }
  | { type: "SOLVE_FAILED"; requestId: number; failure: SolveFailure; at: number }
  /** Starts the stopwatch (Req 13.10). Ignored unless `epoch` is the current one. */
  | { type: "ARENA_READY"; epoch: number; at: number }
  | { type: "PART_CLICKED"; partId: string; at: number }
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
