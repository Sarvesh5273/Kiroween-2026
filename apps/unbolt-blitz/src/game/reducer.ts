/**
 * `gameReducer`: a pure function of the previous state and an action (Req 8.1).
 *
 * It reads no clock and sets no timer. Every time value arrives in the action as
 * `at`. It never mutates its input, and an ignored action returns the identical
 * state object. The state has no animation field (Req 11.6).
 */
import {
  attemptUnbolt,
  createEngine,
  flagDeadlockTrap,
  removedCount,
} from "./blitzEngine";
import type { EngineState } from "./blitzEngine";
import type { CompletionSummary, GameEvent, GameEventDraft } from "./events";
import { INITIAL_CLOCK } from "./gameState";
import type { GameAction, GameClock, GameState, LoadedLevel } from "./gameState";

/** Stamps `seq` and `at` on each draft and appends it to the log. */
function withEvents(state: GameState, at: number, drafts: readonly GameEventDraft[]): GameState {
  if (drafts.length === 0) return state;
  const stamped = drafts.map(
    (draft, index) => ({ ...draft, seq: state.nextEventSeq + index, at }) as GameEvent,
  );
  return {
    ...state,
    events: [...state.events, ...stamped],
    nextEventSeq: state.nextEventSeq + drafts.length,
  };
}

/** Clears engine, clock, final time and the event log. The latest request id is kept. */
function resetPerLevel(state: GameState): GameState {
  return {
    ...state,
    engine: null,
    clock: INITIAL_CLOCK,
    finalElapsedMs: null,
    nextEventSeq: 0,
    events: [],
  };
}

function currentLoaded(state: GameState): LoadedLevel | null {
  return state.screen.kind === "level" ? state.screen.loaded : null;
}

/** True while a solve for `requestId` is the one in flight. */
function isAwaiting(state: GameState, requestId: number): boolean {
  return (
    requestId === state.latestRequestId &&
    state.screen.kind === "loading" &&
    state.screen.requestId === requestId
  );
}

/** Stops the clock at `at`; `penaltyMs` is added on top by the caller. */
function stoppedClock(clock: GameClock, at: number): GameClock {
  const running = clock.runningSince === null ? 0 : Math.max(0, at - clock.runningSince);
  return { accruedMs: clock.accruedMs + running, runningSince: null };
}

function summaryOf(engine: EngineState, elapsedMs: number): CompletionSummary {
  return {
    score: engine.score,
    elapsedMs,
    mistakes: engine.mistakes,
    falseAlarms: engine.falseAlarms,
    removed: removedCount(engine),
    total: engine.level.parts.length,
  };
}

/** Applies `engine` and, when it carries an outcome, freezes the clock and returns the final time. */
function settle(state: GameState, engine: EngineState, at: number): {
  state: GameState;
  completedElapsedMs: number | null;
} {
  if (engine.outcome === null) return { state: { ...state, engine }, completedElapsedMs: null };
  const clock = stoppedClock(state.clock, at);
  const finalElapsedMs = clock.accruedMs + engine.penaltyMs;
  return { state: { ...state, engine, clock, finalElapsedMs }, completedElapsedMs: finalElapsedMs };
}

function partClicked(state: GameState, partId: string, at: number): GameState {
  const engine = state.engine;
  if (engine === null || currentLoaded(state) === null) return state;

  const { state: nextEngine, result } = attemptUnbolt(engine, partId);
  if (result.kind === "rejected") {
    return withEvents(state, at, [{ kind: "click_rejected", partId, reason: result.reason }]);
  }

  if (result.kind === "blocked") {
    return withEvents({ ...state, engine: nextEngine }, at, [
      {
        kind: "part_blocked",
        partId,
        blockerIds: [...result.blockerIds],
        comboBefore: result.comboBefore,
        comboAfter: 1,
        penaltyMs: 3000,
        mistakes: result.mistakes,
        scoreAfter: nextEngine.score,
      },
    ]);
  }

  const drafts: GameEventDraft[] = [
    {
      kind: "part_removed",
      partId,
      step: result.step,
      points: result.points,
      fastenerBonus: result.fastenerBonus,
      awarded: result.awarded,
      comboBefore: result.comboBefore,
      comboAfter: result.comboAfter,
      scoreAfter: nextEngine.score,
      removed: removedCount(nextEngine),
      total: nextEngine.level.parts.length,
    },
  ];
  const settled = settle(state, nextEngine, at);
  if (settled.completedElapsedMs !== null && nextEngine.outcome !== null) {
    drafts.push({
      kind: "level_completed",
      outcome: nextEngine.outcome,
      summary: summaryOf(nextEngine, settled.completedElapsedMs),
      sccs: [],
    });
  }
  return withEvents(settled.state, at, drafts);
}

function trapFlagged(state: GameState, at: number): GameState {
  const engine = state.engine;
  if (engine === null || currentLoaded(state) === null) return state;

  const { state: nextEngine, result } = flagDeadlockTrap(engine);
  if (result.kind === "rejected") return state;

  if (result.kind === "false_alarm") {
    return withEvents({ ...state, engine: nextEngine }, at, [
      {
        kind: "false_alarm",
        penaltyApplied: result.penaltyApplied,
        comboBefore: result.comboBefore,
        scoreAfter: result.scoreAfter,
        penaltyMs: 3000,
        falseAlarms: result.falseAlarms,
      },
    ]);
  }

  const settled = settle(state, nextEngine, at);
  const drafts: GameEventDraft[] = [
    {
      kind: "trap_flagged",
      sccs: result.sccs.map((scc) => [...scc]),
      bonus: 1000,
      scoreAfter: result.scoreAfter,
    },
  ];
  if (settled.completedElapsedMs !== null && nextEngine.outcome !== null) {
    drafts.push({
      kind: "level_completed",
      outcome: nextEngine.outcome,
      summary: summaryOf(nextEngine, settled.completedElapsedMs),
      sccs: result.sccs.map((scc) => [...scc]),
    });
  }
  return withEvents(settled.state, at, drafts);
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "LEVEL_REQUESTED": {
      const reset = resetPerLevel(state);
      return {
        ...reset,
        screen: { kind: "loading", ref: action.ref, label: action.label, requestId: action.requestId },
        latestRequestId: action.requestId,
      };
    }

    case "LEVEL_LOADED": {
      if (!isAwaiting(state, action.requestId)) return state;
      const reset = resetPerLevel(state);
      return withEvents(
        {
          ...reset,
          screen: { kind: "level", loaded: action.loaded },
          engine: createEngine(action.engineLevel),
        },
        action.at,
        [
          {
            kind: "level_loaded",
            epoch: action.loaded.epoch,
            label: action.loaded.label,
            totalParts: action.engineLevel.parts.length,
          },
        ],
      );
    }

    case "SOLVE_REJECTED": {
      if (!isAwaiting(state, action.requestId)) return state;
      return { ...resetPerLevel(state), screen: { kind: "recovery", cause: action.cause } };
    }

    case "SOLVE_FAILED": {
      if (!isAwaiting(state, action.requestId)) return state;
      return {
        ...resetPerLevel(state),
        screen: { kind: "recovery", cause: { reason: "unexpected", message: action.failure.message } },
      };
    }

    case "ARENA_READY": {
      const loaded = currentLoaded(state);
      if (loaded === null || loaded.epoch !== action.epoch) return state;
      if (state.engine === null || state.engine.outcome !== null) return state;
      if (state.clock.runningSince !== null) return state;
      // The level clock starts from zero here and only here. Worker solve time, mesh building and
      // shader compilation all happen before this action, so none of it can be counted.
      return withEvents(
        { ...state, clock: { accruedMs: 0, runningSince: action.at } },
        action.at,
        [{ kind: "level_started", epoch: loaded.epoch }],
      );
    }

    case "PART_CLICKED":
      return partClicked(state, action.partId, action.at);

    case "TRAP_FLAGGED":
      return trapFlagged(state, action.at);

    case "REPLAY": {
      const loaded = currentLoaded(state);
      if (loaded === null || state.engine === null) return state;
      const replayed: LoadedLevel = { ...loaded, epoch: loaded.epoch + 1 };
      const level = state.engine.level;
      return withEvents(
        {
          ...resetPerLevel(state),
          screen: { kind: "level", loaded: replayed },
          engine: createEngine(level),
        },
        action.at,
        [{ kind: "level_loaded", epoch: replayed.epoch, label: replayed.label, totalParts: level.parts.length }],
      );
    }

    case "RECOVERY_DISMISSED": {
      if (state.screen.kind !== "recovery") return state;
      return { ...state, screen: { kind: "idle" } };
    }
  }
}
