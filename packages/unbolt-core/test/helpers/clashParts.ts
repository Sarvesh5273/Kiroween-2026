import { BufferAttribute, BufferGeometry } from "three";
import { MeshBVH, SAH, type MeshBVHOptions } from "three-mesh-bvh";
import type { ClashPart, Vec3 } from "../../src/types";

/** Same BVH settings as Stage 1, so a hand-built Part answers queries like a real one. */
const BVH_OPTIONS: MeshBVHOptions & { indirect: boolean } = {
  strategy: SAH,
  indirect: true,
  maxLeafTris: 10,
  setBoundingBox: false,
  verbose: false,
};

function coordinateKey(x: number, y: number, z: number): string {
  // `x + 0` maps -0 to +0, so equal coordinates always give equal keys.
  return `${x + 0},${y + 0},${z + 0}`;
}

/**
 * Builds a `ClashPart` from raw arrays. Vertices with exactly equal coordinates share a weld
 * cluster (clusters are numbered by first appearance, and the representative is the smallest
 * member), so a test can model a welded vertex by repeating a position under another index.
 * The Part is not required to be closed, outward wound or non-degenerate: the oracle must cope
 * with soups, zero-area triangles and double-sided sheets.
 */
export function makeClashPart(partId: string, positions: readonly number[], triangles: readonly number[]): ClashPart {
  if (positions.length === 0 || positions.length % 3 !== 0 || triangles.length === 0 || triangles.length % 3 !== 0) {
    throw new RangeError("makeClashPart needs whole xyz vertices and at least one triangle");
  }
  const positionArray = Float64Array.from(positions);
  const triangleArray = Uint32Array.from(triangles);
  const vertexCount = positions.length / 3;

  const clusterByKey = new Map<string, number>();
  const representatives: number[] = [];
  const weldIds = new Uint32Array(vertexCount);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < vertexCount; v++) {
    const x = positionArray[3 * v] ?? 0;
    const y = positionArray[3 * v + 1] ?? 0;
    const z = positionArray[3 * v + 2] ?? 0;
    const key = coordinateKey(x, y, z);
    let cluster = clusterByKey.get(key);
    if (cluster === undefined) {
      cluster = representatives.length;
      clusterByKey.set(key, cluster);
      representatives.push(v);
    }
    weldIds[v] = cluster;
    const point = [x, y, z];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] ?? Infinity, point[k] ?? 0);
      max[k] = Math.max(max[k] ?? -Infinity, point[k] ?? 0);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positionArray, 3));
  geometry.setIndex(new BufferAttribute(triangleArray, 1));
  const bvh = new MeshBVH(geometry, BVH_OPTIONS);

  return {
    partId,
    positions: positionArray,
    triangles: triangleArray,
    weldIds,
    weldRepresentatives: Uint32Array.from(representatives),
    aabb: { min, max },
    bvh,
  };
}
