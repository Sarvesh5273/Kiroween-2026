import { BufferAttribute, BufferGeometry, Box3 } from "three";
import { MeshBVH, SAH, type MeshBVHOptions } from "three-mesh-bvh";
import { Stage1FailureError } from "../errors";
import { at } from "../stage0/arrayAccess";
import type { BoundedPart } from "./normalizer";

/** Largest allowed excess of the BVH root box over the exact float64 AABB, per coordinate (Req 9.2). */
export const BVH_ROOT_BOX_MAX_EXCESS = 1e-6;

/**
 * `three-mesh-bvh` 0.8 supports `indirect` at run time, but its option typings omit it. The
 * extra field is added here so the options object can be passed without a cast.
 */
type BvhBuildOptions = MeshBVHOptions & { indirect: boolean };

const BVH_OPTIONS: BvhBuildOptions = {
  strategy: SAH,
  indirect: true,
  maxLeafTris: 10,
  setBoundingBox: false,
  verbose: false,
};

/**
 * Stage 1b. Builds one `MeshBVH` for `part` over its full, unsampled, normalized triangle list
 * (Req 9.1, 9.2). The geometry keeps `Float64Array` positions and a `Uint32Array` index, and the
 * BVH is `indirect`, so the index buffer is never reordered and a triangle index returned by a
 * ray query identifies the triangle at that index in `part.triangles` (Req 9.10).
 *
 * After building, the root box is checked against the exact `part.aabb`: it must contain it on
 * every coordinate and exceed it by at most {@link BVH_ROOT_BOX_MAX_EXCESS}. The library stores
 * float32 bounds, padded outward, so this normally holds. The check keeps a future library
 * change from silently breaking the guarantee.
 *
 * Throws `Stage1FailureError { partId, component: 'BVH_Builder' }`. A failure inside the
 * library is rethrown with the original error as `cause`. Nothing is swallowed (Req 9.11).
 */
export function buildPartBvh(part: BoundedPart): MeshBVH {
  let bvh: MeshBVH;
  let rootBox: Box3;
  try {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(part.positions, 3));
    geometry.setIndex(new BufferAttribute(part.triangles, 1));
    bvh = new MeshBVH(geometry, BVH_OPTIONS);
    widenRootBoxToContain(bvh, part);
    rootBox = bvh.getBoundingBox(new Box3());
  } catch (error) {
    throw new Stage1FailureError(part.partId, "BVH_Builder", error);
  }

  const problem = describeRootBoxProblem(part, rootBox);
  if (problem !== null) {
    throw new Stage1FailureError(part.partId, "BVH_Builder", new RangeError(problem));
  }
  return bvh;
}

/**
 * The library pads each triangle bound by half a float32 ulp and then rounds to float32. The
 * rounding can still land on or below the exact float64 extreme (for example
 * `0.25000000000000006` is stored as `0.25`), so the root box would not contain `part.aabb`.
 *
 * This widens only the violated root coordinates, each to the nearest float32 on the outer side
 * of the exact value, which is at most one float32 ulp (about `6e-8` in normalized units). A
 * larger root box only makes the first ray-versus-box culling test more conservative. The
 * caller still runs {@link describeRootBoxProblem}, so a box that is wrong in any other way
 * fails loudly.
 */
function widenRootBoxToContain(bvh: MeshBVH, part: BoundedPart): void {
  let visited = false;
  bvh.traverse((depth, _isLeaf, boundingData) => {
    if (depth !== 0) {
      return true;
    }
    // Typed as `ArrayBuffer` by the library, but it is a live `Float32Array(6)` view of the
    // root node: `[minX, minY, minZ, maxX, maxY, maxZ]`.
    const bounds: unknown = boundingData;
    if (!(bounds instanceof Float32Array) || bounds.length !== 6) {
      throw new TypeError("three-mesh-bvh passed an unexpected root bounds view");
    }
    for (let k = 0; k < 3; k++) {
      const exactMin = at(part.aabb.min, k);
      const exactMax = at(part.aabb.max, k);
      if (at(bounds, k) > exactMin) {
        bounds[k] = float32AtOrBelow(exactMin);
      }
      if (at(bounds, 3 + k) < exactMax) {
        bounds[3 + k] = float32AtOrAbove(exactMax);
      }
    }
    visited = true;
    return true;
  });
  if (!visited) {
    throw new RangeError("the BVH has no root node");
  }
}

/** Largest float32 that is `<= x`. */
function float32AtOrBelow(x: number): number {
  const rounded = Math.fround(x);
  return rounded <= x ? rounded : stepFloat32(rounded, -1);
}

/** Smallest float32 that is `>= x`. */
function float32AtOrAbove(x: number): number {
  const rounded = Math.fround(x);
  return rounded >= x ? rounded : stepFloat32(rounded, 1);
}

/** The adjacent float32 above (`direction = 1`) or below (`direction = -1`) a finite float32. */
function stepFloat32(value: number, direction: 1 | -1): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  const bits = view.getUint32(0);
  if (value === 0) {
    // Smallest subnormal with the requested sign.
    view.setUint32(0, direction === 1 ? 1 : 0x80000001);
    return view.getFloat32(0);
  }
  // Moving away from zero increases the magnitude bits, moving toward zero decreases them.
  const awayFromZero = (value > 0) === (direction === 1);
  view.setUint32(0, awayFromZero ? bits + 1 : bits - 1);
  return view.getFloat32(0);
}

/** Returns a description of the first violated root-box condition, or `null` when both hold. */
export function describeRootBoxProblem(part: BoundedPart, rootBox: Box3): string | null {
  const rootMin = [rootBox.min.x, rootBox.min.y, rootBox.min.z];
  const rootMax = [rootBox.max.x, rootBox.max.y, rootBox.max.z];
  const axisNames = ["x", "y", "z"];
  for (let k = 0; k < 3; k++) {
    const exactMin = at(part.aabb.min, k);
    const exactMax = at(part.aabb.max, k);
    const lo = at(rootMin, k);
    const hi = at(rootMax, k);
    const name = axisNames[k] ?? String(k);
    if (!(lo <= exactMin)) {
      return `BVH root min ${name} ${lo} is above the exact AABB min ${exactMin}`;
    }
    if (!(hi >= exactMax)) {
      return `BVH root max ${name} ${hi} is below the exact AABB max ${exactMax}`;
    }
    if (!(exactMin - lo <= BVH_ROOT_BOX_MAX_EXCESS)) {
      return `BVH root min ${name} ${lo} is more than ${BVH_ROOT_BOX_MAX_EXCESS} below the exact AABB min ${exactMin}`;
    }
    if (!(hi - exactMax <= BVH_ROOT_BOX_MAX_EXCESS)) {
      return `BVH root max ${name} ${hi} is more than ${BVH_ROOT_BOX_MAX_EXCESS} above the exact AABB max ${exactMax}`;
    }
  }
  return null;
}
