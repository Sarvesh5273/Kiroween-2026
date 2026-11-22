import { BufferAttribute, BufferGeometry, Box3, Group, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { checkClashes } from "../../src/oracle/clashChecker";
import { DEFAULT_SOLVER_CONFIG } from "../../src/config";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import type { Stage1Result } from "../../src/types";
import {
  findIntersectingTrianglePairs,
  findNodeByPath,
  findSourceMesh,
  measureInwardThickness,
  minTriangleDistance,
  minVertexDistance,
  radialClearanceLowerBound,
  readConstructionAxis,
  TriangleTree,
  triangleDistance,
  trianglesIntersect,
  type V3,
} from "../helpers/kitGeometry";
import { type KitCase, KIT_CASES, kitsIn } from "../helpers/kitSet";
import { CUBE_POSITIONS, CUBE_TRIANGLES } from "../helpers/handMeshes";
import { checkWatertight } from "../helpers/watertight";
/**
 * Kit geometry guarantee tests (Req 9.2, 22.15, 22.16, 23.11, 24.2 to 24.4), on the normalized
 * Parts of the 5 kits at defaults and the Keyboard_Fixture. Distances, intersections and
 * thickness come from `test/helpers/kitGeometry.ts` and `test/helpers/watertight.ts`, which share
 * no code with `src/`. The first block checks those helpers against hand-made cases and a seeded
 * brute-force comparison, so a defect in a helper cannot make a kit pass vacuously.
 */
const TEST_TIMEOUT = 120_000;
const MIN_THICKNESS = 4e-4;
const MIN_CAGE_GAP = 5e-4;
const MIN_FRAME_MARGIN = 1e-3;
const BVH_BOX_TOLERANCE = 1e-6;
// ---------------------------------------------------------------------------
// Helper self-checks
// ---------------------------------------------------------------------------
/** Seeded PRNG for the helper self-checks (mulberry32). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Triangle = readonly [V3, V3, V3];
function randomSoup(random: () => number, count: number, size: number, offset: V3): { positions: Float64Array; triangles: Uint32Array } {
  const positions = new Float64Array(9 * count);
  for (let i = 0; i < count; i++) {
    const center = [random(), random(), random()];
    for (let k = 0; k < 3; k++) {
      for (let c = 0; c < 3; c++) {
        positions[9 * i + 3 * k + c] = offset[c]! + center[c]! + (random() - 0.5) * size;
      }
    }
  }
  return { positions, triangles: Uint32Array.from({ length: 3 * count }, (_, i) => i) };
}
function cornersOf(set: { positions: ArrayLike<number>; triangles: ArrayLike<number> }, t: number): Triangle {
  const corner = (k: number): V3 => {
    const v = set.triangles[3 * t + k]!;
    return [set.positions[3 * v]!, set.positions[3 * v + 1]!, set.positions[3 * v + 2]!];
  };
  return [corner(0), corner(1), corner(2)];
}
function pointOn(triangle: Triangle, u: number, v: number): V3 {
  const w = 1 - u - v;
  return [0, 1, 2].map((c) => w * triangle[0][c]! + u * triangle[1][c]! + v * triangle[2][c]!) as V3;
}
describe("kitGeometry helpers on hand-made triangles", () => {
  const base: Triangle = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  it("measures the distance of parallel triangles and of a vertex-to-face gap", () => {
    const above: Triangle = [
      [0, 0, 0.3],
      [1, 0, 0.3],
      [0, 1, 0.3],
    ];
    expect(triangleDistance(base, above)).toBeCloseTo(0.3, 12);
    expect(trianglesIntersect(base, above)).toBe(false);
    const apex: Triangle = [
      [0.2, 0.2, 0.7],
      [0.9, 0.9, 1.5],
      [0.2, 0.9, 1.5],
    ];
    expect(triangleDistance(base, apex)).toBeCloseTo(0.7, 12);
  });
  it("measures the distance of two skew edges", () => {
    const skew: Triangle = [
      [0.4, -1, 0.5],
      [0.4, 2, 0.5],
      [0.4, 0.5, 2],
    ];
    expect(triangleDistance(base, skew)).toBeCloseTo(0.5, 12);
  });
  it("detects crossing, coplanar-overlapping and vertex-touching triangles", () => {
    const crossing: Triangle = [
      [0.2, 0.2, -1],
      [0.2, 0.2, 1],
      [0.6, 0.3, 0],
    ];
    expect(trianglesIntersect(base, crossing)).toBe(true);
    expect(triangleDistance(base, crossing)).toBe(0);
    const coplanar: Triangle = [
      [0.1, 0.1, 0],
      [2, 0.1, 0],
      [0.1, 2, 0],
    ];
    expect(trianglesIntersect(base, coplanar)).toBe(true);
    const inside: Triangle = [
      [0.1, 0.1, 0],
      [0.3, 0.1, 0],
      [0.1, 0.3, 0],
    ];
    expect(trianglesIntersect(base, inside)).toBe(true);
    const touching: Triangle = [
      [1, 0, 0],
      [2, 0, 1],
      [2, 1, 1],
    ];
    expect(trianglesIntersect(base, touching)).toBe(true);
  });
  it("separates coplanar triangles and near-miss crossings", () => {
    const apart: Triangle = [
      [2, 0, 0],
      [3, 0, 0],
      [2, 1, 0],
    ];
    expect(trianglesIntersect(base, apart)).toBe(false);
    expect(triangleDistance(base, apart)).toBeCloseTo(1, 12);
    const above: Triangle = [
      [0.2, 0.2, 1e-3],
      [0.2, 0.2, 1],
      [0.6, 0.3, 0.5],
    ];
    expect(trianglesIntersect(base, above)).toBe(false);
    expect(triangleDistance(base, above)).toBeCloseTo(1e-3, 12);
  });
  it("agrees with a dense sampling estimate on seeded random triangle pairs", () => {
    const random = seededRandom(0x5eed01);
    let separated = 0;
    let intersecting = 0;
    for (let pair = 0; pair < 60; pair++) {
      const a: Triangle = [0, 1, 2].map(() => [random(), random(), random()] as V3) as unknown as Triangle;
      const b: Triangle = [0, 1, 2].map(() => [random() * 1.2 + 0.3, random(), random()] as V3) as unknown as Triangle;
      const distance = triangleDistance(a, b);
      const intersect = trianglesIntersect(a, b);
      expect(intersect, `pair ${pair}: intersection and distance agree`).toBe(distance === 0);
      // Dense sampling: boundary points of one triangle against grid points of the other, both ways.
      let sampled = Number.POSITIVE_INFINITY;
      const steps = 24;
      const grid: V3[][] = [a, b].map((triangle) => {
        const points: V3[] = [];
        for (let i = 0; i <= steps; i++) {
          for (let j = 0; j <= steps - i; j++) {
            points.push(pointOn(triangle, i / steps, j / steps));
          }
        }
        return points;
      });
      for (const p of grid[0]!) {
        for (const q of grid[1]!) {
          sampled = Math.min(sampled, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
        }
      }
      // Sampling can only overestimate the minimum, and the grid spacing bounds the error.
      expect(distance, `pair ${pair}: exact distance must not exceed a sampled one`).toBeLessThanOrEqual(sampled + 1e-9);
      if (!intersect) {
        separated++;
        expect(sampled - distance, `pair ${pair}: sampled estimate is close`).toBeLessThan(0.15);
      } else {
        intersecting++;
      }
    }
    // The comparison covers both outcomes.
    expect(separated).toBeGreaterThan(5);
    expect(intersecting).toBeGreaterThan(5);
  });
  it("culled tree search equals brute force over all triangle pairs", () => {
    const random = seededRandom(0x5eed02);
    const a = randomSoup(random, 70, 0.25, [0, 0, 0]);
    const b = randomSoup(random, 90, 0.25, [0.4, 0.1, 0.05]);
    const treeA = new TriangleTree(a);
    const treeB = new TriangleTree(b);
    let brute = Number.POSITIVE_INFINITY;
    const intersecting: string[] = [];
    for (let i = 0; i < 70; i++) {
      for (let j = 0; j < 90; j++) {
        const d = triangleDistance(cornersOf(a, i), cornersOf(b, j));
        brute = Math.min(brute, d);
        if (trianglesIntersect(cornersOf(a, i), cornersOf(b, j))) intersecting.push(`${i}:${j}`);
      }
    }
    expect(minTriangleDistance(treeA, treeB).distance).toBeCloseTo(brute, 12);
    expect(
      findIntersectingTrianglePairs(treeA, treeB, 1000)
        .map(([i, j]) => `${i}:${j}`)
        .sort(),
    ).toEqual(intersecting.sort());
    // Two soups that stay apart: the culled search still finds the brute-force minimum.
    const far = randomSoup(random, 90, 0.25, [3, 0, 0]);
    const treeFar = new TriangleTree(far);
    let bruteFar = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 70; i++) {
      for (let j = 0; j < 90; j++) {
        bruteFar = Math.min(bruteFar, triangleDistance(cornersOf(a, i), cornersOf(far, j)));
      }
    }
    expect(bruteFar).toBeGreaterThan(1);
    expect(minTriangleDistance(treeA, treeFar).distance).toBeCloseTo(bruteFar, 12);
  });
  it("applies the projection filter exactly as the brute-force definition does", () => {
    const random = seededRandom(0x5eed03);
    const a = randomSoup(random, 60, 0.2, [0, 0, 0]);
    const b = randomSoup(random, 60, 0.2, [0.3, 0.3, 0.8]);
    const axis: V3 = [0, 0, 1];
    let brute = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 60; i++) {
      for (let j = 0; j < 60; j++) {
        const ta = cornersOf(a, i);
        const tb = cornersOf(b, j);
        const zA = ta.map((p) => p[2]);
        const zB = tb.map((p) => p[2]);
        if (Math.max(...zA) < Math.min(...zB) || Math.max(...zB) < Math.min(...zA)) continue;
        brute = Math.min(brute, triangleDistance(ta, tb));
      }
    }
    expect(Number.isFinite(brute)).toBe(true);
    const filtered = minTriangleDistance(new TriangleTree(a), new TriangleTree(b), { projectionAxis: axis }).distance;
    expect(filtered).toBeCloseTo(brute, 12);
    expect(filtered).toBeGreaterThanOrEqual(minTriangleDistance(new TriangleTree(a), new TriangleTree(b)).distance);
  });
  it("bounds the Radial_Clearance of a pin in a sleeve from below", () => {
    // Two stacked unit-square plates, 0.2 apart along z, offset sideways by 0.5: the projections
    // along z do not overlap, so only the side-by-side overlap in z counts.
    const plate = (x: number, z: number): { positions: number[]; triangles: number[] } => ({
      positions: [x, 0, z, x + 1, 0, z, x + 1, 1, z, x, 1, z],
      triangles: [0, 1, 2, 0, 2, 3],
    });
    const lower = plate(0, 0);
    const upper = plate(0.5, 0.2);
    const trees = [new TriangleTree(lower), new TriangleTree(upper)];
    // Projections along z: [0, 0] and [0.2, 0.2] do not overlap, so no pair qualifies.
    expect(radialClearanceLowerBound(trees, 0, [0, 0, 1]).distance).toBe(Number.POSITIVE_INFINITY);
    // Along x the projections overlap and the plates are 0.2 apart.
    expect(radialClearanceLowerBound(trees, 0, [1, 0, 0]).distance).toBeCloseTo(0.2, 12);
  });
  it("measures the inward thickness of a cube and of a thin slab, as the watertight checker does", () => {
    const cube = { positions: Float64Array.from(CUBE_POSITIONS), triangles: Uint32Array.from(CUBE_TRIANGLES) };
    const cubeReport = measureInwardThickness(new TriangleTree(cube));
    expect(cubeReport.minimum).toBeCloseTo(1, 9);
    expect(cubeReport.unclosedTriangles).toBe(0);
    expect(cubeReport.measuredTriangles).toBe(12);
    const slabPositions = Float64Array.from(CUBE_POSITIONS, (value, i) => (i % 3 === 2 ? value * 0.01 : value * 2));
    const slab = { positions: slabPositions, triangles: Uint32Array.from(CUBE_TRIANGLES) };
    const slabReport = measureInwardThickness(new TriangleTree(slab));
    expect(slabReport.minimum).toBeCloseTo(0.01, 9);
    const reference = checkWatertight(slab.positions, slab.triangles, { minThickness: 0 });
    expect(reference.thickness).toBeCloseTo(slabReport.minimum, 9);
    // An inside-out cube has no inward hit on a closed surface in the other direction: it reports
    // the same thickness, so winding is the watertight checker's job (negative signed volume).
    const flipped = Uint32Array.from(CUBE_TRIANGLES, (_, i) => CUBE_TRIANGLES[i - (i % 3) + ((3 - (i % 3)) % 3)]!);
    expect(checkWatertight(cube.positions, flipped, { minThickness: 0 }).ok).toBe(false);
  });
  it("finds the vertex distance between two clouds", () => {
    expect(minVertexDistance([0, 0, 0, 5, 5, 5], [1, 0, 0, 5, 5, 6])).toBeCloseTo(1, 12);
  });
  it("follows node paths to meshes and rejects bad paths", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float64Array(9), 3));
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = "leaf";
    const inner = new Group();
    inner.add(new Group(), mesh);
    const root = new Group();
    root.add(inner);
    expect(findNodeByPath(root, [])).toBe(root);
    expect(findSourceMesh(root, [0, 1])).toBe(mesh);
    expect(() => findSourceMesh(root, [0, 0])).toThrow(RangeError);
    expect(() => findSourceMesh(root, [0, 2])).toThrow(RangeError);
    expect(() => findSourceMesh(root, [1])).toThrow(RangeError);
  });
  it("accepts a unit Construction_Axis and rejects anything else", () => {
    const mesh = new Mesh();
    mesh.name = "probe";
    mesh.userData.constructionAxis = [0, 1, 0];
    expect(readConstructionAxis(mesh)).toEqual({ axis: [0, 1, 0] });
    for (const bad of [undefined, [0, 1], [0, 2, 0], [0, Number.NaN, 0], ["0", "1", "0"], "y"]) {
      mesh.userData.constructionAxis = bad;
      expect("problem" in readConstructionAxis(mesh), String(bad)).toBe(true);
    }
  });
});
// ---------------------------------------------------------------------------
// Kit guarantees
// ---------------------------------------------------------------------------
const prepared = new Map<string, Stage1Result>();
function prepareKit(kit: KitCase): Stage1Result {
  const cached = prepared.get(kit.name);
  if (cached !== undefined) {
    return cached;
  }
  const stage0 = stage0ParseScene(kit.build());
  if (stage0.status !== "ok") {
    throw new Error(`${kit.name}: Stage 0 returned ${stage0.error.kind}: ${stage0.error.message}`);
  }
  const stage1 = stage1Prepare(stage0);
  if (stage1.status !== "ok") {
    throw new Error(`${kit.name}: Stage 1 returned ${stage1.error.kind}: ${stage1.error.message}`);
  }
  prepared.set(kit.name, stage1);
  return stage1;
}
describe("every Part is a thick Watertight_Solid_Part (Req 22.15, 22.16)", () => {
  for (const kit of KIT_CASES) {
    it(
      `${kit.name}: closed, outward wound, positive volume, thicker than ${MIN_THICKNESS}`,
      () => {
        const stage1 = prepareKit(kit);
        const problems: string[] = [];
        for (const part of stage1.parts) {
          const report = checkWatertight(part.positions, part.triangles, { minThickness: MIN_THICKNESS });
          if (!report.ok) {
            problems.push(`${part.sourceNodeName}: ${report.problems.join("; ")}`);
          }
          if (!(report.signedVolume > 0)) {
            problems.push(`${part.sourceNodeName}: signed volume ${report.signedVolume} is not positive`);
          }
          // The same bound with the fast helper, measured from every centroid.
          const thickness = measureInwardThickness(new TriangleTree(part));
          if (!(thickness.minimum > MIN_THICKNESS) || thickness.unclosedTriangles > 0) {
            problems.push(
              `${part.sourceNodeName}: inward thickness ${thickness.minimum} (triangle ${thickness.minimumTriangle}), ` +
                `${thickness.unclosedTriangles} rays hit nothing`,
            );
          }
        }
        expect(problems, `${kit.name}: Parts that fail the watertight or thickness rule`).toEqual([]);
      },
      TEST_TIMEOUT,
    );
  }
});
describe("showcase and fixture Parts are Frame_Unique (Req 23.11)", () => {
  for (const kit of kitsIn("showcase", "fixture")) {
    it(
      `${kit.name}: every Part is Frame_Unique with minRelativeMargin >= ${MIN_FRAME_MARGIN}`,
      () => {
        const stage1 = prepareKit(kit);
        const offenders = stage1.parts
          .filter((part) => !part.frame.frameUnique || !(part.frame.minRelativeMargin >= MIN_FRAME_MARGIN))
          .map(
            (part) =>
              `${part.sourceNodeName}: frameUnique ${part.frame.frameUnique}, minRelativeMargin ${part.frame.minRelativeMargin}`,
          );
        expect(offenders, `${kit.name}: Parts that are not Frame_Unique`).toEqual([]);
      },
      TEST_TIMEOUT,
    );
  }
});
describe("the BVH root box contains the exact AABB (Req 9.2)", () => {
  for (const kit of KIT_CASES) {
    it(
      `${kit.name}: root box contains the Part's AABB and exceeds it by at most ${BVH_BOX_TOLERANCE}`,
      () => {
        const stage1 = prepareKit(kit);
        const offenders: string[] = [];
        for (const part of stage1.parts) {
          const root = part.bvh.getBoundingBox(new Box3());
          const rootMin = [root.min.x, root.min.y, root.min.z];
          const rootMax = [root.max.x, root.max.y, root.max.z];
          for (let c = 0; c < 3; c++) {
            const exactMin = part.aabb.min[c]!;
            const exactMax = part.aabb.max[c]!;
            const lowOk = rootMin[c]! <= exactMin && exactMin - rootMin[c]! <= BVH_BOX_TOLERANCE;
            const highOk = rootMax[c]! >= exactMax && rootMax[c]! - exactMax <= BVH_BOX_TOLERANCE;
            if (!lowOk || !highOk) {
              offenders.push(`${part.sourceNodeName} axis ${c}: root [${rootMin[c]}, ${rootMax[c]}] vs exact [${exactMin}, ${exactMax}]`);
            }
          }
        }
        expect(offenders, `${kit.name}: BVH root boxes that do not match`).toEqual([]);
      },
      TEST_TIMEOUT,
    );
  }
});
describe("Deadlock_Cage separation (Req 24.2, 24.3, 24.4)", () => {
  for (const kit of kitsIn("cage")) {
    it(
      `${kit.name}: gaps of at least ${MIN_CAGE_GAP}, no intersecting triangles, no cross-Part vertices within the weld distance`,
      () => {
        const stage1 = prepareKit(kit);
        const trees = stage1.parts.map((part) => new TriangleTree(part));
        // The default Weld_Tolerance times the Assembly's bounding-box diagonal, in normalized units.
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (const part of stage1.parts) {
          for (let c = 0; c < 3; c++) {
            lo[c] = Math.min(lo[c]!, part.aabb.min[c]!);
            hi[c] = Math.max(hi[c]!, part.aabb.max[c]!);
          }
        }
        const weldDistance = DEFAULT_SOLVER_CONFIG.weldTolerance * Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
        const problems: string[] = [];
        let pairs = 0;
        for (let i = 0; i < stage1.parts.length; i++) {
          for (let j = i + 1; j < stage1.parts.length; j++) {
            pairs++;
            const a = stage1.parts[i]!;
            const b = stage1.parts[j]!;
            const label = `${a.sourceNodeName} / ${b.sourceNodeName}`;
            const gap = minTriangleDistance(trees[i]!, trees[j]!).distance;
            if (!(gap >= MIN_CAGE_GAP)) {
              problems.push(`${label}: triangle distance ${gap} is below ${MIN_CAGE_GAP}`);
            }
            const crossing = findIntersectingTrianglePairs(trees[i]!, trees[j]!, 3);
            if (crossing.length > 0) {
              problems.push(`${label}: triangles intersect, for example ${JSON.stringify(crossing)}`);
            }
            const vertexGap = minVertexDistance(a.positions, b.positions);
            if (!(vertexGap > weldDistance)) {
              problems.push(`${label}: vertices ${vertexGap} apart, within the weld distance ${weldDistance}`);
            }
          }
        }
        expect(pairs, "a cage has at least one pair of Parts").toBeGreaterThanOrEqual(1);
        expect(problems, `${kit.name}: separation problems`).toEqual([]);
      },
      TEST_TIMEOUT,
    );
    it(
      `${kit.name}: every Part is blocked along every Candidate_Axis by the others, per the Clash_Checker (Req 24.2)`,
      () => {
        const stage1 = prepareKit(kit);
        const free: string[] = [];
        let checked = 0;
        for (const moving of stage1.parts) {
          const statics = stage1.parts.filter((part) => part.partId !== moving.partId);
          for (const [dirIndex, dir] of moving.candidateAxes.entries()) {
            checked++;
            const result = checkClashes(moving, dir, statics, stage1.config);
            if (result.count < 1) {
              free.push(`${moving.sourceNodeName} along axis ${dirIndex} [${dir.join(", ")}]`);
            }
          }
        }
        expect(checked).toBe(stage1.parts.length * 32);
        expect(free, `${kit.name}: Part and direction pairs with no collision`).toEqual([]);
      },
      TEST_TIMEOUT,
    );
  }
});
