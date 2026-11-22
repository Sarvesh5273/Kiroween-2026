import { describe, expect, it } from "vitest";
import { DEFAULT_SOLVER_CONFIG } from "../../src/config";
import { DeadlockWitnessInvariantError } from "../../src/errors";
import type { Aabb } from "../../src/math/aabb";
import { createPrng } from "../../src/prng";
import { solveDisassembly } from "../../src/pipeline";
import { CANONICAL_DIRECTIONS } from "../../src/stage1/candidateAxes";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import { stage2BuildDbg } from "../../src/stage2/dbgBuilder";
import {
  buildUnionExtremes,
  chooseDirection,
  escapeDistance,
  unionExcluding,
} from "../../src/stage3/escapeDistance";
import { runPeel, stage3Peel, type PeelInput, type PeelPartInput } from "../../src/stage3/peelSolver";
import { buildDeadlockWitness } from "../../src/stage3/sccAnalyzer";
import { tarjanScc } from "../../src/stage3/tarjan";
import { selectByCascade, type TieBreakKey } from "../../src/stage3/tieBreak";
import type { BlockingEdge, DisassemblyPlan, ErrorResult, Vec3 } from "../../src/types";
import { CUBE_POSITIONS, CUBE_TRIANGLES, groupOf, meshFromArrays, prepare } from "../helpers/handMeshes";

// ---------------------------------------------------------------------------
// Synthetic Peel_Solver inputs
// ---------------------------------------------------------------------------

/** 26 canonical directions, then +/-PCA1, +/-PCA2, +/-PCA3 of an axis-aligned frame. */
const AXES: Vec3[] = [
  ...CANONICAL_DIRECTIONS.map((d): Vec3 => [d[0], d[1], d[2]]),
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const AXIS_COUNT = AXES.length;
const PLUS_X = 0;
const MINUS_X = 1;

function axisAt(index: number): Vec3 {
  const axis = AXES[index];
  if (axis === undefined) {
    throw new RangeError(`no axis ${index}`);
  }
  return axis;
}

/** A Part whose AABB is its OBB (axis-aligned frame). */
function synthPart(partId: string, center: Vec3, half: Vec3): PeelPartInput {
  return {
    partId,
    aabb: {
      min: [center[0] - half[0], center[1] - half[1], center[2] - half[2]],
      max: [center[0] + half[0], center[1] + half[1], center[2] + half[2]],
    },
    obbCenter: center,
    obbHalfExtents: half,
    candidateAxes: AXES,
  };
}

function cube(partId: string, center: Vec3): PeelPartInput {
  return synthPart(partId, center, [0.25, 0.25, 0.25]);
}

function edge(from: string, to: string, dirIndex: number): BlockingEdge {
  return { from, to, dirIndex, dir: axisAt(dirIndex), fromTriangles: [0, 2], toTriangles: [1] };
}

/** `from` is blocked by `to` along every axis except those listed. */
function blockAll(from: string, to: string, except: readonly number[] = []): BlockingEdge[] {
  const edges: BlockingEdge[] = [];
  for (let k = 0; k < AXIS_COUNT; k++) {
    if (!except.includes(k)) {
      edges.push(edge(from, to, k));
    }
  }
  return edges;
}

function peelInput(parts: PeelPartInput[], edges: BlockingEdge[]): PeelInput {
  return {
    parts,
    edges,
    normalization: { scale: 1, translation: [0, 0, 0] },
    sampling: { stride: 1, polyBudgetExceeded: false, totalTriangles: 12 * parts.length, polyBudget: 150000 },
    diagnostics: [],
  };
}

// ---------------------------------------------------------------------------
// Escape_Distance
// ---------------------------------------------------------------------------

describe("Escape_Distance (Req 14.3, 14.8)", () => {
  const box = (min: Vec3, max: Vec3): Aabb => ({ min, max });
  const mover = box([0, 0, 0], [1, 1, 1]);
  const others = box([0.5, 0.25, 0.25], [3, 2, 1.5]);

  it("measures the slab distance along each signed axis", () => {
    expect(escapeDistance(mover, [1, 0, 0], others)).toBe(3);
    expect(escapeDistance(mover, [-1, 0, 0], others)).toBe(0.5);
    expect(escapeDistance(mover, [0, 1, 0], others)).toBe(2);
    expect(escapeDistance(mover, [0, -1, 0], others)).toBe(0.75);
    expect(escapeDistance(mover, [0, 0, -1], others)).toBe(0.75);
  });

  it("takes the smallest axis distance for a diagonal direction", () => {
    const diagonal: Vec3 = [Math.SQRT1_2, -Math.SQRT1_2, 0];
    // +X needs 3 / d_x and -Y needs 0.75 / |d_y|. The Y axis clears first.
    expect(escapeDistance(mover, diagonal, others)).toBeCloseTo(0.75 / Math.SQRT1_2, 12);
  });

  it("is 0 when the box misses the others on some axis, or when it is the last Part", () => {
    expect(escapeDistance(mover, [1, 0, 0], box([5, 0, 0], [6, 1, 1]))).toBe(0);
    expect(escapeDistance(mover, [0, 0, 1], box([0, 0, 2], [1, 1, 3]))).toBe(0);
    expect(escapeDistance(mover, [1, 0, 0], null)).toBe(0);
  });

  it("reads the union of every box except one in O(1) and matches a brute-force union", () => {
    // Integer coordinates on a coarse grid create many equal extremes, which is the hard case.
    const prng = createPrng(0x5ca1ab1e);
    const grid = (): number => Math.floor(prng.nextFloat() * 4);
    for (let round = 0; round < 40; round++) {
      const count = 2 + Math.floor(prng.nextFloat() * 6);
      const items = Array.from({ length: count }, (_, id) => {
        const a: Vec3 = [grid(), grid(), grid()];
        const b: Vec3 = [grid(), grid(), grid()];
        const aabb: Aabb = {
          min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
          max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
        };
        return { id, aabb };
      });
      const extremes = buildUnionExtremes(items);
      for (const excluded of items) {
        const rest = items.filter((item) => item.id !== excluded.id);
        const expected: Aabb = {
          min: [0, 1, 2].map((j) => Math.min(...rest.map((item) => item.aabb.min[j] as number))) as Vec3,
          max: [0, 1, 2].map((j) => Math.max(...rest.map((item) => item.aabb.max[j] as number))) as Vec3,
        };
        expect(unionExcluding(extremes, excluded.id), `round ${round}, excluding ${excluded.id}`).toEqual(expected);
      }
    }
  });

  it("returns no union when only one box is left", () => {
    const extremes = buildUnionExtremes([{ id: 7, aabb: mover }]);
    expect(unionExcluding(extremes, 7)).toBeNull();
  });
});

describe("removal direction ties (Req 14.3)", () => {
  it("treats escape distances within 1e-9 of the minimum as identical and takes the lowest index", () => {
    const choice = chooseDirection([
      { dirIndex: 2, escapeDistance: 0.5 + 9e-10 },
      { dirIndex: 5, escapeDistance: 0.5 },
      { dirIndex: 9, escapeDistance: 0.5 },
    ]);
    expect(choice.dirIndex).toBe(2);
    expect(choice.escapeDistance).toBe(0.5 + 9e-10);
  });

  it("does not accept an axis farther than 1e-9 from the minimum", () => {
    const choice = chooseDirection([
      { dirIndex: 2, escapeDistance: 0.5 + 1.2e-9 },
      { dirIndex: 5, escapeDistance: 0.5 },
    ]);
    expect(choice.dirIndex).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Tie-break cascade
// ---------------------------------------------------------------------------

function key(partId: string, overrides: Partial<TieBreakKey> = {}): TieBreakKey {
  return { partId, isFastener: false, slenderness: 1, radialExposure: 1, escapeDistance: 1, ...overrides };
}

describe("tie-break cascade (Req 15.1, 15.3)", () => {
  it("keeps only Fasteners when any candidate is one, even if it loses every other component", () => {
    const result = selectByCascade([
      key("a", { slenderness: 9, radialExposure: 9 }),
      key("z", { isFastener: true, slenderness: 1, radialExposure: 0, escapeDistance: 5 }),
    ]);
    expect(result.partId).toBe("z");
    expect(result.steps.afterFastener).toEqual(["z"]);
  });

  it("keeps candidates whose slenderness is within 1e-9 of the best, and drops those beyond it", () => {
    const result = selectByCascade([
      key("a", { slenderness: 4 }),
      key("b", { slenderness: 4 - 0.9e-9, radialExposure: 2 }),
      key("c", { slenderness: 4 - 1.1e-9, radialExposure: 3 }),
    ]);
    expect(result.steps.afterSlenderness).toEqual(["a", "b"]);
    expect(result.partId).toBe("b");
  });

  it("keeps exactly the +Infinity slenderness candidates when the best is +Infinity", () => {
    const result = selectByCascade([
      key("a", { slenderness: 1e300, radialExposure: 9 }),
      key("b", { slenderness: Number.POSITIVE_INFINITY, radialExposure: 1 }),
      key("c", { slenderness: Number.POSITIVE_INFINITY, radialExposure: 2 }),
    ]);
    expect(result.steps.afterSlenderness).toEqual(["b", "c"]);
    expect(result.partId).toBe("c");
  });

  it("applies the 1e-9 cascade to radial exposure (higher wins) and escape distance (lower wins)", () => {
    const radial = selectByCascade([
      key("a", { radialExposure: 2, escapeDistance: 5 }),
      key("b", { radialExposure: 2 - 0.9e-9, escapeDistance: 1 }),
      key("c", { radialExposure: 2 - 1.1e-9, escapeDistance: 0 }),
    ]);
    expect(radial.steps.afterRadialExposure).toEqual(["a", "b"]);
    expect(radial.steps.afterEscapeDistance).toEqual(["b"]);
    expect(radial.partId).toBe("b");

    const escape = selectByCascade([
      key("a", { escapeDistance: 0.3 }),
      key("b", { escapeDistance: 0.3 + 0.9e-9 }),
      key("c", { escapeDistance: 0.3 + 1.1e-9 }),
    ]);
    expect(escape.steps.afterEscapeDistance).toEqual(["a", "b"]);
  });

  it("breaks the last tie by UTF-16 code units, not by locale", () => {
    // localeCompare would order "a" before "B". Code units order "B" (66) before "a" (97), and
    // "/10#0" before "/2#0" because "1" < "2".
    expect(selectByCascade([key("a"), key("B")]).partId).toBe("B");
    expect(selectByCascade([key("/2#0"), key("/10#0")]).partId).toBe("/10#0");
  });

  it("never lets +Infinity - +Infinity produce a NaN comparison", () => {
    const infinite = Number.POSITIVE_INFINITY;
    const result = selectByCascade([key("p", { slenderness: infinite }), key("q", { slenderness: infinite })]);
    expect(result.steps.afterSlenderness).toEqual(["p", "q"]);
    expect(result.partId).toBe("p");
  });

  it("rejects a NaN key component instead of comparing it", () => {
    expect(() => selectByCascade([key("a", { slenderness: Number.NaN })])).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Peel_Solver
// ---------------------------------------------------------------------------

describe("Peel_Solver edge cases (Req 14.8, 15.5)", () => {
  it("peels the last remaining Part along axis 0 with escape distance 0", () => {
    // B blocks A on every axis. After B leaves, A is the only Part left, so every axis is
    // unblocked and the answer is axis 0 with distance 0.
    const parts = [synthPart("A", [0, 0, 0], [0.5, 0.2, 0.1]), cube("B", [0.2, 0, 0])];
    const { plan } = runPeel(peelInput(parts, blockAll("A", "B")), DEFAULT_SOLVER_CONFIG);
    expect(plan.status).toBe("solved");
    expect(plan.steps.map((step) => step.partId)).toEqual(["B", "A"]);
    const last = plan.steps[1];
    expect(last?.dirIndex).toBe(0);
    expect(last?.dir).toEqual(axisAt(0));
    expect(last?.escapeDistance).toBe(0);
    expect(last?.secondary).toBeNull();
  });

  it("peels a lone Part along axis 0 with escape distance 0", () => {
    const { plan } = runPeel(peelInput([cube("only", [4, 5, 6])], []), DEFAULT_SOLVER_CONFIG);
    expect(plan.status).toBe("solved");
    expect(plan.steps).toEqual([{ partId: "only", dir: axisAt(0), dirIndex: 0, escapeDistance: 0, secondary: null }]);
  });

  it("gives a Part with both shorter extents 0 a +Infinity slenderness and never a NaN key", () => {
    const parts = [
      synthPart("wire", [0, 0, 0], [0.5, 0, 0]),
      synthPart("rod", [2, 0, 0], [0.5, 0.05, 0.05]),
      cube("box", [-2, 0, 0]),
    ];
    const { plan, trace } = runPeel(peelInput(parts, []), DEFAULT_SOLVER_CONFIG, { trace: true });
    expect(plan.status).toBe("solved");
    const first = trace?.iterations[0];
    const wire = first?.keys.find((candidate) => candidate.partId === "wire");
    expect(wire?.slenderness).toBe(Number.POSITIVE_INFINITY);
    expect(wire?.isFastener).toBe(true);
    for (const iteration of trace?.iterations ?? []) {
      for (const candidate of iteration.keys) {
        expect(Number.isNaN(candidate.slenderness)).toBe(false);
        expect(Number.isNaN(candidate.radialExposure)).toBe(false);
        expect(Number.isNaN(candidate.escapeDistance)).toBe(false);
      }
    }
    // Both the wire and the rod are Fasteners, and +Infinity beats the rod's finite slenderness.
    expect(plan.steps[0]?.partId).toBe("wire");
    expect(first?.steps.afterSlenderness).toEqual(["wire"]);
  });

  it("chooses the smallest-escape axis, and the lowest index among axes within 1e-9", () => {
    // A spans x in [0, 1]. B spans x in [0.5, 0.5 + dx] and overlaps A on y and z. A is blocked
    // along every axis except +X (0) and -X (1).
    const tieBreak = (dx: number): { dirIndex: number; escape: number } => {
      const a = synthPart("A", [0.5, 0, 0], [0.5, 0.5, 0.5]);
      const b: PeelPartInput = {
        ...synthPart("B", [0.5, 0, 0], [0.5, 0.5, 0.5]),
        aabb: { min: [0.5, -0.5, -0.5], max: [0.5 + dx, 0.5, 0.5] },
      };
      const { trace } = runPeel(peelInput([a, b], blockAll("A", "B", [PLUS_X, MINUS_X])), DEFAULT_SOLVER_CONFIG, { trace: true });
      const chosen = trace?.iterations[0]?.keys.find((candidate) => candidate.partId === "A");
      if (chosen === undefined) {
        throw new Error("A was not removable");
      }
      return { dirIndex: chosen.dirIndex, escape: chosen.escapeDistance };
    };
    // -X escape = A.max_x - B.min_x = 1 - 0.5 = 0.5. +X escape = B.max_x - A.min_x = 0.5 + dx.
    const within = tieBreak(8e-10);
    expect(within.dirIndex).toBe(PLUS_X);
    expect(within.escape).toBeCloseTo(0.5 + 8e-10, 15);
    const beyond = tieBreak(3e-9);
    expect(beyond.dirIndex).toBe(MINUS_X);
    expect(beyond.escape).toBeCloseTo(0.5, 15);
  });

  it("recomputes radial exposure against the unremoved Parts only (Req 15.4)", () => {
    const parts = [cube("a", [-3, 0, 0]), cube("b", [0, 0, 0]), cube("c", [3, 0, 0])];
    const { plan, trace } = runPeel(peelInput(parts, []), DEFAULT_SOLVER_CONFIG, { trace: true });
    // Mean 0: exposures 3, 0, 3. "a" and "c" tie, so the smaller Part_ID goes first.
    expect(plan.steps.map((step) => step.partId)).toEqual(["a", "b", "c"]);
    const exposures = (iteration: number): Record<string, number> =>
      Object.fromEntries((trace?.iterations[iteration]?.keys ?? []).map((candidate) => [candidate.partId, candidate.radialExposure]));
    expect(exposures(0)).toEqual({ a: 3, b: 0, c: 3 });
    // After "a" leaves, the mean moves to x = 1.5, so b and c are both 1.5 away.
    expect(exposures(1)).toEqual({ b: 1.5, c: 1.5 });
  });

  it("treats slenderness within 1e-9 as tied, so radial exposure decides (Req 15.1, 15.3)", () => {
    // P has slenderness 10. Q has 10 + 5e-10, which is inside the tolerance, so Q's higher
    // slenderness does not win. P is farther from the mean center, so P goes first.
    const p = synthPart("P", [3, 0, 0], [0.5, 0.05, 0.05]);
    const q = synthPart("Q", [-1, 0, 0], [0.5 + 2.5e-11, 0.05, 0.05]);
    const filler = cube("R", [0, 0, 0]);
    const { plan, trace } = runPeel(peelInput([p, q, filler], []), DEFAULT_SOLVER_CONFIG, { trace: true });
    const keys = trace?.iterations[0]?.keys ?? [];
    const slendernessOf = (id: string): number => keys.find((candidate) => candidate.partId === id)?.slenderness ?? Number.NaN;
    expect(slendernessOf("Q") - slendernessOf("P")).toBeGreaterThan(0);
    expect(slendernessOf("Q") - slendernessOf("P")).toBeLessThan(1e-9);
    expect(trace?.iterations[0]?.steps.afterSlenderness).toEqual(["P", "Q"]);
    expect(plan.steps[0]?.partId).toBe("P");
  });

  it("picks the Fastener first even when the Part_ID order says otherwise", () => {
    const parts = [cube("a", [0, 0, 0]), synthPart("z", [4, 0, 0], [0.5, 0.05, 0.05])];
    const { plan } = runPeel(peelInput(parts, []), DEFAULT_SOLVER_CONFIG);
    expect(plan.steps.map((step) => step.partId)).toEqual(["z", "a"]);
  });

  it("gives the same plan when the input Parts and edges are listed in another order", () => {
    const parts = [cube("c", [0, 0, 0]), cube("a", [1, 0, 0]), cube("b", [2, 0, 0])];
    const edges = [...blockAll("a", "b"), ...blockAll("b", "c", [4])];
    const forward = runPeel(peelInput(parts, edges), DEFAULT_SOLVER_CONFIG).plan;
    const shuffled = runPeel(peelInput([...parts].reverse(), [...edges].reverse()), DEFAULT_SOLVER_CONFIG).plan;
    expect(shuffled).toEqual(forward);
  });

  it("rejects an edge that names an unknown Part or an axis outside the Candidate_Axes", () => {
    expect(() => runPeel(peelInput([cube("a", [0, 0, 0])], [edge("a", "ghost", 0)]), DEFAULT_SOLVER_CONFIG)).toThrow(RangeError);
    expect(() =>
      runPeel(peelInput([cube("a", [0, 0, 0]), cube("b", [1, 0, 0])], [edge("a", "b", AXIS_COUNT)]), DEFAULT_SOLVER_CONFIG),
    ).toThrow(RangeError);
  });
});

describe("Peel_Solver deadlocks (Req 16.1)", () => {
  it("reports a mutual block with 0 steps and one SCC", () => {
    const parts = [cube("A", [0, 0, 0]), cube("B", [0.1, 0, 0])];
    const { plan } = runPeel(peelInput(parts, [...blockAll("A", "B"), ...blockAll("B", "A")]), DEFAULT_SOLVER_CONFIG);
    if (plan.status !== "deadlocked") {
      throw new Error(`expected a deadlock, received ${plan.status}`);
    }
    expect(plan.steps).toEqual([]);
    expect(plan.witness.sccs).toHaveLength(1);
    expect(plan.witness.sccs[0]?.partIds).toEqual(["A", "B"]);
    expect(plan.witness.sccs[0]?.edges).toHaveLength(2 * AXIS_COUNT);
    expect(plan.witness.unassignedPartIds).toEqual([]);
  });

  it("lists the steps completed before the deadlock, in peel order", () => {
    const parts = [cube("A", [0, 0, 0]), cube("B", [0.1, 0, 0]), cube("free", [5, 0, 0])];
    const edges = [...blockAll("A", "B"), ...blockAll("B", "A")];
    const { plan } = runPeel(peelInput(parts, edges), DEFAULT_SOLVER_CONFIG);
    if (plan.status !== "deadlocked") {
      throw new Error(`expected a deadlock, received ${plan.status}`);
    }
    expect(plan.steps.map((step) => step.partId)).toEqual(["free"]);
    expect(plan.witness.sccs[0]?.partIds).toEqual(["A", "B"]);
  });

  it("reports a multi-node cycle and lists the upstream chain as unassigned", () => {
    // X -> Y -> A -> B -> C -> A. X and Y are blocked too, but they are not in a sink SCC.
    const parts = ["X", "Y", "A", "B", "C"].map((id, i) => cube(id, [i * 0.1, 0, 0]));
    const edges = [
      ...blockAll("X", "Y"),
      ...blockAll("Y", "A"),
      ...blockAll("A", "B"),
      ...blockAll("B", "C"),
      ...blockAll("C", "A"),
    ];
    const { plan } = runPeel(peelInput(parts, edges), DEFAULT_SOLVER_CONFIG);
    if (plan.status !== "deadlocked") {
      throw new Error(`expected a deadlock, received ${plan.status}`);
    }
    expect(plan.witness.sccs.map((scc) => scc.partIds)).toEqual([["A", "B", "C"]]);
    expect(plan.witness.unassignedPartIds).toEqual(["X", "Y"]);
    expect(plan.witness.sccs[0]?.edges.map((e) => `${e.from}>${e.to}`).filter((v, i, all) => all.indexOf(v) === i)).toEqual([
      "A>B",
      "B>C",
      "C>A",
    ]);
  });

  it("carries the normalization and sampling metadata, as copies", () => {
    const parts = [cube("A", [0, 0, 0]), cube("B", [0.1, 0, 0])];
    const source = peelInput(parts, [...blockAll("A", "B"), ...blockAll("B", "A")]);
    const { plan } = runPeel(source, DEFAULT_SOLVER_CONFIG);
    expect(plan.normalization).toEqual(source.normalization);
    expect(plan.normalization).not.toBe(source.normalization);
    expect(plan.sampling).toEqual(source.sampling);
    expect(plan.sampling).not.toBe(source.sampling);
  });
});

// ---------------------------------------------------------------------------
// Tarjan
// ---------------------------------------------------------------------------

describe("iterative Tarjan (Req 16.2)", () => {
  it("finds a multi-node cycle with an upstream chain and a downstream tail", () => {
    // 0 -> 1 -> 2 -> 3 -> 4 -> 2 (cycle 2,3,4), plus 4 -> 5.
    const components = tarjanScc([[1], [2], [3], [4], [2, 5], []]);
    const sorted = components.map((c) => c.slice()).sort((a, b) => (a[0] as number) - (b[0] as number));
    expect(sorted).toEqual([[0], [1], [2, 3, 4], [5]]);
    // Tarjan completes a component after every component it can reach.
    const position = (node: number): number => components.findIndex((c) => c.includes(node));
    expect(position(5)).toBeLessThan(position(2));
    expect(position(2)).toBeLessThan(position(1));
    expect(position(1)).toBeLessThan(position(0));
  });

  it("does not depend on the order in which neighbors are listed", () => {
    const a = tarjanScc([[1, 2], [0, 3], [3], [2]]);
    const b = tarjanScc([[2, 1], [3, 0], [3], [2]]);
    expect(b).toEqual(a);
    expect(a.map((c) => c.slice().sort((x, y) => x - y))).toEqual([[2, 3], [0, 1]]);
  });

  it("handles self-loops, repeated neighbors and isolated nodes", () => {
    expect(tarjanScc([[0, 0], [], [1, 1]]).map((c) => c.length)).toEqual([1, 1, 1]);
  });

  it("handles a 200,000-node chain and a 200,000-node cycle without recursion", () => {
    const size = 200_000;
    const chain = Array.from({ length: size }, (_, v) => (v + 1 < size ? [v + 1] : []));
    const chainComponents = tarjanScc(chain);
    expect(chainComponents).toHaveLength(size);
    expect(chainComponents[0]).toEqual([size - 1]);

    const ring = Array.from({ length: size }, (_, v) => [(v + 1) % size]);
    const ringComponents = tarjanScc(ring);
    expect(ringComponents).toHaveLength(1);
    expect(ringComponents[0]?.length).toBe(size);
  });

  it("rejects a neighbor that is not a node", () => {
    expect(() => tarjanScc([[1]])).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// SCC_Analyzer
// ---------------------------------------------------------------------------

describe("SCC_Analyzer (Req 16.3 to 16.7)", () => {
  it("throws DeadlockWitnessInvariantError when no witness SCC exists", () => {
    // No edges at all: nothing is blocked, so this is not a deadlock.
    expect(() => buildDeadlockWitness(["a", "b"], [])).toThrow(DeadlockWitnessInvariantError);
    // An acyclic graph has only singleton SCCs.
    expect(() => buildDeadlockWitness(["a", "b"], [edge("a", "b", 0)])).toThrow(DeadlockWitnessInvariantError);
    // A cycle that still has an edge to an unremoved Part outside it is not a sink SCC, and the
    // only sink is a singleton.
    expect(() =>
      buildDeadlockWitness(["a", "b", "c"], [edge("a", "b", 0), edge("b", "a", 0), edge("b", "c", 1)]),
    ).toThrow(DeadlockWitnessInvariantError);
  });

  it("throws an error with a stable code and no partial witness", () => {
    let thrown: unknown;
    try {
      buildDeadlockWitness(["a"], []);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DeadlockWitnessInvariantError);
    expect((thrown as DeadlockWitnessInvariantError).code).toBe("DeadlockWitnessInvariant");
  });

  it("reports only sink SCCs with two or more members and orders them by smallest member", () => {
    // Sink cycle {m, n}, a second sink cycle {c, d}, a non-sink cycle {p, q} that feeds {m, n}.
    const edges = [
      edge("m", "n", 3),
      edge("n", "m", 4),
      edge("c", "d", 0),
      edge("d", "c", 1),
      edge("p", "q", 2),
      edge("q", "p", 2),
      edge("q", "m", 5),
    ];
    const witness = buildDeadlockWitness(["q", "n", "m", "p", "d", "c"], edges);
    expect(witness.sccs.map((scc) => scc.partIds)).toEqual([["c", "d"], ["m", "n"]]);
    expect(witness.unassignedPartIds).toEqual(["p", "q"]);
    expect(witness.sccs[1]?.edges.map((e) => [e.from, e.to, e.dirIndex])).toEqual([
      ["m", "n", 3],
      ["n", "m", 4],
    ]);
  });

  it("ignores edges that reach a removed Part and lists each internal edge once with its triangles", () => {
    const edges = [
      { ...edge("a", "b", 7), fromTriangles: [4, 5], toTriangles: [0] },
      edge("b", "a", 7),
      edge("a", "gone", 8),
      edge("gone", "a", 8),
    ];
    const witness = buildDeadlockWitness(["a", "b"], edges);
    expect(witness.sccs).toHaveLength(1);
    expect(witness.sccs[0]?.edges).toEqual([
      { from: "a", to: "b", dirIndex: 7, dir: axisAt(7), fromTriangles: [4, 5], toTriangles: [0] },
      { from: "b", to: "a", dirIndex: 7, dir: axisAt(7), fromTriangles: [0, 2], toTriangles: [1] },
    ]);
  });

  it("orders Part_IDs by code unit", () => {
    const witness = buildDeadlockWitness(["a", "B", "C"], [edge("a", "B", 0), edge("B", "a", 0)]);
    expect(witness.sccs[0]?.partIds).toEqual(["B", "a"]);
    expect(witness.unassignedPartIds).toEqual(["C"]);
  });

  it("every Part of a witness SCC has an edge to its own SCC along every axis (Req 16.6)", () => {
    const parts = [cube("A", [0, 0, 0]), cube("B", [0.1, 0, 0]), cube("C", [0.2, 0, 0])];
    // Each axis is blocked by a different member of the SCC.
    const edges: BlockingEdge[] = [];
    for (let k = 0; k < AXIS_COUNT; k++) {
      edges.push(edge("A", k % 2 === 0 ? "B" : "C", k), edge("B", "C", k), edge("C", "A", k));
    }
    const { plan } = runPeel(peelInput(parts, edges), DEFAULT_SOLVER_CONFIG);
    if (plan.status !== "deadlocked") {
      throw new Error(`expected a deadlock, received ${plan.status}`);
    }
    for (const scc of plan.witness.sccs) {
      for (const member of scc.partIds) {
        for (let k = 0; k < AXIS_COUNT; k++) {
          const covered = scc.edges.some((e) => e.from === member && e.dirIndex === k && scc.partIds.includes(e.to));
          expect(covered, `${member} axis ${k}`).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Stage 3 on real Stage 1 and Stage 2 data, and the pipeline
// ---------------------------------------------------------------------------

function boxMesh(min: Vec3, max: Vec3) {
  const positions: number[] = [];
  for (let i = 0; i < CUBE_POSITIONS.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const t = CUBE_POSITIONS[i + k] ?? 0;
      positions.push((min[k] ?? 0) + t * ((max[k] ?? 0) - (min[k] ?? 0)));
    }
  }
  return meshFromArrays(positions, CUBE_TRIANGLES);
}

/** Three boxes stacked along z with 0.05 gaps, and a fourth box beside the stack. */
function stackScene() {
  return groupOf(
    boxMesh([0, 0, 0], [1, 1, 1]),
    boxMesh([0, 0, 1.05], [1, 1, 2.05]),
    boxMesh([0, 0, 2.1], [1, 1, 3.1]),
    boxMesh([1.5, 0, 0], [2.5, 1, 1]),
  );
}

describe("Stage 3 on a real Blocking_Graph", () => {
  it("returns an ErrorResult unchanged, from either argument", () => {
    const error: ErrorResult = {
      status: "error",
      error: { kind: "EmptyAssemblyError", message: "empty", diagnostics: [] },
      diagnostics: [],
    };
    const stage1 = prepare(stackScene());
    const graph = stage2BuildDbg(stage1, stage1.config);
    expect(stage3Peel(error, graph, DEFAULT_SOLVER_CONFIG)).toBe(error);
    expect(stage3Peel(stage1, error, DEFAULT_SOLVER_CONFIG)).toBe(error);
  });

  it("emits a dependency-valid plan: no step is blocked by a Part that leaves later (Req 14.7)", () => {
    const stage1 = prepare(stackScene());
    const graph = stage2BuildDbg(stage1, stage1.config);
    const plan = stage3Peel(stage1, graph, stage1.config);
    expect(plan.status).toBe("solved");
    expect(plan.steps).toHaveLength(stage1.parts.length);
    expect(new Set(plan.steps.map((step) => step.partId)).size).toBe(stage1.parts.length);
    const position = new Map(plan.steps.map((step, index) => [step.partId, index] as const));
    for (const [index, step] of plan.steps.entries()) {
      expect(step.secondary).toBeNull();
      expect(Number.isFinite(step.escapeDistance) && step.escapeDistance >= 0).toBe(true);
      for (const blocking of graph.edges) {
        if (blocking.from === step.partId && blocking.dirIndex === step.dirIndex) {
          const blockerPosition = position.get(blocking.to);
          expect(blockerPosition, `${step.partId} blocked by ${blocking.to}`).toBeLessThan(index);
        }
      }
    }
  });

  it("solves the same input to the same plan twice (Req 14.9)", () => {
    const stage1 = prepare(stackScene());
    const graph = stage2BuildDbg(stage1, stage1.config);
    expect(stage3Peel(stage1, graph, stage1.config)).toEqual(stage3Peel(stage1, graph, stage1.config));
  });
});

describe("solveDisassembly (Req 30.1, 30.6, 30.7)", () => {
  it("equals the stage functions called in order", () => {
    const root = stackScene();
    const stage0 = stage0ParseScene(root);
    const stage1 = stage1Prepare(stage0);
    if (stage1.status === "error") {
      throw new Error(stage1.error.message);
    }
    const chained = stage3Peel(stage1, stage2BuildDbg(stage1, stage1.config), stage1.config);
    expect(solveDisassembly(stackScene())).toEqual(chained);
  });

  it("returns errors as values, in precedence order, without throwing", () => {
    const bad = solveDisassembly(stackScene(), { tau: 2 });
    expect(bad.status).toBe("error");
    expect(bad.status === "error" && bad.error.kind).toBe("ConfigurationError");

    const empty = solveDisassembly(groupOf());
    expect(empty.status === "error" && empty.error.kind).toBe("EmptyAssemblyError");

    const mono = solveDisassembly(groupOf(boxMesh([0, 0, 0], [1, 1, 1])));
    expect(mono.status === "error" && mono.error.kind).toBe("MonolithicMeshError");

    // A configuration error wins over a geometry error: nothing is read from the hierarchy.
    const both: DisassemblyPlan = solveDisassembly(groupOf(), { microShrink: -1 });
    expect(both.status === "error" && both.error.kind).toBe("ConfigurationError");
  });

  it("leaves stride, normalization and sampling metadata on the plan", () => {
    const plan = solveDisassembly(stackScene());
    if (plan.status === "error") {
      throw new Error(plan.error.message);
    }
    expect(plan.sampling).toEqual({ stride: 1, polyBudgetExceeded: false, totalTriangles: 48, polyBudget: 150000 });
    expect(plan.normalization.scale).toBeGreaterThan(0);
  });
});
