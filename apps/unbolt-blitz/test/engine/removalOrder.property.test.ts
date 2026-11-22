import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  attemptUnbolt,
  createEngine,
  createEngineLevel,
  liveParts,
  removedCount,
} from "../../src/game/blitzEngine";
import type { EngineLevel, EngineLevelInput } from "../../src/game/blitzEngine";
import { toEngineLevelInput } from "../../src/game/levelData";
import { createEngineDeps } from "../../src/engineDeps";
import { mulberry32 } from "../helpers/prng";
import { checkRemovalOrder, randomValidOrder } from "../helpers/referenceModel";
import { SEEDS } from "../helpers/seeds";
import { generateSyntheticLevel } from "../helpers/syntheticLevel";
import { requireSolveResult, solvedLockbox } from "../helpers/solved";

/**
 * Property 1: Any valid removal order completes the level.
 *
 * Every order below comes from a seeded generator working on the edge list (the synthetic
 * generator's hidden order, `randomValidOrder`, or the real solver's plan). No part id or order
 * is hardcoded. The blockers of each removed part are read straight from `input.edges`, never
 * from the engine's own indexes.
 *
 * **Validates: Requirements 4.2, 4.4, 7.11, 11.8, 17.1, 17.9**
 */

const DEFAULT_GEAR_COUNT = 3;
const RANDOM_ORDERS_PER_SYNTHETIC_LEVEL = 3;
const REAL_EXTRA_ORDERS = 2;
const MAX_ORDER_ATTEMPTS = 200;

/** Blocker ids of `partId` along axis `dirIndex`, read from the raw edge list. */
function blockersOnAxis(input: EngineLevelInput, partId: string, dirIndex: number): string[] {
  return input.edges
    .filter((edge) => edge.from === partId && edge.dirIndex === dirIndex)
    .map((edge) => edge.to);
}

/**
 * Plays `order` through the engine and asserts every Property 1 condition.
 * Returns the final engine state so callers can add checks.
 */
function playOrder(level: EngineLevel, input: EngineLevelInput, order: readonly string[]) {
  expect(order).toHaveLength(input.parts.length);
  expect(new Set(order).size).toBe(order.length);

  let state = createEngine(level);
  const removedBefore = new Set<string>();

  order.forEach((partId, index) => {
    // The caller's order must be valid under the edge list: some axis has all blockers gone.
    const clearAxes: number[] = [];
    const part = input.parts.find((candidate) => candidate.partId === partId);
    expect(part).toBeDefined();
    (part?.candidateAxes ?? []).forEach((_axis, dirIndex) => {
      if (blockersOnAxis(input, partId, dirIndex).every((id) => removedBefore.has(id))) {
        clearAxes.push(dirIndex);
      }
    });
    expect(clearAxes.length).toBeGreaterThan(0);

    const { state: next, result } = attemptUnbolt(state, partId);
    expect(result.kind).toBe("legal");
    if (result.kind !== "legal") throw new Error(`call ${index} for ${partId} was ${result.kind}`);

    // The engine's chosen axis must be one whose blockers all left earlier.
    expect(result.partId).toBe(partId);
    expect(clearAxes).toContain(result.axisIndex);
    for (const blocker of blockersOnAxis(input, partId, result.axisIndex)) {
      expect(removedBefore.has(blocker)).toBe(true);
    }

    removedBefore.add(partId);
    expect(next.removed.has(partId)).toBe(true);
    expect(removedCount(next)).toBe(index + 1);
    expect(result.completed).toBe(index === order.length - 1);
    expect(next.outcome).toBe(index === order.length - 1 ? "victory" : null);
    state = next;
  });

  expect(state.outcome).toBe("victory");
  expect(liveParts(state)).toEqual([]);
  expect(removedCount(state)).toBe(input.parts.length);
  expect(state.mistakes).toBe(0);
  expect(state.falseAlarms).toBe(0);
  return state;
}

describe("Property 1: any valid removal order completes the level", () => {
  it("completes synthetic acyclic levels for the hidden order and several seeded valid orders", () => {
    const orderTallies: Set<string>[] = [];

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0x7fffffff }),
        fc.integer({ min: 1, max: 14 }),
        fc.integer({ min: 0, max: 0x7fffffff }),
        (levelSeed, partCount, orderSeed) => {
          const synthetic = generateSyntheticLevel(levelSeed, { partCount });
          expect(synthetic.solvable).toBe(true);
          const input = synthetic.input;
          const level = createEngineLevel(input, createEngineDeps());

          const orders: string[][] = [];
          const hidden = synthetic.removalOrder;
          expect(hidden).not.toBeNull();
          orders.push([...(hidden as readonly string[])]);

          const rng = mulberry32(orderSeed);
          for (let i = 0; i < RANDOM_ORDERS_PER_SYNTHETIC_LEVEL; i += 1) {
            const { order, residual } = randomValidOrder(rng, input);
            expect(residual).toEqual([]);
            orders.push(order);
          }

          const distinct = new Set<string>();
          for (const order of orders) {
            expect(checkRemovalOrder(input, order).valid).toBe(true);
            playOrder(level, input, order);
            distinct.add(order.join("|"));
          }
          orderTallies.push(distinct);
        },
      ),
      { seed: SEEDS[1], numRuns: 100 },
    );

    // More than one distinct order was exercised, both within some levels and overall.
    expect(orderTallies.length).toBeGreaterThan(0);
    const levelsWithSeveralOrders = orderTallies.filter((tally) => tally.size > 1).length;
    expect(levelsWithSeveralOrders).toBeGreaterThan(0);
    const allOrders = new Set<string>();
    for (const tally of orderTallies) for (const key of tally) allOrders.add(key);
    expect(allOrders.size).toBeGreaterThan(1);
  });

  it("completes the real Haunted Clockwork Lockbox with the plan order and 2 other seeded valid orders", () => {
    const result = requireSolveResult(solvedLockbox(DEFAULT_GEAR_COUNT));
    expect(result.plan.status).toBe("solved");
    const input = toEngineLevelInput(result);
    const level = createEngineLevel(input, createEngineDeps());

    const planOrder = result.plan.steps.map((step) => step.partId);
    expect(checkRemovalOrder(input, planOrder).valid).toBe(true);

    const orders: string[][] = [planOrder];
    const seen = new Set<string>([planOrder.join("|")]);
    const rng = mulberry32(SEEDS[1]);
    for (let attempt = 0; attempt < MAX_ORDER_ATTEMPTS && orders.length < 1 + REAL_EXTRA_ORDERS; attempt += 1) {
      const { order, residual } = randomValidOrder(rng, input);
      expect(residual).toEqual([]);
      const key = order.join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      orders.push(order);
    }

    // The plan order and at least 2 other orders, all distinct.
    expect(orders.length).toBeGreaterThanOrEqual(1 + REAL_EXTRA_ORDERS);
    expect(new Set(orders.map((order) => order.join("|"))).size).toBe(orders.length);

    for (const order of orders) {
      expect(checkRemovalOrder(input, order).valid).toBe(true);
      playOrder(level, input, order);
    }
  });
});
