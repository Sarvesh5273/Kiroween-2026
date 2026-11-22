import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  allLiveBlocked,
  attemptUnbolt,
  createEngine,
  createEngineLevel,
  flagDeadlockTrap,
  liveParts,
} from "../../src/game/blitzEngine";
import type { EngineState } from "../../src/game/blitzEngine";
import { createEngineDeps } from "../../src/engineDeps";
import { mulberry32 } from "../helpers/prng";
import { createReferenceModel, describeMismatch, randomValidOrder } from "../helpers/referenceModel";
import type { ReferenceModel, RefState } from "../helpers/referenceModel";
import { SEEDS } from "../helpers/seeds";
import { generateSyntheticLevel } from "../helpers/syntheticLevel";
import type { SyntheticLevel } from "../helpers/syntheticLevel";

/**
 * Property 9: The trap flag agrees with an independent deadlock oracle.
 *
 * The oracle is `ReferenceModel.deadlockOracle` (peel, then mutual reachability). The engine reads
 * the static witness SCCs and checks whether they are fully live, so the two take different paths
 * to the same verdict. Levels are seeded synthetic levels, walked along seeded valid removal orders.
 * At every prefix the flag is applied to a branch, so the walk itself continues. No part id is
 * written in this file: every id comes from the generated level.
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.10, 14.8, 17.4, 17.5**
 */

const FALSE_ALARM_PENALTY_POINTS = 250;
const TIME_PENALTY_MS = 3000;
const TRAP_BONUS_POINTS = 1000;

interface Tally {
  genuine: number;
  falseAlarmSolvable: number;
  /** False alarms on a deadlocked level once the SCC is no longer fully live (derived state). */
  falseAlarmBrokenScc: number;
  /** False alarms where the score was below 250, so the floor at 0 applies or is exercised. */
  scoreBelowPenalty: number;
  scoreAtOrAbovePenalty: number;
  /** False alarms committed to the walk, followed by a legal removal. */
  playableAfterFalseAlarm: number;
  stalemates: number;
  completedRejections: number;
}

function newTally(): Tally {
  return {
    genuine: 0,
    falseAlarmSolvable: 0,
    falseAlarmBrokenScc: 0,
    scoreBelowPenalty: 0,
    scoreAtOrAbovePenalty: 0,
    playableAfterFalseAlarm: 0,
    stalemates: 0,
    completedRejections: 0,
  };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical form of a list of SCCs: members sorted, groups sorted. */
function sccKeys(sccs: readonly (readonly string[])[]): string[] {
  return sccs.map((scc) => [...scc].sort(compareIds).join(",")).sort(compareIds);
}

/** After completion every further call is rejected and returns the very same state object. */
function expectRejectedForever(state: EngineState, partIds: readonly string[], tally: Tally): void {
  expect(state.outcome).not.toBeNull();
  const flag = flagDeadlockTrap(state);
  expect(flag.result.kind).toBe("rejected");
  expect(flag.state).toBe(state);
  for (const partId of partIds) {
    const attempt = attemptUnbolt(state, partId);
    expect(attempt.result).toEqual({ kind: "rejected", partId, reason: "level_complete" });
    expect(attempt.state).toBe(state);
  }
  tally.completedRejections += 1;
}

/**
 * Applies the trap flag to `es` and `rs` and checks the engine against the oracle and the
 * reference model. Returns the post-flag states.
 */
function checkFlag(
  es: EngineState,
  rs: RefState,
  model: ReferenceModel,
  partIds: readonly string[],
  tally: Tally,
  solvable: boolean,
  derived: boolean,
): { es: EngineState; rs: RefState; falseAlarm: boolean } {
  expect(es.outcome).toBeNull();
  const oracle = model.deadlockOracle(rs);
  const engine = flagDeadlockTrap(es);
  const reference = model.flag(rs);

  if (oracle.length > 0) {
    // Genuine deadlock: +1000, Interlock Exposed, the fully live SCCs, nothing else changes.
    expect(solvable).toBe(false);
    expect(engine.result.kind).toBe("exposed");
    expect(reference.result.kind).toBe("exposed");
    if (engine.result.kind !== "exposed") throw new Error("unreachable");
    expect(sccKeys(engine.result.sccs)).toEqual(sccKeys(oracle));
    for (const scc of engine.result.sccs) {
      expect(scc.length).toBeGreaterThanOrEqual(2);
      for (const id of scc) expect(es.removed.has(id)).toBe(false);
    }
    expect(engine.result.bonus).toBe(TRAP_BONUS_POINTS);
    expect(engine.result.completed).toBe(true);
    expect(engine.result.scoreAfter).toBe(es.score + TRAP_BONUS_POINTS);
    const next = engine.state;
    expect(next.score).toBe(es.score + TRAP_BONUS_POINTS);
    expect(next.outcome).toBe("interlock_exposed");
    expect(next.combo).toBe(es.combo);
    expect(next.mistakes).toBe(es.mistakes);
    expect(next.falseAlarms).toBe(es.falseAlarms);
    expect(next.penaltyMs).toBe(es.penaltyMs);
    expect(liveParts(next)).toEqual(liveParts(es));
    expect(describeMismatch(next, reference.state)).toBeNull();
    expectRejectedForever(next, partIds, tally);
    tally.genuine += 1;
    return { es, rs, falseAlarm: false };
  }

  // False alarm: combo 1, minus 250 floored at 0, +3000 ms, counter +1, mistakes unchanged, still in play.
  expect(engine.result.kind).toBe("false_alarm");
  expect(reference.result.kind).toBe("false_alarm");
  if (engine.result.kind !== "false_alarm") throw new Error("unreachable");
  const expectedScore = Math.max(0, es.score - FALSE_ALARM_PENALTY_POINTS);
  expect(engine.result.comboBefore).toBe(es.combo);
  expect(engine.result.scoreBefore).toBe(es.score);
  expect(engine.result.scoreAfter).toBe(expectedScore);
  expect(engine.result.penaltyApplied).toBe(es.score - expectedScore);
  expect(engine.result.penaltyMs).toBe(TIME_PENALTY_MS);
  expect(engine.result.falseAlarms).toBe(es.falseAlarms + 1);
  const next = engine.state;
  expect(next.combo).toBe(1);
  expect(next.score).toBe(expectedScore);
  expect(next.score).toBeGreaterThanOrEqual(0);
  expect(next.penaltyMs).toBe(es.penaltyMs + TIME_PENALTY_MS);
  expect(next.falseAlarms).toBe(es.falseAlarms + 1);
  expect(next.mistakes).toBe(es.mistakes);
  expect(next.outcome).toBeNull();
  expect(liveParts(next)).toEqual(liveParts(es));
  expect(describeMismatch(next, reference.state)).toBeNull();
  // The input state is untouched.
  expect(es.falseAlarms).toBe(next.falseAlarms - 1);

  if (derived) tally.falseAlarmBrokenScc += 1;
  else if (solvable) tally.falseAlarmSolvable += 1;
  if (es.score < FALSE_ALARM_PENALTY_POINTS) tally.scoreBelowPenalty += 1;
  else tally.scoreAtOrAbovePenalty += 1;
  return { es: next, rs: reference.state, falseAlarm: true };
}

function walkLevel(synthetic: SyntheticLevel, walkSeed: number, tally: Tally): void {
  const input = synthetic.input;
  const level = createEngineLevel(input, createEngineDeps());
  const model = createReferenceModel(input);
  const rng = mulberry32(walkSeed);
  const partIds = input.parts.map((part) => part.partId);
  const { order, residual } = randomValidOrder(rng, input);

  // The oracle's peel agrees with the generator about whether the level can be finished.
  expect(residual.length === 0).toBe(synthetic.solvable);

  let es = createEngine(level);
  let rs = model.initial();

  for (let prefix = 0; ; prefix += 1) {
    if (es.outcome !== null) {
      // Victory: the last live part left through a legal unbolt.
      expect(es.outcome).toBe("victory");
      expect(synthetic.solvable).toBe(true);
      expectRejectedForever(es, partIds, tally);
      return;
    }

    // Flag on a branch at this prefix.
    const branch = checkFlag(es, rs, model, partIds, tally, synthetic.solvable, false);

    // Deadlocked level: once one member of the injected pair is gone, the SCC is no longer fully live.
    // Real play cannot reach this (neither member can be removed), so the state is derived directly.
    if (synthetic.injectedPair !== null) {
      const [a] = synthetic.injectedPair;
      if (!es.removed.has(a)) {
        const derivedEs: EngineState = { ...es, removed: new Set([...es.removed, a]) };
        const derivedRs: RefState = { ...rs, removed: new Set([...rs.removed, a]) };
        const oracle = model.deadlockOracle(derivedRs);
        expect(oracle).toEqual([]);
        const derived = checkFlag(derivedEs, derivedRs, model, partIds, tally, false, true);
        expect(derived.falseAlarm).toBe(true);
      }
    }

    // Commit a false alarm to the walk about half the time, so later steps run from a penalized state.
    let committedFalseAlarm = false;
    if (branch.falseAlarm && rng() < 0.5) {
      es = branch.es;
      rs = branch.rs;
      committedFalseAlarm = true;
    }

    if (prefix === order.length) {
      // Deadlocked level with every removable part gone: all blocked, still in play, a flag exposes it.
      expect(synthetic.solvable).toBe(false);
      expect(residual.length).toBeGreaterThan(0);
      expect(liveParts(es)).toEqual(residual);
      expect(allLiveBlocked(es)).toBe(true);
      expect(model.removable(rs)).toEqual([]);
      for (const partId of residual) {
        const attempt = attemptUnbolt(es, partId);
        expect(attempt.result.kind).toBe("blocked");
        expect(attempt.state.outcome).toBeNull();
      }
      expect(es.outcome).toBeNull();
      const finalFlag = flagDeadlockTrap(es);
      expect(finalFlag.result.kind).toBe("exposed");
      expect(finalFlag.state.outcome).toBe("interlock_exposed");
      tally.stalemates += 1;
      return;
    }

    // Walk on: the next removal is legal, and the engine still matches the reference model.
    const partId = order[prefix] as string;
    const removal = attemptUnbolt(es, partId);
    expect(removal.result.kind).toBe("legal");
    const refRemoval = model.unbolt(rs, partId);
    expect(refRemoval.result.kind).toBe("legal");
    es = removal.state;
    rs = refRemoval.state;
    expect(describeMismatch(es, rs)).toBeNull();
    if (committedFalseAlarm) tally.playableAfterFalseAlarm += 1;
  }
}

describe("Property 9: the trap flag agrees with an independent deadlock oracle", () => {
  it("separates genuine deadlocks from false alarms across removal prefixes of seeded levels", () => {
    const tally = newTally();

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0x7fffffff }),
        fc.integer({ min: 2, max: 9 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 0x7fffffff }),
        (levelSeed, partCount, deadlocked, walkSeed) => {
          const synthetic = generateSyntheticLevel(levelSeed, {
            partCount,
            deadlocked,
            blockProbability: 0.4,
            fullyBlockedProbability: 0.3,
          });
          walkLevel(synthetic, walkSeed, tally);
        },
      ),
      { seed: SEEDS[9], numRuns: 120 },
    );

    // The runs must really reach every branch of the rule.
    expect(tally.genuine).toBeGreaterThan(0);
    expect(tally.falseAlarmSolvable).toBeGreaterThan(0);
    expect(tally.falseAlarmBrokenScc).toBeGreaterThan(0);
    expect(tally.scoreBelowPenalty).toBeGreaterThan(0);
    expect(tally.scoreAtOrAbovePenalty).toBeGreaterThan(0);
    expect(tally.playableAfterFalseAlarm).toBeGreaterThan(0);
    expect(tally.stalemates).toBeGreaterThan(0);
    expect(tally.completedRejections).toBeGreaterThan(0);
  });

  it("keeps an all-blocked level in play until the flag, then exposes the interlock", () => {
    // With two parts, the injected pair is the whole level: every part is blocked from the first move.
    const synthetic = generateSyntheticLevel(SEEDS[9], { partCount: 2, deadlocked: true });
    const input = synthetic.input;
    const level = createEngineLevel(input, createEngineDeps());
    const model = createReferenceModel(input);
    const start = createEngine(level);

    expect(allLiveBlocked(start)).toBe(true);
    expect(model.removable(model.initial())).toEqual([]);

    // Blocked clicks never complete the level.
    let state = start;
    for (const part of input.parts) {
      const attempt = attemptUnbolt(state, part.partId);
      expect(attempt.result.kind).toBe("blocked");
      state = attempt.state;
      expect(state.outcome).toBeNull();
      expect(liveParts(state)).toEqual(liveParts(start));
    }

    const flag = flagDeadlockTrap(state);
    expect(flag.result.kind).toBe("exposed");
    if (flag.result.kind !== "exposed") throw new Error("unreachable");
    expect(sccKeys(flag.result.sccs)).toEqual(sccKeys(model.deadlockOracle(model.initial())));
    expect(sccKeys(flag.result.sccs)).toEqual(sccKeys(synthetic.witness));
    expect(flag.state.score).toBe(state.score + TRAP_BONUS_POINTS);
    expect(flag.state.outcome).toBe("interlock_exposed");
    // Blocked clicks cost mistakes, but the flag itself adds no penalty.
    expect(flag.state.mistakes).toBe(state.mistakes);
    expect(flag.state.falseAlarms).toBe(0);
    expect(flag.state.penaltyMs).toBe(state.penaltyMs);
  });
});
