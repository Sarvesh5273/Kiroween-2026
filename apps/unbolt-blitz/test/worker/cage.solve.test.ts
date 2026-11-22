import { describe, expect, it } from "vitest";
import type { DeadlockedPlan } from "@unboltkit/core";
import type { BundledLevelId, SolveResult } from "../../src/protocol";
import { runBlitzSolve } from "../../src/worker/runBlitzSolve";
import type { BlitzSolveOutcome } from "../../src/worker/runBlitzSolve";
import { mulberry32, shuffle } from "../helpers/prng";
import { SEEDS } from "../helpers/seeds";
import { requireSolveResult, solvedDumbbellCage, solvedShipInBottle } from "../helpers/solved";

/**
 * Property 24 (solve part): the real Deadlock Cages are deadlocked.
 *
 * Nothing here names a part id. The witness is never trusted on its own: each SCC it reports is
 * re-checked with an independent mutual-reachability search over the returned edge list (plus the
 * witness edges Stage 3 may have found by exact verification, design decision D4).
 *
 * **Validates: Requirements 17.6, 17.8**
 */

const AXIS_COUNT = 32;

interface CageCase {
  label: string;
  levelId: BundledLevelId;
  solve: () => BlitzSolveOutcome;
}

const CAGES: readonly CageCase[] = [
  { label: "Dumbbell-in-Ring Deadlock Cage", levelId: "dumbbell-cage", solve: solvedDumbbellCage },
  { label: "Ship-in-Bottle Deadlock Cage", levelId: "ship-in-bottle", solve: solvedShipInBottle },
];

const viaRunnerCache = new Map<BundledLevelId, BlitzSolveOutcome>();
function solvedViaRunner(levelId: BundledLevelId): BlitzSolveOutcome {
  const cached = viaRunnerCache.get(levelId);
  if (cached !== undefined) return cached;
  const outcome = runBlitzSolve({ type: "solve", requestId: 1, source: { kind: "bundled", levelId } });
  viaRunnerCache.set(levelId, outcome);
  return outcome;
}

function requireDeadlocked(result: SolveResult): DeadlockedPlan {
  if (result.plan.status !== "deadlocked") {
    throw new Error(`expected a deadlocked plan, got "${result.plan.status}"`);
  }
  return result.plan;
}

/** Directed adjacency (`from` to `to`) keyed by part id, optionally restricted to `members`. */
function adjacency(
  edges: readonly { from: string; to: string }[],
  members: ReadonlySet<string>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const id of members) adj.set(id, new Set());
  for (const edge of edges) {
    if (members.has(edge.from) && members.has(edge.to)) {
      (adj.get(edge.from) as Set<string>).add(edge.to);
    }
  }
  return adj;
}

/** Every node reachable from `start` by following one or more edges (start is included only on a cycle). */
function reachableFrom(start: string, adj: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(adj.get(start) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const further of adj.get(next) ?? []) stack.push(further);
  }
  return seen;
}

/** True when every pair of members reaches each other using only edges between members. */
function isMutuallyReachable(
  members: readonly string[],
  edges: readonly { from: string; to: string }[],
): boolean {
  const set = new Set(members);
  const adj = adjacency(edges, set);
  return members.every((a) => {
    const reach = reachableFrom(a, adj);
    return members.every((b) => a === b || reach.has(b));
  });
}

describe("Property 24 (solve part): deadlock cages are deadlocked", () => {
  const order = shuffle(mulberry32(SEEDS[24]), CAGES);

  it.each(order.map((cage) => [cage.label, cage] as const))(
    "%s solves to a deadlocked plan with no trajectories and a verified SCC",
    (_label, cage) => {
      const result = requireSolveResult(cage.solve());

      // The plan is deadlocked and nothing is compiled for it.
      expect(result.plan.status).toBe("deadlocked");
      expect(result.trajectories).toBeNull();
      const plan = requireDeadlocked(result);

      // The witness has at least 1 SCC, and every SCC has 2 or more distinct, known parts.
      const known = new Set(result.parts.map((part) => part.partId));
      expect(plan.witness.sccs.length).toBeGreaterThanOrEqual(1);
      const witnessMembers = new Set<string>();
      for (const scc of plan.witness.sccs) {
        expect(scc.partIds.length).toBeGreaterThanOrEqual(2);
        expect(new Set(scc.partIds).size).toBe(scc.partIds.length);
        for (const id of scc.partIds) {
          expect(known.has(id)).toBe(true);
          witnessMembers.add(id);
        }
      }

      // Independent check: members of each SCC reach each other through the edge list. The
      // graph edges come from the returned result; witness edges add any edge Stage 3 found
      // by exact step verification.
      const edgeUnion: { from: string; to: string; dirIndex: number }[] = [
        ...result.edges,
        ...plan.witness.sccs.flatMap((scc) =>
          scc.edges.map((edge) => ({ from: edge.from, to: edge.to, dirIndex: edge.dirIndex })),
        ),
      ];
      for (const scc of plan.witness.sccs) {
        expect(isMutuallyReachable(scc.partIds, edgeUnion)).toBe(true);
      }

      // Every witness edge names known parts and a valid axis, and joins members of one SCC.
      for (const scc of plan.witness.sccs) {
        const members = new Set(scc.partIds);
        expect(scc.edges.length).toBeGreaterThanOrEqual(scc.partIds.length);
        for (const edge of scc.edges) {
          expect(members.has(edge.from)).toBe(true);
          expect(members.has(edge.to)).toBe(true);
          expect(edge.dirIndex).toBeGreaterThanOrEqual(0);
          expect(edge.dirIndex).toBeLessThan(AXIS_COUNT);
        }
      }

      // Parts removed by the plan are never part of a witness SCC.
      for (const step of plan.steps) {
        expect(witnessMembers.has(step.partId)).toBe(false);
      }
    },
  );

  it.each(order.map((cage) => [cage.label, cage] as const))(
    "%s through runBlitzSolve (bundled request) agrees with solveRoot",
    (_label, cage) => {
      const viaRunner = requireSolveResult(solvedViaRunner(cage.levelId));
      const direct = requireSolveResult(cage.solve());
      const runnerPlan = requireDeadlocked(viaRunner);
      const directPlan = requireDeadlocked(direct);

      expect(viaRunner.trajectories).toBeNull();
      expect(viaRunner.parts.map((part) => part.partId)).toEqual(direct.parts.map((part) => part.partId));
      expect(runnerPlan.witness.sccs.map((scc) => scc.partIds)).toEqual(
        directPlan.witness.sccs.map((scc) => scc.partIds),
      );
      for (const scc of runnerPlan.witness.sccs) {
        expect(scc.partIds.length).toBeGreaterThanOrEqual(2);
      }
    },
  );

  it("the mutual-reachability checker rejects a set that is not strongly connected", () => {
    // Guards the checker itself. A one-way chain a -> b -> c has no SCC of 2 or more.
    const chain = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    expect(isMutuallyReachable(["a", "b", "c"], chain)).toBe(false);
    expect(isMutuallyReachable(["a", "b"], [...chain, { from: "b", to: "a" }])).toBe(true);
  });
});
