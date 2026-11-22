import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  attemptUnbolt,
  createEngine,
  createEngineLevel,
  flagDeadlockTrap,
  liveParts,
} from "../../src/game/blitzEngine";
import type { EngineState } from "../../src/game/blitzEngine";
import { createEngineDeps } from "../../src/engineDeps";
import { mulberry32, shuffle } from "../helpers/prng";
import { createReferenceModel, describeMismatch } from "../helpers/referenceModel";
import type { RefState } from "../helpers/referenceModel";
import { SEEDS } from "../helpers/seeds";
import { generateSyntheticLevel } from "../helpers/syntheticLevel";
import type { SyntheticLevel, SyntheticLevelOptions } from "../helpers/syntheticLevel";

/**
 * Property 7: Scoring, combo and penalties match an independent model.
 *
 * Seeded call sequences (legal, blocked, rejected, false-alarm and genuine trap flags) run through
 * the engine and the reference model in lockstep. After every call the two states must agree, and
 * the global invariants (combo in 1..8, score >= 0, penaltyMs = 3000 * (mistakes + falseAlarms))
 * must hold. Part ids are never hardcoded: calls come from the seeded generator's parts, and the
 * expected numbers come from the rules (100 x combo, +50 fastener, x8 cap, -250 floored at 0,
 * +3000 ms), not from engine output.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.6, 7.5, 7.6, 7.7, 7.8, 7.9, 17.3**
 */

const SEED = SEEDS[7];
const UNKNOWN_ID = "no_such_part";

const NO_EDGES: Pick<SyntheticLevelOptions, "blockProbability" | "fullyBlockedProbability"> = {
  blockProbability: 0,
  fullyBlockedProbability: 0,
};

function buildEngine(level: SyntheticLevel): EngineState {
  return createEngine(createEngineLevel(level.input, createEngineDeps()));
}

function sorted(sccs: readonly (readonly string[])[]): string[][] {
  return sccs.map((scc) => [...scc].sort()).sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1));
}

function checkInvariants(state: EngineState): void {
  expect(state.combo).toBeGreaterThanOrEqual(1);
  expect(state.combo).toBeLessThanOrEqual(8);
  expect(Number.isInteger(state.combo)).toBe(true);
  expect(state.score).toBeGreaterThanOrEqual(0);
  expect(state.penaltyMs).toBe(3000 * (state.mistakes + state.falseAlarms));
}

interface Tally {
  legal: number;
  blocked: number;
  rejected: number;
  falseAlarm: number;
  falseAlarmFloored: number;
  exposed: number;
  comboEight: number;
  fastenerLegal: number;
}

function newTally(): Tally {
  return { legal: 0, blocked: 0, rejected: 0, falseAlarm: 0, falseAlarmFloored: 0, exposed: 0, comboEight: 0, fastenerLegal: 0 };
}

describe("Property 7: scoring, combo and penalties match an independent model", () => {
  it("engine state equals the reference model after every call of seeded random sequences", () => {
    const tally = newTally();

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0x7fffffff }),
        fc.integer({ min: 0, max: 0x7fffffff }),
        fc.integer({ min: 2, max: 14 }),
        fc.boolean(),
        fc.constantFrom(0, 0.2, 0.5),
        fc.constantFrom(0, 0.3, 1),
        (levelSeed, callSeed, partCount, deadlocked, blockProbability, fastenerFraction) => {
          const level = generateSyntheticLevel(levelSeed, {
            partCount,
            deadlocked,
            blockProbability,
            fastenerFraction,
          });
          const model = createReferenceModel(level.input);
          const fastenerIds = new Set(level.input.parts.filter((p) => p.isFastener).map((p) => p.partId));
          const allIds = level.input.parts.map((p) => p.partId);
          const rng = mulberry32(callSeed);

          let engine = buildEngine(level);
          let ref: RefState = model.initial();

          // A new engine starts at score 0, combo 1, no counters.
          expect(describeMismatch(engine, ref)).toBeNull();
          expect(engine.score).toBe(0);
          expect(engine.combo).toBe(1);
          expect(engine.mistakes).toBe(0);
          expect(engine.falseAlarms).toBe(0);
          expect(engine.penaltyMs).toBe(0);

          const calls = partCount * 3 + 6;
          for (let i = 0; i < calls; i += 1) {
            const roll = rng();
            if (roll < 0.15) {
              // Flag the trap.
              const before = engine;
              const { state, result } = flagDeadlockTrap(engine);
              const expected = model.flag(ref);
              expect(result.kind).toBe(expected.result.kind);
              if (result.kind === "rejected") {
                expect(state).toBe(before);
                tally.rejected += 1;
              } else if (result.kind === "exposed" && expected.result.kind === "exposed") {
                expect(sorted(result.sccs)).toEqual(sorted(expected.result.sccs));
                expect(result.scoreAfter).toBe(before.score + 1000);
                expect(state.outcome).toBe("interlock_exposed");
                tally.exposed += 1;
              } else if (result.kind === "false_alarm" && expected.result.kind === "false_alarm") {
                expect(result.penaltyApplied).toBe(expected.result.penaltyApplied);
                expect(result.comboBefore).toBe(before.combo);
                expect(result.scoreBefore).toBe(before.score);
                expect(result.scoreAfter).toBe(Math.max(0, before.score - 250));
                expect(result.falseAlarms).toBe(before.falseAlarms + 1);
                expect(state.combo).toBe(1);
                expect(state.mistakes).toBe(before.mistakes);
                expect(state.removed).toBe(before.removed);
                expect(state.outcome).toBeNull();
                tally.falseAlarm += 1;
                if (before.score < 250) tally.falseAlarmFloored += 1;
              }
              engine = state;
              ref = expected.state;
            } else {
              // Click a part: usually a removable one, otherwise any live part, sometimes an odd id.
              const removable = model.removable(ref);
              const live = liveParts(engine);
              let partId: string;
              if (roll < 0.65 && removable.length > 0) {
                partId = removable[Math.min(removable.length - 1, Math.floor(rng() * removable.length))] as string;
              } else if (roll < 0.9 && live.length > 0) {
                partId = live[Math.min(live.length - 1, Math.floor(rng() * live.length))] as string;
              } else if (roll < 0.95) {
                partId = UNKNOWN_ID;
              } else {
                partId = allIds[Math.min(allIds.length - 1, Math.floor(rng() * allIds.length))] as string;
              }

              const before = engine;
              const { state, result } = attemptUnbolt(engine, partId);
              const expected = model.unbolt(ref, partId);
              expect(result.kind).toBe(expected.result.kind);
              if (result.kind === "rejected" && expected.result.kind === "rejected") {
                expect(result.reason).toBe(expected.result.reason);
                expect(state).toBe(before);
                tally.rejected += 1;
              } else if (result.kind === "legal" && expected.result.kind === "legal") {
                const bonus = fastenerIds.has(partId) ? 50 : 0;
                expect(result.comboBefore).toBe(before.combo);
                expect(result.points).toBe(100 * before.combo);
                expect(result.fastenerBonus).toBe(bonus);
                expect(result.awarded).toBe(100 * before.combo + bonus);
                expect(result.awarded).toBe(expected.result.awarded);
                expect(result.comboAfter).toBe(Math.min(8, before.combo + 1));
                expect(result.completed).toBe(expected.result.completed);
                expect(state.score).toBe(before.score + result.awarded);
                tally.legal += 1;
                if (bonus > 0) tally.fastenerLegal += 1;
                if (before.combo === 8) tally.comboEight += 1;
              } else if (result.kind === "blocked" && expected.result.kind === "blocked") {
                expect(result.blockerIds).toEqual(expected.result.blockerIds);
                expect(result.comboBefore).toBe(expected.result.comboBefore);
                expect(result.comboAfter).toBe(1);
                expect(result.penaltyMs).toBe(3000);
                expect(result.mistakes).toBe(before.mistakes + 1);
                expect(state.score).toBe(before.score);
                expect(state.removed).toBe(before.removed);
                tally.blocked += 1;
              }
              engine = state;
              ref = expected.state;
            }

            expect(describeMismatch(engine, ref)).toBeNull();
            checkInvariants(engine);
          }
        },
      ),
      { seed: SEED, numRuns: 100 },
    );

    // The seeded sequences exercised every kind of call, the x8 cap and the floor.
    expect(tally.legal).toBeGreaterThan(0);
    expect(tally.fastenerLegal).toBeGreaterThan(0);
    expect(tally.blocked).toBeGreaterThan(0);
    expect(tally.rejected).toBeGreaterThan(0);
    expect(tally.falseAlarm).toBeGreaterThan(0);
    expect(tally.falseAlarmFloored).toBeGreaterThan(0);
    expect(tally.exposed).toBeGreaterThan(0);
    expect(tally.comboEight).toBeGreaterThan(0);
  });
});

describe("scoring examples on small seeded synthetic levels", () => {
  /** Unbolts `count` parts in a seeded order, asserting each call is legal. */
  function removeParts(state: EngineState, count: number, rngSeed: number): EngineState {
    const ids = shuffle(mulberry32(rngSeed), liveParts(state)).slice(0, count);
    let current = state;
    for (const id of ids) {
      const { state: next, result } = attemptUnbolt(current, id);
      expect(result.kind).toBe("legal");
      current = next;
    }
    return current;
  }

  it("awards 100 x the combo in force before the increment and caps the combo at x8", () => {
    const level = generateSyntheticLevel(SEED, { partCount: 10, fastenerFraction: 0, ...NO_EDGES });
    expect(level.input.edges).toHaveLength(0);
    let state = buildEngine(level);
    const order = shuffle(mulberry32(SEED), liveParts(state));

    let expectedScore = 0;
    order.forEach((partId, index) => {
      const comboBefore = Math.min(index + 1, 8);
      const { state: next, result } = attemptUnbolt(state, partId);
      expect(result.kind).toBe("legal");
      if (result.kind !== "legal") return;
      expect(result.comboBefore).toBe(comboBefore);
      expect(result.points).toBe(100 * comboBefore);
      expect(result.fastenerBonus).toBe(0);
      expect(result.awarded).toBe(100 * comboBefore);
      expect(result.comboAfter).toBe(Math.min(comboBefore + 1, 8));
      expectedScore += 100 * comboBefore;
      expect(next.score).toBe(expectedScore);
      expect(next.combo).toBe(Math.min(comboBefore + 1, 8));
      state = next;
    });

    // Parts 8, 9 and 10 are all removed at x8, and the combo stays at x8.
    expect(state.combo).toBe(8);
    expect(state.outcome).toBe("victory");
    expect(state.score).toBe(100 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 8 + 8));
  });

  it("adds a flat 50 for a fastener that the combo does not multiply", () => {
    const level = generateSyntheticLevel(SEED, { partCount: 10, fastenerFraction: 0.5, ...NO_EDGES });
    const fastenerIds = new Set(level.input.parts.filter((p) => p.isFastener).map((p) => p.partId));
    expect(fastenerIds.size).toBeGreaterThan(0);
    expect(fastenerIds.size).toBeLessThan(level.input.parts.length);

    let state = buildEngine(level);
    const order = shuffle(mulberry32(SEED), liveParts(state));
    let expectedScore = 0;
    order.forEach((partId, index) => {
      const comboBefore = Math.min(index + 1, 8);
      const bonus = fastenerIds.has(partId) ? 50 : 0;
      const { state: next, result } = attemptUnbolt(state, partId);
      expect(result.kind).toBe("legal");
      if (result.kind !== "legal") return;
      expect(result.points).toBe(100 * comboBefore);
      expect(result.fastenerBonus).toBe(bonus);
      expect(result.awarded).toBe(100 * comboBefore + bonus);
      expectedScore += 100 * comboBefore + bonus;
      expect(next.score).toBe(expectedScore);
      // The bonus never changes how the combo climbs.
      expect(next.combo).toBe(Math.min(comboBefore + 1, 8));
      state = next;
    });
    expect(state.score).toBe(100 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 8 + 8) + 50 * fastenerIds.size);
  });

  it("resets the combo to x1 on a blocked attempt, counts a mistake and adds 3 s without touching score or live parts", () => {
    const level = generateSyntheticLevel(SEED, { partCount: 6, deadlocked: true, fastenerFraction: 0, ...NO_EDGES });
    const pair = level.injectedPair as readonly [string, string];
    const model = createReferenceModel(level.input);
    let state = buildEngine(level);
    expect(model.removable(model.initial())).not.toContain(pair[0]);

    // Two legal removals of parts outside the pair raise the combo to x3.
    const others = shuffle(mulberry32(SEED), liveParts(state).filter((id) => !pair.includes(id)));
    for (const id of others.slice(0, 2)) state = attemptUnbolt(state, id).state;
    expect(state.combo).toBe(3);
    expect(state.score).toBe(300);

    const liveBefore = liveParts(state);
    const first = attemptUnbolt(state, pair[0]);
    expect(first.result.kind).toBe("blocked");
    if (first.result.kind !== "blocked") return;
    expect(first.result.blockerIds).toEqual([pair[1]]);
    expect(first.result.comboBefore).toBe(3);
    expect(first.state.combo).toBe(1);
    expect(first.state.mistakes).toBe(1);
    expect(first.state.falseAlarms).toBe(0);
    expect(first.state.penaltyMs).toBe(3000);
    expect(first.state.score).toBe(300);
    expect(liveParts(first.state)).toEqual(liveBefore);
    expect(first.state.outcome).toBeNull();

    const second = attemptUnbolt(first.state, pair[1]);
    expect(second.result.kind).toBe("blocked");
    expect(second.state.mistakes).toBe(2);
    expect(second.state.penaltyMs).toBe(6000);
    expect(second.state.combo).toBe(1);

    // The next legal removal starts again from x1.
    const next = attemptUnbolt(second.state, others[2] as string);
    expect(next.result.kind).toBe("legal");
    if (next.result.kind !== "legal") return;
    expect(next.result.awarded).toBe(100);
    expect(next.state.combo).toBe(2);
    expect(next.state.score).toBe(400);
  });

  describe("false-alarm strike on a solvable level", () => {
    const level = generateSyntheticLevel(SEED, { partCount: 6, fastenerFraction: 0, ...NO_EDGES });

    function flagOnce(state: EngineState) {
      const { state: next, result } = flagDeadlockTrap(state);
      expect(result.kind).toBe("false_alarm");
      // Every false alarm: combo x1, +3 s, one more false alarm, mistakes and live set untouched, level still in play.
      expect(next.combo).toBe(1);
      expect(next.penaltyMs).toBe(state.penaltyMs + 3000);
      expect(next.falseAlarms).toBe(state.falseAlarms + 1);
      expect(next.mistakes).toBe(state.mistakes);
      expect(liveParts(next)).toEqual(liveParts(state));
      expect(next.outcome).toBeNull();
      return next;
    }

    it("floors a score of 0 at 0", () => {
      const next = flagOnce(buildEngine(level));
      expect(next.score).toBe(0);
      expect(next.penaltyMs).toBe(3000);
    });

    it("floors a score below 250 at 0 and resets the combo", () => {
      const state = removeParts(buildEngine(level), 1, SEED);
      expect(state.score).toBe(100);
      expect(state.combo).toBe(2);
      const next = flagOnce(state);
      expect(next.score).toBe(0);
    });

    it("subtracts exactly 250 from a score above 250, and floors later strikes", () => {
      const state = removeParts(buildEngine(level), 3, SEED);
      expect(state.score).toBe(600);
      expect(state.combo).toBe(4);
      const first = flagOnce(state);
      expect(first.score).toBe(350);
      const second = flagOnce(first);
      expect(second.score).toBe(100);
      expect(second.falseAlarms).toBe(2);
      expect(second.penaltyMs).toBe(6000);
      const third = flagOnce(second);
      expect(third.score).toBe(0);
      expect(third.penaltyMs).toBe(9000);
    });

    it("keeps mistakes separate from false alarms and sums both into the penalty", () => {
      const blockedLevel = generateSyntheticLevel(SEED, { partCount: 3, fastenerFraction: 0, fullyBlockedProbability: 1 });
      const model = createReferenceModel(blockedLevel.input);
      let state = buildEngine(blockedLevel);
      const blockedId = liveParts(state).find((id) => !model.removable(model.initial()).includes(id));
      expect(blockedId).toBeDefined();

      const blocked = attemptUnbolt(state, blockedId as string);
      expect(blocked.result.kind).toBe("blocked");
      state = blocked.state;
      expect(state.mistakes).toBe(1);
      expect(state.penaltyMs).toBe(3000);

      const next = flagOnce(state);
      expect(next.mistakes).toBe(1);
      expect(next.falseAlarms).toBe(1);
      expect(next.penaltyMs).toBe(6000);
    });
  });

  it("scores a genuine trap flag at +1000 with no penalty and completes the level", () => {
    const level = generateSyntheticLevel(SEED, { partCount: 6, deadlocked: true, fastenerFraction: 0, ...NO_EDGES });
    const pair = level.injectedPair as readonly [string, string];
    let state = buildEngine(level);
    const others = shuffle(mulberry32(SEED), liveParts(state).filter((id) => !pair.includes(id)));
    for (const id of others.slice(0, 2)) state = attemptUnbolt(state, id).state;
    expect(state.combo).toBe(3);
    const { state: next, result } = flagDeadlockTrap(state);
    expect(result.kind).toBe("exposed");
    expect(next.score).toBe(state.score + 1000);
    expect(next.outcome).toBe("interlock_exposed");
    expect(next.falseAlarms).toBe(0);
    expect(next.penaltyMs).toBe(0);
    expect(next.combo).toBe(state.combo);
  });
});
