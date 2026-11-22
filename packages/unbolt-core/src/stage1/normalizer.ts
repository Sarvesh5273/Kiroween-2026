import { buildInvalidGeometryError, formatNodePath } from "../errors";
import { aabbFromFlatPoints } from "../math/aabb";
import { at } from "../stage0/arrayAccess";
import type { InvalidGeometryError, NodePath, NormalizationTransform, Part, Vec3 } from "../types";

/** A Part in normalized coordinates, with its exact float64 axis-aligned bounding box. */
export interface BoundedPart extends Part {
  aabb: { min: Vec3; max: Vec3 };
}

export type NormalizerResult =
  | { ok: true; parts: BoundedPart[]; normalization: NormalizationTransform }
  | { ok: false; error: InvalidGeometryError };

/**
 * Stage 1a. Scales every Part by one positive factor and then translates by one vector, so the
 * Assembly AABB has `maxExtent = 1.0` and is centered at the origin (Req 8.1, 8.2).
 *
 * Each coordinate is computed as `q = p * scale + translation[k]`, in that order, into new
 * `Float64Array`s. The input Parts and the caller's hierarchy are not modified (Req 8.8). Areas
 * scale by `scale²`. Face normals do not change under a uniform positive scale plus translation,
 * so the same arrays are reused.
 *
 * Errors are returned as values (Req 8.6, 8.7):
 * - `non-finite`: some world coordinate is `NaN` or infinite. Lists the source node paths.
 * - `zero-extent`: `maxExtent` is 0.
 * - `non-finite-scale`: `1 / maxExtent` is not finite and positive (for example a subnormal
 *   extent), or a normalized value is not finite.
 *
 * The inverse of the transform is `p = (q - translation[k]) / scale`.
 */
export function normalizeParts(parts: readonly Part[]): NormalizerResult {
  const nonFinitePaths = findNonFiniteNodePaths(parts);
  if (nonFinitePaths.length > 0) {
    return { ok: false, error: buildInvalidGeometryError("non-finite", nonFinitePaths) };
  }

  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const part of parts) {
    const box = aabbFromFlatPoints(part.positions);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(at(min, k), at(box.min, k));
      max[k] = Math.max(at(max, k), at(box.max, k));
    }
  }

  const maxExtent = Math.max(at(max, 0) - at(min, 0), at(max, 1) - at(min, 1), at(max, 2) - at(min, 2));
  if (maxExtent === 0) {
    return { ok: false, error: buildInvalidGeometryError("zero-extent", []) };
  }
  const scale = 1 / maxExtent;
  if (!Number.isFinite(maxExtent) || !Number.isFinite(scale) || !(scale > 0)) {
    return { ok: false, error: buildInvalidGeometryError("non-finite-scale", []) };
  }

  // Half-sums avoid overflow of `min + max` for very large coordinates.
  const center = [0, 1, 2].map((k) => at(min, k) / 2 + at(max, k) / 2);
  const translation: Vec3 = [
    0 - at(center, 0) * scale,
    0 - at(center, 1) * scale,
    0 - at(center, 2) * scale,
  ];
  if (!translation.every((component) => Number.isFinite(component))) {
    return { ok: false, error: buildInvalidGeometryError("non-finite-scale", []) };
  }

  const normalized: BoundedPart[] = [];
  for (const part of parts) {
    const positions = new Float64Array(part.positions.length);
    for (let i = 0; i < positions.length; i++) {
      const value = at(part.positions, i) * scale + at(translation, i % 3);
      if (!Number.isFinite(value)) {
        return { ok: false, error: buildInvalidGeometryError("non-finite-scale", []) };
      }
      positions[i] = value;
    }
    const triangleAreas = new Float64Array(part.triangleAreas.length);
    for (let i = 0; i < triangleAreas.length; i++) {
      triangleAreas[i] = at(part.triangleAreas, i) * scale * scale;
    }
    normalized.push({
      ...part,
      sourceNodePath: part.sourceNodePath.slice(),
      positions,
      triangleAreas,
      aabb: aabbFromFlatPoints(positions),
    });
  }

  return { ok: true, parts: normalized, normalization: { scale, translation } };
}

/** Distinct source node paths of Parts that hold a non-finite coordinate, in Part order. */
function findNonFiniteNodePaths(parts: readonly Part[]): NodePath[] {
  const seen = new Set<string>();
  const paths: NodePath[] = [];
  for (const part of parts) {
    let finite = true;
    for (let i = 0; i < part.positions.length; i++) {
      if (!Number.isFinite(at(part.positions, i))) {
        finite = false;
        break;
      }
    }
    const key = formatNodePath(part.sourceNodePath);
    if (!finite && !seen.has(key)) {
      seen.add(key);
      paths.push(part.sourceNodePath.slice());
    }
  }
  return paths;
}
