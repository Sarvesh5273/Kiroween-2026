/**
 * Read-only views of `GameState` for the HUD and Part 2 modules.
 * Pure: `now` is passed in, never read from a clock.
 */
import { removedCount } from "./blitzEngine";
import type { LevelOutcome } from "./blitzEngine";
import type { GameState, LoadedLevel } from "./gameState";

/**
 * Elapsed_Time: accrued running time, plus the time since the clock started,
 * plus Time_Penalties. After completion it is the frozen final value.
 */
export function elapsedMs(state: GameState, now: number): number {
  if (state.finalElapsedMs !== null) return state.finalElapsedMs;
  const running = state.clock.runningSince === null ? 0 : Math.max(0, now - state.clock.runningSince);
  const penalty = state.engine === null ? 0 : state.engine.penaltyMs;
  return state.clock.accruedMs + running + penalty;
}

export function score(state: GameState): number {
  return state.engine === null ? 0 : state.engine.score;
}

export function combo(state: GameState): number {
  return state.engine === null ? 1 : state.engine.combo;
}

export function mistakes(state: GameState): number {
  return state.engine === null ? 0 : state.engine.mistakes;
}

export function falseAlarms(state: GameState): number {
  return state.engine === null ? 0 : state.engine.falseAlarms;
}

/** Removed and total part counts. Both 0 when no level is loaded. */
export function progress(state: GameState): { removed: number; total: number } {
  if (state.engine === null) return { removed: 0, total: 0 };
  return { removed: removedCount(state.engine), total: state.engine.level.parts.length };
}

export function outcome(state: GameState): LevelOutcome | null {
  return state.engine === null ? null : state.engine.outcome;
}

export function loadedLevel(state: GameState): LoadedLevel | null {
  return state.screen.kind === "level" ? state.screen.loaded : null;
}
