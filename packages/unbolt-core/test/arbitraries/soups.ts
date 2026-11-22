import fc from "fast-check";
import type { ClashPart, Vec3 } from "../../src/types";
import { CANONICAL_DIRECTIONS } from "../../src/stage1/candidateAxes";
import { makeClashPart } from "../helpers/clashParts";

/**
 * Small triangle soups for the Clash_Checker reference property (Property 23). They need not be
 * closed or outward wound, because the oracle must cope with any mesh. The generator adds the
 * cases that closed solids rarely produce:
 *  - knife-edge vertices: a reversed copy of a triangle, so every shared vertex has an
 *    area-weighted normal sum of exactly 0 and takes the largest-incident-triangle fallback;
 *  - zero-area triangles, either with a repeated vertex index or with exactly collinear corners;
 *  - weld clusters of several vertex indices at one position;
 *  - Parts that sit far from the others, so the swept-box cull has something to skip.
 */

export interface SoupSpec {
  positions: number[];
  triangles: number[];
  /** A reversed copy of triangle 0 was added. */
  knifeEdge: boolean;
  /** A triangle with repeated indices or exactly collinear corners was added. */
  zeroArea: boolean;
  /** Vertex indices that repeat another vertex position. */
  duplicateVertices: number;
}

/**
 * Coordinates on a fine integer grid rather than `fc.double`, which is biased toward extreme and
 * subnormal values and would collapse most soups to a point.
 */
const coordinate = fc.integer({ min: -1000, max: 1000 }).map((steps) => steps / 1000);
const point = fc.tuple(coordinate, coordinate, coordinate);
/** Multiples of 1/64, so adding the offset keeps exactly collinear corners exactly collinear. */
const nearOffset = fc.integer({ min: -32, max: 32 }).map((steps) => steps / 64);
/** Now and then a Part sits far away, so the swept-box cull has something to skip. */
const farOffset = fc.integer({ min: -192, max: 192 }).map((steps) => steps / 64);
const offsetCoordinate = fc.oneof({ weight: 5, arbitrary: nearOffset }, { weight: 1, arbitrary: farOffset });

export const soupSpecArbitrary: fc.Arbitrary<SoupSpec> = fc
  .record({
    pool: fc.array(point, { minLength: 3, maxLength: 7 }),
    duplicatePicks: fc.array(fc.nat(100), { minLength: 0, maxLength: 2 }),
    trianglePicks: fc.array(fc.tuple(fc.nat(100), fc.nat(100), fc.nat(100)), { minLength: 1, maxLength: 6 }),
    knifeEdge: fc.boolean(),
    reverseViaDuplicates: fc.boolean(),
    zeroArea: fc.constantFrom("none", "repeat", "collinear"),
    collinear: fc.record({
      start: fc.tuple(fc.integer({ min: -16, max: 16 }), fc.integer({ min: -16, max: 16 }), fc.integer({ min: -16, max: 16 })),
      step: fc.tuple(fc.integer({ min: -8, max: 8 }), fc.integer({ min: -8, max: 8 }), fc.integer({ min: -8, max: 8 })),
    }),
    offset: fc.tuple(offsetCoordinate, offsetCoordinate, offsetCoordinate),
  })
  .map((draw) => {
    const positions: number[] = [];
    for (const p of draw.pool) {
      positions.push(p[0], p[1], p[2]);
    }
    // Extra vertex indices at the position of a pool vertex: one weld cluster, several indices.
    const duplicateOf = new Map<number, number>();
    for (const pick of draw.duplicatePicks) {
      const source = pick % draw.pool.length;
      if (!duplicateOf.has(source)) {
        duplicateOf.set(source, positions.length / 3);
        const p = draw.pool[source] ?? [0, 0, 0];
        positions.push(p[0], p[1], p[2]);
      }
    }
    const vertexCount = positions.length / 3;
    const poolIndexOf = (vertex: number): number => {
      for (const [source, duplicate] of duplicateOf) {
        if (duplicate === vertex) {
          return source;
        }
      }
      return vertex;
    };
    // Two triangles with the same corners in the same cyclic order are one surface twice. A ray
    // meets both at the same distance up to rounding, and the specification does not say which
    // one wins, so such pairs are dropped. A reversed copy is kept (the knife-edge case): only
    // one face of it can oppose a ray, so it never ties.
    const triangles: number[] = [];
    const orientations = new Set<string>();
    for (const [a, b, c] of draw.trianglePicks) {
      const corners = [a % vertexCount, b % vertexCount, c % vertexCount];
      const sources = corners.map(poolIndexOf);
      if (new Set(sources).size === 3) {
        const first = sources.indexOf(Math.min(...sources));
        const key = [0, 1, 2].map((k) => sources[(first + k) % 3]).join(",");
        if (orientations.has(key)) {
          continue;
        }
        orientations.add(key);
      }
      triangles.push(...corners);
    }
    if (draw.knifeEdge) {
      const [a = 0, b = 0, c = 0] = triangles;
      const via = (index: number): number => (draw.reverseViaDuplicates ? (duplicateOf.get(index) ?? index) : index);
      triangles.push(via(a), via(c), via(b));
    }
    let zeroArea = false;
    if (draw.zeroArea === "repeat") {
      zeroArea = true;
      triangles.push(0, 0, 1);
    } else if (draw.zeroArea === "collinear") {
      zeroArea = true;
      // Multiples of 1/64: the corners, and so their cross product, are computed exactly.
      const base = positions.length / 3;
      for (let k = 0; k < 3; k++) {
        const scale = k; // 0, 1, 2 steps from the start
        positions.push(
          (draw.collinear.start[0] + scale * draw.collinear.step[0]) / 64,
          (draw.collinear.start[1] + scale * draw.collinear.step[1]) / 64,
          (draw.collinear.start[2] + scale * draw.collinear.step[2]) / 64,
        );
      }
      triangles.push(base, base + 1, base + 2);
    }
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (positions[i] ?? 0) + draw.offset[0];
      positions[i + 1] = (positions[i + 1] ?? 0) + draw.offset[1];
      positions[i + 2] = (positions[i + 2] ?? 0) + draw.offset[2];
    }
    return { positions, triangles, knifeEdge: draw.knifeEdge, zeroArea, duplicateVertices: duplicateOf.size } satisfies SoupSpec;
  });

export function soupPart(partId: string, spec: SoupSpec): ClashPart {
  return makeClashPart(partId, spec.positions, spec.triangles);
}

/** A unit direction: a random one, or one of the 26 canonical directions. */
export const directionArbitrary: fc.Arbitrary<Vec3> = fc.oneof(
  fc
    .tuple(
      fc.integer({ min: -100, max: 100 }),
      fc.integer({ min: -100, max: 100 }),
      fc.integer({ min: -100, max: 100 }),
    )
    .filter(([x, y, z]) => Math.hypot(x, y, z) >= 10)
    .map(([x, y, z]): Vec3 => {
      const norm = Math.hypot(x, y, z);
      return [x / norm, y / norm, z / norm];
    }),
  fc.constantFrom(...CANONICAL_DIRECTIONS).map((d): Vec3 => [d[0], d[1], d[2]]),
);
