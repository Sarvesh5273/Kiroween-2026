import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { attemptUnbolt, createEngine, createEngineLevel, liveParts } from "../../src/game/blitzEngine";
import type { EngineLevel, EngineLevelInput, EngineState } from "../../src/game/blitzEngine";
import { toEngineLevelInput } from "../../src/game/levelData";
import { createEngineDeps } from "../../src/engineDeps";
import { mulberry32 } from "../helpers/prng";
import { randomValidOrder } from "../helpers/referenceModel";
import { SEEDS } from "../helpers/seeds";
import { generateSyntheticLevel } from "../helpers/syntheticLevel";
import { requireSolveResult, solvedDumbbellCage } from "../helpers/solved";

/**
 * Property 8: Blocked attempts report the real blockers.
 *
 * The expected report is computed here straight from `input.edges`: for each candidate axis, the
 * distinct unremoved `to` ends of the edges `(part, *, axis)`. The reported axis is the first one
 * with the fewest. Nothing reads the engine's own blocker indexes, and no part id is hardcoded.
 *
 * **Validates: Requirements 6.4, 6.5, 17.2**
 */

const REAL_RANDOM_ORDERS = 3;

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface ExpectedReport {
  /** Distinct unremoved blocker count of each candidate axis. */
  counts: number[];
  /** Lowest axis index among those with the fewest blockers. */
  axisIndex: number;
  /** Sorted blocker ids of that axis. */
  ids: string[];
}

/** The unremoved blockers per axis of `partId`, read from the raw edge list. */
function expectedReport(input: EngineLevelInput, removed: ReadonlySet<string>, partId: string): ExpectedReport {
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

/** True when `partId` has some axis with no unremoved blocker, per the edge list. */
function hasClearAxis(report: ExpectedReport): boolean {
  return Math.min(...report.counts) === 0;
}

interface BlockedStats {
  /** Blocked attempts checked. */
  blocked: number;
  /** Blocked attempts whose report differs from the same part's report one removal earlier. */
  changedAfterRemoval: number;
}

/**
 * Attempts every live part at every prefix of `order`. For each part with no clear axis it asserts
 * the Property 8 conditions. The walk advances with legal removals only.
 */
function checkBlockedAttempts(
  level: EngineLevel,
  input: EngineLevelInput,
  order: readonly string[],
  lastReports: Map<string, string>,
): BlockedStats {
  const stats: BlockedStats = { blocked: 0, changedAfterRemoval: 0 };
  let state: EngineState = createEngine(level);

  for (let prefix = 0; prefix <= order.length; prefix += 1) {
    const liveBefore = liveParts(state);
    const removedBefore = new Set(state.removed);

    for (const partId of liveBefore) {
      const expected = expectedReport(input, removedBefore, partId);
      if (hasClearAxis(expected)) continue;

      const { state: after, result } = attemptUnbolt(state, partId);
      expect(result.kind).toBe("blocked");
      if (result.kind !== "blocked") continue;
      stats.blocked += 1;

      // The reported ids are the unremoved blockers of the fewest-blocker axis, lowest index on ties.
      expect(result.partId).toBe(partId);
      expect(result.axisIndex).toBe(expected.axisIndex);
      expect(result.blockerIds).toEqual(expected.ids);

      // Sorted, no duplicates.
      expect(new Set(result.blockerIds).size).toBe(result.blockerIds.length);
      expect([...result.blockerIds].sort(compareIds)).toEqual(result.blockerIds);

      // Minimal: no axis has fewer unremoved blockers, and the blocked case has at least one.
      expect(result.blockerIds.length).toBeGreaterThan(0);
      for (const count of expected.counts) expect(count).toBeGreaterThanOrEqual(result.blockerIds.length);
      expect(result.blockerIds.length).toBe(Math.min(...expected.counts));

      // Every blocker is a live part of this level.
      for (const id of result.blockerIds) {
        expect(state.level.partsById.has(id)).toBe(true);
        expect(removedBefore.has(id)).toBe(false);
        expect(liveBefore).toContain(id);
      }

      // A blocked attempt leaves the live set unchanged.
      expect(liveParts(after)).toEqual(liveBefore);
      expect(after.removed.size).toBe(removedBefore.size);
      for (const id of removedBefore) expect(after.removed.has(id)).toBe(true);
      expect(after.outcome).toBe(state.outcome);
      expect(after.score).toBe(state.score);
      expect(after.mistakes).toBe(state.mistakes + 1);
      expect(after.combo).toBe(1);

      // The input state is untouched.
      expect(liveParts(state)).toEqual(liveBefore);

      const signature = `${result.axisIndex}:${result.blockerIds.join(",")}`;
      const previous = lastReports.get(partId);
      if (previous !== undefined && previous !== signature) stats.changedAfterRemoval += 1;
      lastReports.set(partId, signature);
    }

    if (prefix === order.length) break;
    const removal = attemptUnbolt(state, order[prefix] as string);
    expect(removal.result.kind).toBe("legal");
    state = removal.state;
  }
  return stats;
}

/**
 * Partial removal: a part is blocked with every part live. Parts then leave one by one in a valid
 * order. While the part stays blocked, the engine report must match the edge list for the partial
 * live set and must name none of the removed parts. Returns true when at least one such report
 * differs from the all-live report, so the removals really changed the answer.
 */
function checkPartialRemovalScenario(level: EngineLevel, input: EngineLevelInput, order: readonly string[]): boolean {
  let changed = false;
  const none = new Set<string>();
  const fresh = createEngine(level);
  for (const part of input.parts) {
    const initial = expectedReport(input, none, part.partId);
    if (hasClearAxis(initial)) continue;
    const initialResult = attemptUnbolt(fresh, part.partId).result;
    if (initialResult.kind !== "blocked") throw new Error("expected a blocked attempt");
    expect(initialResult.blockerIds).toEqual(initial.ids);

    let state = fresh;
    for (const removedId of order) {
      if (removedId === part.partId) break;
      const removal = attemptUnbolt(state, removedId);
      expect(removal.result.kind).toBe("legal");
      state = removal.state;

      const expected = expectedReport(input, state.removed, part.partId);
      const attempt = attemptUnbolt(state, part.partId).result;
      if (hasClearAxis(expected)) {
        expect(attempt.kind).toBe("legal");
        break;
      }
      expect(attempt.kind).toBe("blocked");
      if (attempt.kind !== "blocked") break;
      expect(attempt.blockerIds).toEqual(expected.ids);
      for (const id of attempt.blockerIds) expect(state.removed.has(id)).toBe(false);
      if (attempt.axisIndex !== initialResult.axisIndex || attempt.blockerIds.join(",") !== initialResult.blockerIds.join(",")) {
        changed = true;
      }
    }
  }
  return changed;
}

describe("Property 8: blocked attempts report the real blockers", () => {
  it("reports the fewest-blocker axis on seeded synthetic levels, across removal prefixes", () => {
    let blockedTotal = 0;
    let changedTotal = 0;
    let scenarios = 0;

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0x7fffffff }),
        fc.integer({ min: 2, max: 12 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 0x7fffffff }),
        (levelSeed, partCount, deadlocked, orderSeed) => {
          const synthetic = generateSyntheticLevel(levelSeed, {
            partCount,
            deadlocked,
            maxBlockersPerAxis: 3,
            fullyBlockedProbability: 0.6,
          });
          const input = synthetic.input;
          const level = createEngineLevel(input, createEngineDeps());

          const rng = mulberry32(orderSeed);
          const { order } = randomValidOrder(rng, input);
          const stats = checkBlockedAttempts(level, input, order, new Map());
          blockedTotal += stats.blocked;
          changedTotal += stats.changedAfterRemoval;

          if (checkPartialRemovalScenario(level, input, order)) scenarios += 1;
        },
      ),
      { seed: SEEDS[8], numRuns: 100 },
    );

    // The runs must really exercise blocked attempts and reports that change as parts leave.
    expect(blockedTotal).toBeGreaterThan(0);
    expect(changedTotal).toBeGreaterThan(0);
    expect(scenarios).toBeGreaterThan(0);
  });

  it("reports the fewest-blocker axis on the real Dumbbell-in-Ring Cage graph", () => {
    const result = requireSolveResult(solvedDumbbellCage());
    const input = toEngineLevelInput(result);
    const level = createEngineLevel(input, createEngineDeps());

    const rng = mulberry32(SEEDS[8]);
    const lastReports = new Map<string, string>();
    let blocked = 0;
    for (let i = 0; i < REAL_RANDOM_ORDERS; i += 1) {
      const { order } = randomValidOrder(rng, input);
      blocked += checkBlockedAttempts(level, input, order, lastReports).blocked;
    }
    // The cage has a deadlocked core, so some live part is blocked at every prefix.
    expect(blocked).toBeGreaterThan(0);

    // Remove nothing and attempt every part that has no clear axis in the raw graph.
    checkBlockedAttempts(level, input, [], new Map());
  });
});
