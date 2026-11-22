import { validateConfig, type SolverConfig } from "../config";
import { AssemblyNotNormalizedError, InvalidSolverConfigError } from "../errors";
import { unionAabb, type Aabb } from "../math/aabb";
import { distance, normalize, sub } from "../math/vec3";
import { checkClashes } from "../oracle/clashChecker";
import type { NaiveBaselineResult, NormalizedPart, Stage1Result, Vec3 } from "../types";

/** Largest allowed deviation of the Assembly's `maxExtent` from 1 (Req 21.7). */
const NORMALIZED_EXTENT_TOLERANCE = 1e-6;
/** A Part whose OBB center is this close to the Assembly centroid moves along +Y (Req 21.3). */
const CENTROID_COINCIDENCE = 1e-9;
const PLUS_Y: Vec3 = [0, 1, 0];

function comparePartIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Largest side of the union of the Parts' exact AABBs. An empty Assembly measures 0. */
function measureMaxExtent(parts: readonly NormalizedPart[]): number {
  let box: Aabb | null = null;
  for (const part of parts) {
    const own: Aabb = { min: [part.aabb.min[0], part.aabb.min[1], part.aabb.min[2]], max: [part.aabb.max[0], part.aabb.max[1], part.aabb.max[2]] };
    box = box === null ? own : unionAabb(box, own);
  }
  if (box === null) {
    return 0;
  }
  return Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
}

/**
 * Naive radial explosion baseline (Req 21): what happens if every Part simply moves straight
 * away from the Assembly centroid, with all other Parts held in place.
 *
 * 1. The config is validated, and `maxExtent` is measured from the Parts' exact AABBs. A value
 *    that differs from 1 by more than `1e-6` throws `AssemblyNotNormalizedError` before any ray
 *    is cast.
 * 2. The Assembly centroid is the arithmetic mean of the Parts' OBB centers. A Part's direction
 *    is the unit vector from the centroid to its OBB center, or `(0, 1, 0)` when that center is
 *    within `1e-9` of the centroid.
 * 3. For each Part, in ascending Part_ID order, `checkClashes` runs that direction against every
 *    other Part, using only `microShrink`, `clearanceEpsilon` and `tau` of the given config.
 *
 * Each clash is one colliding ray. For a ray cast by the moving Part, `obstructingPartId` and
 * `obstructingTriangle` come from the hit and `movingTriangle` from the ray's source. For a ray
 * cast by the obstructing Part it is the other way round. Clashes are sorted by
 * `(obstructingPartId, movingTriangle, obstructingTriangle)`. `perPart` lists every Part,
 * including those with a count of 0, and `totalClashes` is the sum of the counts.
 *
 * The input is only read. The result is plain data and is the same for the same input.
 *
 * @param config Missing fields take their defaults. It is not taken from `assembly.config`.
 * @throws InvalidSolverConfigError when `config` fails validation.
 * @throws AssemblyNotNormalizedError when `maxExtent` is not 1 within `1e-6`.
 */
export function computeNaiveRadialClashes(assembly: Stage1Result, config?: SolverConfig): NaiveBaselineResult {
  const validation = validateConfig(config);
  if (!validation.ok) {
    throw new InvalidSolverConfigError(validation.error);
  }
  const measuredMaxExtent = measureMaxExtent(assembly.parts);
  if (!(Math.abs(measuredMaxExtent - 1) <= NORMALIZED_EXTENT_TOLERANCE)) {
    throw new AssemblyNotNormalizedError(measuredMaxExtent);
  }

  const parts = assembly.parts.slice().sort((a, b) => comparePartIds(a.partId, b.partId));
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (const part of parts) {
    const [cx, cy, cz] = part.frame.obb.center;
    sumX += cx;
    sumY += cy;
    sumZ += cz;
  }
  const centroid: Vec3 = [sumX / parts.length, sumY / parts.length, sumZ / parts.length];

  const perPart: NaiveBaselineResult["perPart"] = [];
  let totalClashes = 0;
  for (const part of parts) {
    const offset = sub(part.frame.obb.center, centroid);
    const direction: Vec3 = distance(part.frame.obb.center, centroid) <= CENTROID_COINCIDENCE ? [PLUS_Y[0], PLUS_Y[1], PLUS_Y[2]] : normalize(offset);
    const others = parts.filter((other) => other.partId !== part.partId);
    const result = checkClashes(part, direction, others, validation.config);
    const clashes: NaiveBaselineResult["perPart"][number]["clashes"] = result.collisions.map((collision) =>
      collision.originSide === "moving"
        ? {
            obstructingPartId: collision.hitPartId,
            movingTriangle: collision.originTriangle,
            obstructingTriangle: collision.hitTriangle,
          }
        : {
            obstructingPartId: collision.originPartId,
            movingTriangle: collision.hitTriangle,
            obstructingTriangle: collision.originTriangle,
          },
    );
    clashes.sort(
      (a, b) =>
        comparePartIds(a.obstructingPartId, b.obstructingPartId) ||
        a.movingTriangle - b.movingTriangle ||
        a.obstructingTriangle - b.obstructingTriangle,
    );
    perPart.push({ partId: part.partId, direction, clashCount: result.count, clashes });
    totalClashes += result.count;
  }
  return { perPart, totalClashes };
}
