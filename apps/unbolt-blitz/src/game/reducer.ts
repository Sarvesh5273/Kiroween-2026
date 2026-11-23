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
  planExplicitAttempt,
  removedCount,
  resolveExplicitHelical,
  resolveExplicitStraight,
} from "./blitzEngine";
import type { EngineState, ExplicitAxis, UnboltResult } from "./blitzEngine";
import type { CompletionSummary, DecisionBasis, GameEvent, GameEventDraft, UnresolvedReason } from "./events";
import { INITIAL_CLOCK } from "./gameState";
import type { AttemptCheckResult, GameAction, GameClock, GameState, LoadedLevel } from "./gameState";

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
    pendingAttempt: null,
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

/** Events and state for an engine result that removed or blocked a part. */
function applyUnbolt(
  state: GameState,
  nextEngine: EngineState,
  result: Extract<UnboltResult, { kind: "legal" | "blocked" }>,
  basis: DecisionBasis,
  at: number,
): GameState {
  if (result.kind === "blocked") {
    return withEvents({ ...state, engine: nextEngine }, at, [
      {
        kind: "part_blocked",
        partId: result.partId,
        blockerIds: [...result.blockerIds],
        basis,
        axisIndex: result.axisIndex,
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
      partId: result.partId,
      step: result.step,
      basis,
      axisIndex: result.axisIndex,
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

function partClicked(state: GameState, partId: string, at: number): GameState {
  const engine = state.engine;
  if (engine === null || currentLoaded(state) === null) return state;
  // While an explicit attempt is being checked the live parts must not change under it.
  if (state.pendingAttempt !== null) {
    return withEvents(state, at, [{ kind: "click_rejected", partId, reason: "attempt_pending" }]);
  }
  const { state: nextEngine, result } = attemptUnbolt(engine, partId);
  if (result.kind === "rejected") {
    return withEvents(state, at, [{ kind: "click_rejected", partId, reason: result.reason }]);
  }
  return applyUnbolt(state, nextEngine, result, "blocking_graph", at);
}

/**
 * A click with an attempt axis chosen. The axis is used as given. A helical unscrew is decided at
 * once from the blocking graph, as in the normal game. A straight move waits for its check: the
 * part stays where it is and nothing scores until `EXPLICIT_ATTEMPT_CHECKED` arrives.
 */
function explicitAttempt(state: GameState, partId: string, axis: ExplicitAxis, attemptId: number, at: number): GameState {
  const engine = state.engine;
  if (engine === null || currentLoaded(state) === null) return state;
  if (state.pendingAttempt !== null) {
    return withEvents(state, at, [{ kind: "click_rejected", partId, reason: "attempt_pending" }]);
  }
  const plan = planExplicitAttempt(engine, partId, axis);
  if (plan.kind === "rejected") {
    return withEvents(state, at, [{ kind: "click_rejected", partId, reason: plan.reason }]);
  }
  if (plan.kind === "helical") {
    const { state: nextEngine, result } = resolveExplicitHelical(engine, plan);
    if (result.kind === "rejected") {
      return withEvents(state, at, [{ kind: "click_rejected", partId, reason: result.reason }]);
    }
    return applyUnbolt(state, nextEngine, result, "blocking_graph", at);
  }
  return withEvents({ ...state, pendingAttempt: { attemptId, plan } }, at, [
    {
      kind: "attempt_checking",
      partId,
      axisIndex: plan.axisIndex,
      travel: plan.travel,
      staticPartIds: [...plan.staticPartIds],
    },
  ]);
}

const UNRESOLVED_DETAIL: Readonly<Record<UnresolvedReason, string>> = {
  unverified: "The check could not decide this move.",
  stale: "The answer was for a different move.",
  not_extracted: "The move would not take the part clear of the assembly.",
  error: "The check did not finish.",
  cancelled: "The axis changed before the check finished.",
};

/**
 * A new attempt axis. A different axis (or Auto) cancels the pending attempt at once: its later
 * reply no longer matches `pendingAttempt` and is ignored, so it can never remove or score a part.
 */
function attemptAxisSet(state: GameState, axis: ExplicitAxis | null, at: number): GameState {
  if (axis === state.attemptAxis) return state;
  const pending = state.pendingAttempt;
  const next: GameState = { ...state, attemptAxis: axis, pendingAttempt: null };
  if (pending === null) return next;
  return withEvents(next, at, [
    {
      kind: "attempt_unresolved",
      partId: pending.plan.partId,
      axisIndex: pending.plan.axisIndex,
      reason: "cancelled",
      detail: UNRESOLVED_DETAIL.cancelled,
    },
  ]);
}

function explicitChecked(state: GameState, attemptId: number, outcome: AttemptCheckResult, at: number): GameState {
  const pending = state.pendingAttempt;
  // A late answer: the attempt was replaced, the level was replayed or another level loaded.
  if (pending === null || pending.attemptId !== attemptId) return state;
  const cleared: GameState = { ...state, pendingAttempt: null };
  const { plan } = pending;
  const unresolved = (reason: UnresolvedReason, detail: string): GameState =>
    withEvents(cleared, at, [{ kind: "attempt_unresolved", partId: plan.partId, axisIndex: plan.axisIndex, reason, detail }]);
  const engine = state.engine;
  if (engine === null) return unresolved("stale", UNRESOLVED_DETAIL.stale);
  if (outcome.kind === "error") return unresolved("error", `${UNRESOLVED_DETAIL.error} ${outcome.message}`);
  const resolved = resolveExplicitStraight(engine, plan, outcome.check);
  if (resolved.kind === "unresolved") return unresolved(resolved.reason, UNRESOLVED_DETAIL[resolved.reason]);
  return applyUnbolt(cleared, resolved.state, resolved.result, "checked_straight", at);
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
    case "ATTEMPT_AXIS_SET":
      return attemptAxisSet(state, action.axis, action.at);
    case "EXPLICIT_ATTEMPT":
      return explicitAttempt(state, action.partId, action.axis, action.attemptId, action.at);
    case "EXPLICIT_ATTEMPT_CHECKED":
      return explicitChecked(state, action.attemptId, action.result, action.at);

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
