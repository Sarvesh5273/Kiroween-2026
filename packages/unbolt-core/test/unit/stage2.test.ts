import { type Group, LatheGeometry, type Mesh, Vector2 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidSampleCountError } from "../../src/errors";
import { CANONICAL_DIRECTIONS } from "../../src/stage1/candidateAxes";
import { stage2BuildDbg } from "../../src/stage2/dbgBuilder";
import { filterNearest } from "../../src/stage2/hitFilter";
import { castAllHits, createRayHits, createRayTarget } from "../../src/stage2/rayCast";
import type { BlockingGraph, ErrorResult, NormalizedPart, Stage1Result, Vec3 } from "../../src/types";
import { CUBE_POSITIONS, CUBE_TRIANGLES, groupOf, meshFromArrays, prepare } from "../helpers/handMeshes";
// The wrapper behaves like the real sampler. It only counts calls, so a test can prove that the
// sampler was never reached.
const counters = vi.hoisted(() => ({ sampleSets: 0 }));
vi.mock("../../src/stage2/sampler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/stage2/sampler")>();
  return {
    ...actual,
    buildSampleSet: (...args: Parameters<typeof actual.buildSampleSet>) => {
      counters.sampleSets++;
      return actual.buildSampleSet(...args);
    },
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  counters.sampleSets = 0;
});
const PLUS_Z = 4;
const MINUS_Z = 5;
function partAt(stage1: Stage1Result, childIndex: number): NormalizedPart {
  const part = stage1.parts.find((candidate) => candidate.sourceNodePath[0] === childIndex);
  if (part === undefined) {
    throw new Error(`no Part came from child ${childIndex}`);
  }
  return part;
}
function edgeOf(graph: BlockingGraph, from: NormalizedPart, to: NormalizedPart, dirIndex: number) {
  return graph.edges.find((edge) => edge.from === from.partId && edge.to === to.partId && edge.dirIndex === dirIndex);
}
/** An axis-aligned box built from the unit cube. */
function boxMesh(min: Vec3, max: Vec3): Mesh {
  const positions: number[] = [];
  for (let i = 0; i < CUBE_POSITIONS.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const t = CUBE_POSITIONS[i + k] ?? 0;
      positions.push((min[k] ?? 0) + t * ((max[k] ?? 0) - (min[k] ?? 0)));
    }
  }
  return meshFromArrays(positions, CUBE_TRIANGLES);
}
// ---------------------------------------------------------------------------
// Fixture 1: a grazing ramp in front of an opposing wall
// ---------------------------------------------------------------------------
/** Source triangles 0 to 3 are the wall (normal -Z). Source triangles 4 and 5 are the ramp. */
const FIRST_RAMP_SOURCE_TRIANGLE = 4;
/**
 * Part B is one connected surface. A wall at z = 1 faces the source Part (normal -Z). A narrow
 * ramp hangs from the wall's middle seam down to z = 0.4, tilted about 2.3 degrees from the ray,
 * so its outward normal has `dot(n, +Z) = -0.03997`. That is inside `(-tau, 0)` for the default
 * Tau of 0.05, so a ray meets the ramp first and must discard it as grazing.
 *
 * Part A is a small box whose whole footprint lies under the ramp, so every ray along +Z from A
 * crosses the ramp before it reaches the wall.
 */
function rampAndWallScene(): Group {
  const positions = [
    -1, -1, 1, //  0 wall
    0, -1, 1, //   1 wall, ramp top
    1, -1, 1, //   2 wall
    1, 1, 1, //    3 wall
    0, 1, 1, //    4 wall, ramp top
    -1, 1, 1, //   5 wall
    -0.024, -1, 0.4, // 6 ramp bottom
    -0.024, 1, 0.4, //  7 ramp bottom
  ];
  const triangles = [0, 5, 1, 1, 5, 4, 1, 4, 2, 2, 4, 3, 1, 6, 4, 4, 6, 7];
  const sourceBox = boxMesh([-0.018, -0.2, -0.5], [-0.008, 0.2, -0.3]);
  return groupOf(sourceBox, meshFromArrays(positions, triangles));
}
describe("Stage 2: grazing hits never mask a farther opposing hit (Req 13.5, 13.6)", () => {
  const stage1 = prepare(rampAndWallScene());
  const source = partAt(stage1, 0);
  const wall = partAt(stage1, 1);
  const { tau, clearanceEpsilon } = stage1.config;
  const isRamp = (localTriangle: number): boolean =>
    (wall.sourceTriangleIndices[localTriangle] ?? -1) >= FIRST_RAMP_SOURCE_TRIANGLE;
  it("builds the fixture as intended: the ramp is grazing and the wall opposes +Z", () => {
    expect(source.candidateAxes[PLUS_Z]).toEqual([0, 0, 1]);
    for (let t = 0; t < wall.triangles.length / 3; t++) {
      const nz = wall.faceNormals[3 * t + 2] ?? Number.NaN;
      if (isRamp(t)) {
        expect(nz).toBeLessThan(0);
        expect(nz).toBeGreaterThan(-tau);
      } else {
        expect(nz).toBeCloseTo(-1, 12);
      }
    }
  });
  it("collects every hit of a ray, the ramp first and the wall behind, and the filter picks the wall", () => {
    const hits = createRayHits();
    const { min, max } = source.aabb;
    const origin: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, max[2]];
    const dir: Vec3 = [0, 0, 1];
    const count = castAllHits(createRayTarget(wall), origin[0], origin[1], origin[2], dir, hits);
    expect(count).toBe(2);
    const order = [0, 1].sort((a, b) => (hits.distance[a] ?? 0) - (hits.distance[b] ?? 0));
    const nearest = hits.faceIndex[order[0] ?? 0] ?? -1;
    const farthest = hits.faceIndex[order[1] ?? 0] ?? -1;
    // With a nearest-hit-only query the ramp would be the answer.
    expect(isRamp(nearest)).toBe(true);
    expect(isRamp(farthest)).toBe(false);
    const survivor = filterNearest(hits, dir, wall.faceNormals, clearanceEpsilon, tau);
    expect(survivor).toBe(farthest);
  });
  it("records the edge (A, B, +Z) from every A-origin ray and lists a wall triangle", () => {
    const graph = stage2BuildDbg(stage1, stage1.config, { collectRayCounts: true });
    const edge = edgeOf(graph, source, wall, PLUS_Z);
    expect(edge).toBeDefined();
    expect(edge?.toTriangles.some((t) => !isRamp(t))).toBe(true);
    expect(edge?.fromTriangles.length).toBeGreaterThan(0);
    const record = graph.diagnostics?.rayCounts.find(
      (r) => r.from === source.partId && r.to === wall.partId && r.dirIndex === PLUS_Z,
    );
    // Every one of the N rays crosses the grazing ramp and still reaches the wall.
    expect(record?.forwardRays).toBe(stage1.config.samplesPerPartPerDirection);
  });
});
// ---------------------------------------------------------------------------
// Fixture 2: a screw coaxial in a countersunk hole
// ---------------------------------------------------------------------------
/** A solid of revolution about Z from a closed (radius, z) loop, outward-wound, with collapsed pole triangles dropped. */
function latheMesh(profile: readonly (readonly [number, number])[], segments = 24): Mesh {
  const geometry = new LatheGeometry(
    profile.map(([r, z]) => new Vector2(r, z)),
    segments,
  );
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (index === null) {
    throw new Error("LatheGeometry returned no index");
  }
  // `LatheGeometry` revolves around Y. Swapping Y and Z puts the axis on Z. The swap mirrors the
  // solid, which the signed-volume check below corrects by reversing the winding.
  const point = (v: number): Vec3 => [position.getX(v), position.getZ(v), position.getY(v)];
  const triangles: number[] = [];
  let signedVolume = 0;
  for (let c = 0; c < index.count; c += 3) {
    const [a, b, d] = [index.getX(c), index.getX(c + 1), index.getX(c + 2)];
    const [pa, pb, pd] = [point(a), point(b), point(d)];
    const ab: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const ad: Vec3 = [pd[0] - pa[0], pd[1] - pa[1], pd[2] - pa[2]];
    const cross: Vec3 = [ab[1] * ad[2] - ab[2] * ad[1], ab[2] * ad[0] - ab[0] * ad[2], ab[0] * ad[1] - ab[1] * ad[0]];
    if (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2] < 1e-18) {
      continue;
    }
    triangles.push(a, b, d);
    signedVolume += (pa[0] * (pb[1] * pd[2] - pb[2] * pd[1]) - pa[1] * (pb[0] * pd[2] - pb[2] * pd[0]) + pa[2] * (pb[0] * pd[1] - pb[1] * pd[0])) / 6;
  }
  if (signedVolume < 0) {
    for (let t = 0; t < triangles.length; t += 3) {
      const second = triangles[t + 1] ?? 0;
      triangles[t + 1] = triangles[t + 2] ?? 0;
      triangles[t + 2] = second;
    }
  }
  const positions: number[] = [];
  for (let v = 0; v < position.count; v++) {
    positions.push(...point(v));
  }
  return meshFromArrays(positions, triangles);
}
/**
 * Plate: radius 1, thickness 0.3, bore radius 0.1, countersink widening at 45 degrees from the
 * bore top (z = 0.1) to radius 0.3 at the top face. Screw: shaft radius 0.07, head cone 0.03
 * inside the countersink in the radial direction, head top flush with the plate top. The
 * outward axis of the screw, from tip to head, is +Z.
 */
function screwInCountersinkScene(): Group {
  const screw = latheMesh([
    [0, -0.5],
    [0.07, -0.5],
    [0.07, 0.13],
    [0.1, 0.13],
    [0.27, 0.3],
    [0, 0.3],
  ]);
  const plate = latheMesh([
    [0.1, 0],
    [1, 0],
    [1, 0.3],
    [0.3, 0.3],
    [0.1, 0.1],
    [0.1, 0],
  ]);
  return groupOf(screw, plate);
}
describe("Stage 2: coaxial clearance does not block the outward axis (Req 13.7)", () => {
  const stage1 = prepare(screwInCountersinkScene());
  const screw = partAt(stage1, 0);
  const hole = partAt(stage1, 1);
  it("records no edge (screw, hole, +Z) for every Tau tested, while inward motion is blocked", () => {
    expect(screw.candidateAxes[PLUS_Z]).toEqual([0, 0, 1]);
    for (const tau of [0, 0.05, 0.5, 0.95]) {
      const graph = stage2BuildDbg(stage1, { ...stage1.config, tau });
      expect(edgeOf(graph, screw, hole, PLUS_Z), `tau ${tau}`).toBeUndefined();
      if (tau <= 0.5) {
        // The head faces the countersink at 45 degrees, so moving the screw in (-Z) is blocked.
        // This proves the Parts interact and the absence above is not a pruning accident.
        expect(edgeOf(graph, screw, hole, MINUS_Z), `tau ${tau}`).toBeDefined();
      }
    }
  });
});
// ---------------------------------------------------------------------------
// Ray-count collector
// ---------------------------------------------------------------------------
function compareTriples(
  a: { from: string; dirIndex: number; to: string },
  b: { from: string; dirIndex: number; to: string },
): number {
  if (a.from !== b.from) {
    return a.from < b.from ? -1 : 1;
  }
  if (a.dirIndex !== b.dirIndex) {
    return a.dirIndex - b.dirIndex;
  }
  return a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
}
describe("Stage 2: collectRayCounts leaves edges and stats unchanged (Req 22.17, 22.18)", () => {
  // The second element says whether the scene must also prune some triples. The ramp and wall
  // Parts are far apart, while the screw sits inside the hole, so its OBBs overlap everywhere.
  const scenes: [string, boolean, () => Group][] = [
    ["ramp and wall", true, rampAndWallScene],
    ["screw in countersink", false, screwInCountersinkScene],
  ];
  it.each(scenes)("%s", (_name, mustPrune, build) => {
    const stage1 = prepare(build());
    const plain = stage2BuildDbg(stage1, stage1.config);
    const explicitOff = stage2BuildDbg(stage1, stage1.config, { collectRayCounts: false });
    const counted = stage2BuildDbg(stage1, stage1.config, { collectRayCounts: true });
    expect("diagnostics" in plain).toBe(false);
    expect("diagnostics" in explicitOff).toBe(false);
    expect(counted.edges).toEqual(plain.edges);
    expect(counted.stats).toEqual(plain.stats);
    expect(counted.partIds).toEqual(plain.partIds);
    expect(counted.candidateAxes).toEqual(plain.candidateAxes);
    const diagnostics = counted.diagnostics;
    if (diagnostics === undefined) {
      throw new Error("collectRayCounts: true produced no diagnostics");
    }
    expect(plain.edges.length).toBeGreaterThan(0);
    // One record per edge, in the same order, with at least one colliding ray and at most N per side.
    expect(diagnostics.rayCounts.map(({ from, to, dirIndex }) => ({ from, to, dirIndex }))).toEqual(
      plain.edges.map(({ from, to, dirIndex }) => ({ from, to, dirIndex })),
    );
    const rays = stage1.config.samplesPerPartPerDirection;
    for (const record of diagnostics.rayCounts) {
      expect(record.forwardRays + record.backwardRays).toBeGreaterThanOrEqual(1);
      expect(record.forwardRays).toBeLessThanOrEqual(rays);
      expect(record.backwardRays).toBeLessThanOrEqual(rays);
    }
    expect(diagnostics.prunedTriples).toHaveLength(plain.stats.pairsPruned);
    expect(plain.stats.pairsPruned > 0).toBe(mustPrune);
    expect([...diagnostics.prunedTriples].sort(compareTriples)).toEqual(diagnostics.prunedTriples);
    expect([...diagnostics.rayCounts].sort(compareTriples)).toEqual(diagnostics.rayCounts);
    const pruned = new Set(diagnostics.prunedTriples.map((t) => `${t.from}|${t.to}|${t.dirIndex}`));
    for (const edge of plain.edges) {
      expect(pruned.has(`${edge.from}|${edge.to}|${edge.dirIndex}`)).toBe(false);
    }
  });
});
// ---------------------------------------------------------------------------
// InvalidSampleCountError
// ---------------------------------------------------------------------------
describe("Stage 2: an invalid sample count throws before any sampling or ray cast (Req 12.8)", () => {
  const stage1 = prepare(groupOf(boxMesh([0, 0, 0], [1, 1, 1]), boxMesh([0, 0, 2], [1, 1, 3])));
  const cases: [string, unknown, string][] = [
    ["zero", 0, "0"],
    ["negative", -3, "-3"],
    ["fraction", 1.5, "1.5"],
    ["NaN", Number.NaN, "NaN"],
    ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
    ["a string", "48", '"48"'],
  ];
  it.each(cases)("%s", (_name, value, rejected) => {
    const raycast = vi.spyOn(MeshBVH.prototype, "raycast");
    const config = { ...stage1.config, samplesPerPartPerDirection: value as number };
    let thrown: unknown;
    try {
      stage2BuildDbg(stage1, config);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidSampleCountError);
    expect((thrown as InvalidSampleCountError).rejected).toBe(rejected);
    expect(counters.sampleSets).toBe(0);
    expect(raycast).not.toHaveBeenCalled();
  });
  it("does cast and sample for a valid count of 1, so the spies are live", () => {
    const raycast = vi.spyOn(MeshBVH.prototype, "raycast");
    const graph = stage2BuildDbg(stage1, { ...stage1.config, samplesPerPartPerDirection: 1 });
    expect(counters.sampleSets).toBe(stage1.parts.length);
    expect(raycast).toHaveBeenCalled();
    expect(graph.stats.raysCast).toBeGreaterThan(0);
  });
  it("returns an incoming ErrorResult unchanged", () => {
    const error: ErrorResult = {
      status: "error",
      error: { kind: "EmptyAssemblyError", message: "nothing to solve", diagnostics: [] },
      diagnostics: [],
    };
    expect(stage2BuildDbg(error, stage1.config)).toBe(error);
    expect(counters.sampleSets).toBe(0);
  });
});
// ---------------------------------------------------------------------------
// Bidirectional memoization (Req 12.5)
// ---------------------------------------------------------------------------
describe("Stage 2: opposite directions share ray work without changing edges (Req 12.5)", () => {
  const stage1 = prepare(groupOf(boxMesh([0, 0, 0], [1, 1, 1]), boxMesh([0.2, 0.1, 1.5], [1.4, 0.9, 2.5])));
  const rays = stage1.config.samplesPerPartPerDirection;
  const graph = stage2BuildDbg(stage1, stage1.config, { obbPruning: false });
  it("casts fewer rays than two full sets per triple", () => {
    expect(graph.stats.pairsTested).toBe(2 * 32);
    // 26 canonical directions give 2 shared sets each way, and the 6 PCA axes of each Part give
    // at most 2 sets each, against 2 sets for every one of the 64 triples without sharing.
    expect(graph.stats.raysCast).toBeLessThanOrEqual((2 * 26 + 2 * 2 * 6) * rays);
    expect(graph.stats.raysCast).toBeLessThan(graph.stats.pairsTested * 2 * rays);
  });
  it("gives each canonical edge a mirror (B, A, -d) with the two triangle lists swapped", () => {
    const canonicalEdges = graph.edges.filter((edge) => edge.dirIndex < CANONICAL_DIRECTIONS.length);
    expect(canonicalEdges.length).toBeGreaterThan(0);
    for (const edge of canonicalEdges) {
      const opposite = CANONICAL_DIRECTIONS.findIndex((candidate) => candidate.every((value, k) => value === 0 - edge.dir[k]!));
      expect(opposite).toBeGreaterThanOrEqual(0);
      const mirror = graph.edges.find((other) => other.from === edge.to && other.to === edge.from && other.dirIndex === opposite);
      expect(mirror, `mirror of ${edge.from} -> ${edge.to} @${edge.dirIndex}`).toBeDefined();
      expect(mirror?.fromTriangles).toEqual(edge.toTriangles);
      expect(mirror?.toTriangles).toEqual(edge.fromTriangles);
    }
  });
});
