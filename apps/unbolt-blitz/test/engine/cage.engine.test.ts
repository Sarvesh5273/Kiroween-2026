import { describe, expect, it } from "vitest";
import {
  allLiveBlocked,
  attemptUnbolt,
  createEngine,
  createEngineLevel,
  flagDeadlockTrap,
  liveParts,
} from "../../src/game/blitzEngine";
import type { EngineLevelInput, EngineState } from "../../src/game/blitzEngine";
import { toEngineLevelInput } from "../../src/game/levelData";
import { createEngineDeps } from "../../src/engineDeps";
import { mulberry32, shuffle } from "../helpers/prng";
import type { Rng } from "../helpers/prng";
import { createReferenceModel, randomValidOrder } from "../helpers/referenceModel";
import type { RefState } from "../helpers/referenceModel";
import { SEEDS } from "../helpers/seeds";
import { requireSolveResult, solvedDumbbellCage, solvedShipInBottle } from "../helpers/solved";
import type { BlitzSolveOutcome } from "../../src/worker/runBlitzSolve";

/**
 * Property 24 (engine part): the real Deadlock Cages are stuck from the first move.
 *
 * The engine is built from the real solve results through `toEngineLevelInput` and
 * `createEngineDeps`. Every expectation is derived from the edge list (`input.edges`), never from
 * the engine's own indexes, and no part id is written in this file. When the real kit starts with
 * freely removable parts, they are peeled off through legal engine removals first and the stuck
 * core is checked from there. A part id that a premature flag removes is derived directly, since
 * real play cannot remove a member of a fully live SCC.
 *
 * **Validates: Requirements 7.1, 7.2, 7.10, 17.4, 17.5**
 */

const TRAP_BONUS_POINTS = 1000;
const FALSE_ALARM_PENALTY_POINTS = 250;
const TIME_PENALTY_MS = 3000;
const BLOCKED_ROUNDS = 3;

interface CageCase {
  label: string;
  solve: () => BlitzSolveOutcome;
}

const CAGES: readonly CageCase[] = [
  { label: "Dumbbell-in-Ring Deadlock Cage", solve: solvedDumbbellCage },
  { label: "Ship-in-Bottle Deadlock Cage", solve: solvedShipInBottle },
];

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical form of a list of SCCs: members sorted, groups sorted. */
function sccKeys(sccs: readonly (readonly string[])[]): string[] {
  return sccs.map((scc) => [...scc].sort(compareIds).join(",")).sort(compareIds);
}

interface AxisReport {
  /** Distinct unremoved blocker count of each candidate axis, read from the raw edge list. */
  counts: number[];
  /** Lowest axis index among those with the fewest blockers. */
  axisIndex: number;
  /** Sorted blocker ids of that axis. */
  ids: string[];
}

function axisReport(input: EngineLevelInput, removed: ReadonlySet<string>, partId: string): AxisReport {
  const part = input.parts.find((candidate) => candidate.partId === partId);
  if (part === undefined) throw new Error(`unknown part ${partId}`);
  const perAxis = part.candidateAxes.map(() => new Set<string>());
  for (const edge of input.edges) {
    if (edge.from === partId && !removed.has(edge.to)) perAxis[edge.dirIndex]?.add(edge.to);
  }
  const counts = perAxis.map((ids) => ids.size);
  let axisIndex = 0;
  counts.forEach((count, k) => {
    if (count < (counts[axisIndex] as number)) axisIndex = k;
  });
  return { counts, axisIndex, ids: [...(perAxis[axisIndex] as Set<string>)].sort(compareIds) };
}

/** Live parts with some axis whose blockers have all left, per the edge list. */
function partsWithClearAxis(input: EngineLevelInput, removed: ReadonlySet<string>): string[] {
  return input.parts
    .map((part) => part.partId)
    .filter((id) => !removed.has(id) && Math.min(...axisReport(input, removed, id).counts) === 0)
    .sort(compareIds);
}

function toRefState(state: EngineState): RefState {
  return {
    removed: state.removed,
    score: state.score,
    combo: state.combo,
    mistakes: state.mistakes,
    falseAlarms: state.falseAlarms,
    penaltyMs: state.penaltyMs,
    outcome: state.outcome,
  };
}

/** A state with `partId` marked removed, built directly because real play cannot reach it. */
function withRemoved(state: EngineState, partId: string, overrides: Partial<EngineState> = {}): EngineState {
  return { ...state, removed: new Set([...state.removed, partId]), ...overrides };
}

interface StuckStart {
  state: EngineState;
  /** Parts peeled off before the stuck core (empty when the cage is stuck from the first move). */
  peeled: string[];
  residual: string[];
}

/** Takes the engine to the stuck core by legal removals only, in a seeded valid order. */
function reachStuckCore(input: EngineLevelInput, state: EngineState, rng: Rng): StuckStart {
  const { order, residual } = randomValidOrder(rng, input);
  let current = state;
  for (const partId of order) {
    const step = attemptUnbolt(current, partId);
    expect(step.result.kind).toBe("legal");
    current = step.state;
  }
  return { state: current, peeled: order, residual };
}

describe("Property 24 (engine part): deadlock cages are stuck from the first move", () => {
  const cages = shuffle(mulberry32(SEEDS[24]), CAGES);

  it.each(cages.map((cage) => [cage.label, cage] as const))(
    "%s: no live part is removable once the free parts are gone, blocked clicks keep it in play, and the flag exposes it",
    (_label, cage) => {
      const result = requireSolveResult(cage.solve());
      const input = toEngineLevelInput(result);
      const level = createEngineLevel(input, createEngineDeps());
      const model = createReferenceModel(input);
      const rng = mulberry32(SEEDS[24]);
      const start = createEngine(level);

      expect(input.deadlockSccs.length).toBeGreaterThanOrEqual(1);
      for (const scc of input.deadlockSccs) expect(scc.length).toBeGreaterThanOrEqual(2);

      // The first move: derive from the edge list whether any live part is free to leave.
      const initialFree = partsWithClearAxis(input, new Set());
      const initiallyStuck = initialFree.length === 0;
      expect(allLiveBlocked(start)).toBe(initiallyStuck);

      // Peel the freely removable parts (none when the cage is stuck from the first move).
      const { state: stuck, peeled, residual } = reachStuckCore(input, start, rng);
      expect(peeled.length === 0).toBe(initiallyStuck);
      expect(peeled.length + residual.length).toBe(input.parts.length);

      // The stuck core: nothing live has a clear axis in the edge list or in the engine.
      expect(residual.length).toBeGreaterThan(0);
      expect(liveParts(stuck)).toEqual(residual);
      expect(partsWithClearAxis(input, stuck.removed)).toEqual([]);
      expect(model.removable(toRefState(stuck))).toEqual([]);
      expect(allLiveBlocked(stuck)).toBe(true);
      expect(stuck.outcome).toBeNull();

      // Every deadlock SCC sits inside the stuck core, so no member was ever removable.
      for (const scc of input.deadlockSccs) {
        for (const id of scc) expect(residual).toContain(id);
      }

      // Blocked clicks: every live part, several rounds, in a seeded order.
      let state = stuck;
      let clicks = 0;
      for (let round = 0; round < BLOCKED_ROUNDS; round += 1) {
        for (const partId of shuffle(rng, residual)) {
          const expected = axisReport(input, state.removed, partId);
          const before = state;
          const attempt = attemptUnbolt(state, partId);
          expect(attempt.result.kind).toBe("blocked");
          if (attempt.result.kind !== "blocked") throw new Error("unreachable");
          clicks += 1;

          // The report names live blockers of the fewest-blocker axis, lowest index on ties.
          expect(attempt.result.axisIndex).toBe(expected.axisIndex);
          expect(attempt.result.blockerIds).toEqual(expected.ids);
          expect(attempt.result.blockerIds.length).toBeGreaterThan(0);
          expect(attempt.result.blockerIds.length).toBe(Math.min(...expected.counts));
          for (const id of attempt.result.blockerIds) expect(liveParts(before)).toContain(id);

          state = attempt.state;
          // The level stays in play: no auto-complete, nothing removed, combo reset, mistake counted.
          expect(state.outcome).toBeNull();
          expect(liveParts(state)).toEqual(residual);
          expect(state.removed.size).toBe(before.removed.size);
          expect(state.score).toBe(before.score);
          expect(state.combo).toBe(1);
          expect(state.mistakes).toBe(before.mistakes + 1);
          expect(state.penaltyMs).toBe(before.penaltyMs + TIME_PENALTY_MS);
          expect(allLiveBlocked(state)).toBe(true);
        }
      }
      expect(clicks).toBe(residual.length * BLOCKED_ROUNDS);
      expect(state.mistakes).toBe(clicks);

      // The flag: +1000 and Interlock Exposed, naming the fully live SCCs the oracle finds.
      const oracle = model.deadlockOracle(toRefState(state));
      expect(oracle.length).toBeGreaterThanOrEqual(1);
      const flag = flagDeadlockTrap(state);
      expect(flag.result.kind).toBe("exposed");
      if (flag.result.kind !== "exposed") throw new Error("unreachable");
      expect(flag.result.bonus).toBe(TRAP_BONUS_POINTS);
      expect(flag.result.completed).toBe(true);
      expect(flag.result.scoreAfter).toBe(state.score + TRAP_BONUS_POINTS);
      expect(sccKeys(flag.result.sccs)).toEqual(sccKeys(oracle));
      for (const scc of flag.result.sccs) {
        expect(scc.length).toBeGreaterThanOrEqual(2);
        for (const id of scc) expect(state.removed.has(id)).toBe(false);
      }
      expect(flag.state.score).toBe(state.score + TRAP_BONUS_POINTS);
      expect(flag.state.outcome).toBe("interlock_exposed");
      expect(flag.state.mistakes).toBe(state.mistakes);
      expect(flag.state.falseAlarms).toBe(0);
      expect(flag.state.penaltyMs).toBe(state.penaltyMs);

      // The level is over: further clicks and flags are rejected on the same state object.
      const after = attemptUnbolt(flag.state, residual[0] as string);
      expect(after.result).toEqual({ kind: "rejected", partId: residual[0], reason: "level_complete" });
      expect(after.state).toBe(flag.state);
      expect(flagDeadlockTrap(flag.state).result.kind).toBe("rejected");
    },
  );

  it.each(cages.map((cage) => [cage.label, cage] as const))(
    "%s: a flag after an SCC member left follows the oracle, and a false alarm costs 250, 3 s and the combo",
    (_label, cage) => {
      const result = requireSolveResult(cage.solve());
      const input = toEngineLevelInput(result);
      const level = createEngineLevel(input, createEngineDeps());
      const model = createReferenceModel(input);
      const rng = mulberry32(SEEDS[24]);
      const { state: stuck } = reachStuckCore(input, createEngine(level), rng);

      // A member of a fully live SCC cannot be removed by play: every click on it is blocked.
      let falseAlarms = 0;
      for (const scc of input.deadlockSccs) {
        for (const member of scc) {
          const attempt = attemptUnbolt(stuck, member);
          expect(attempt.result.kind).toBe("blocked");
          expect(attempt.state.outcome).toBeNull();
        }

        // Derive the state in which one seeded member of this SCC is already gone.
        const member = scc[Math.min(scc.length - 1, Math.floor(rng() * scc.length))] as string;
        // Variants: a high combo with a score above the penalty, and a score below the penalty.
        const variants: Partial<EngineState>[] = [
          { score: 2 * FALSE_ALARM_PENALTY_POINTS + 100, combo: 4 },
          { score: FALSE_ALARM_PENALTY_POINTS - 100, combo: 3 },
        ];
        for (const overrides of variants) {
          const derived = withRemoved(stuck, member, overrides);
          expect(derived.outcome).toBeNull();
          const oracle = model.deadlockOracle(toRefState(derived));
          const engineFlag = flagDeadlockTrap(derived);

          if (oracle.length > 0) {
            // Another SCC is still fully live, so the flag is a genuine exposure.
            expect(engineFlag.result.kind).toBe("exposed");
            expect(engineFlag.state.outcome).toBe("interlock_exposed");
            expect(engineFlag.state.score).toBe(derived.score + TRAP_BONUS_POINTS);
            continue;
          }

          // No fully live SCC: a false alarm that leaves the level in play.
          expect(engineFlag.result.kind).toBe("false_alarm");
          if (engineFlag.result.kind !== "false_alarm") throw new Error("unreachable");
          const expectedScore = Math.max(0, derived.score - FALSE_ALARM_PENALTY_POINTS);
          expect(engineFlag.result.comboBefore).toBe(derived.combo);
          expect(engineFlag.result.scoreBefore).toBe(derived.score);
          expect(engineFlag.result.scoreAfter).toBe(expectedScore);
          expect(engineFlag.result.penaltyApplied).toBe(derived.score - expectedScore);
          expect(engineFlag.result.penaltyMs).toBe(TIME_PENALTY_MS);
          expect(engineFlag.result.falseAlarms).toBe(derived.falseAlarms + 1);
          expect(engineFlag.state.combo).toBe(1);
          expect(engineFlag.state.score).toBe(expectedScore);
          expect(engineFlag.state.penaltyMs).toBe(derived.penaltyMs + TIME_PENALTY_MS);
          expect(engineFlag.state.falseAlarms).toBe(derived.falseAlarms + 1);
          expect(engineFlag.state.mistakes).toBe(derived.mistakes);
          expect(engineFlag.state.outcome).toBeNull();
          expect(liveParts(engineFlag.state)).toEqual(liveParts(derived));
          falseAlarms += 1;
        }
      }

      // With a single SCC, removing one member always leaves no fully live SCC, so the false-alarm
      // branch must have run. With several SCCs the oracle decides, and the loop above covers it.
      if (input.deadlockSccs.length === 1) expect(falseAlarms).toBeGreaterThan(0);
    },
  );
});
