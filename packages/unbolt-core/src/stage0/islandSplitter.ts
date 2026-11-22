import type { MeshRecord, Part } from "../types";
import { at } from "./arrayAccess";
import { writeFaceNormal } from "./triangleGeometry";
import { UnionFind } from "./unionFind";
import { weldVertices } from "./weld";

/** Corner order of a triangle after the winding flip `(a, b, c) -> (a, c, b)`. */
const FLIPPED_CORNER_SOURCE: readonly [number, number, number] = [0, 2, 1];

/**
 * Splits every mesh node into Parts (Req 5). Vertices are welded within each node only, so
 * triangles from different nodes never share a Part (Req 5.1). The weld radius is
 * `weldTolerance` times the world AABB diagonal of every triangle-referenced vertex in the
 * Assembly (Req 5.2).
 *
 * Parts come out in mesh order, then island order. Island indices start at 0 and follow the
 * smallest source triangle index of each island, so Part_IDs do not depend on Union-Find
 * internals (Req 5.8).
 */
export function splitIslands(meshes: readonly MeshRecord[], weldTolerance: number): Part[] {
  const radius = weldTolerance * assemblyDiagonal(meshes);
  const parts: Part[] = [];
  for (const mesh of meshes) {
    for (const part of splitMeshIntoParts(mesh, radius)) {
      parts.push(part);
    }
  }
  return parts;
}

/** Length of the world-space AABB diagonal over every vertex referenced by a triangle. */
function assemblyDiagonal(meshes: readonly MeshRecord[]): number {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let any = false;
  for (const mesh of meshes) {
    for (const vertex of mesh.triangles) {
      any = true;
      for (let k = 0; k < 3; k++) {
        const value = at(mesh.positions, 3 * vertex + k);
        min[k] = Math.min(at(min, k), value);
        max[k] = Math.max(at(max, k), value);
      }
    }
  }
  if (!any) {
    return 0;
  }
  return Math.hypot(at(max, 0) - at(min, 0), at(max, 1) - at(min, 1), at(max, 2) - at(min, 2));
}

function splitMeshIntoParts(mesh: MeshRecord, radius: number): Part[] {
  const triangleCount = mesh.triangles.length / 3;
  if (triangleCount === 0) {
    return [];
  }
  const vertexCount = mesh.positions.length / 3;
  const referenced = sortedUnique(mesh.triangles);

  // `weld` holds weld clusters only. `islands` also has the triangle corner unions, so it
  // defines the Islands.
  const weld = new UnionFind(vertexCount);
  weldVertices(mesh.positions, referenced, radius, weld);

  const islands = new UnionFind(vertexCount);
  for (const vertex of referenced) {
    islands.union(vertex, weld.representative(vertex));
  }
  for (let t = 0; t < triangleCount; t++) {
    const a = at(mesh.triangles, 3 * t);
    islands.union(a, at(mesh.triangles, 3 * t + 1));
    islands.union(a, at(mesh.triangles, 3 * t + 2));
  }

  // Triangles are visited in ascending order, so each Island is numbered by its smallest
  // triangle index (Req 5.8).
  const islandByRoot = new Map<number, number>();
  const groups: number[][] = [];
  for (let t = 0; t < triangleCount; t++) {
    const root = islands.find(at(mesh.triangles, 3 * t));
    let islandIndex = islandByRoot.get(root);
    if (islandIndex === undefined) {
      islandIndex = groups.length;
      islandByRoot.set(root, islandIndex);
      groups.push([]);
    }
    const group = groups[islandIndex];
    if (group === undefined) {
      throw new RangeError(`island ${islandIndex} has no triangle list`);
    }
    group.push(t);
  }

  return groups.map((triangleList, islandIndex) => buildPart(mesh, islandIndex, triangleList, weld));
}

function buildPart(mesh: MeshRecord, islandIndex: number, triangleList: number[], weld: UnionFind): Part {
  const count = triangleList.length;
  const flipped = mesh.windingFlipped;

  // Source corners of each triangle, in source order.
  const sourceCorners = new Uint32Array(3 * count);
  for (let i = 0; i < count; i++) {
    const t = at(triangleList, i);
    for (let k = 0; k < 3; k++) {
      sourceCorners[3 * i + k] = at(mesh.triangles, 3 * t + k);
    }
  }

  // Part-local vertices are the distinct source vertices, in ascending source index.
  const localVertices = sortedUnique(sourceCorners);
  const localCount = localVertices.length;
  const positions = new Float64Array(3 * localCount);
  for (let j = 0; j < localCount; j++) {
    const source = at(localVertices, j);
    for (let k = 0; k < 3; k++) {
      positions[3 * j + k] = at(mesh.positions, 3 * source + k);
    }
  }

  // Outward winding: the Part triangle keeps counter-clockwise order in world space.
  const triangles = new Uint32Array(3 * count);
  for (let i = 0; i < count; i++) {
    const c0 = localIndexOf(localVertices, at(sourceCorners, 3 * i));
    const c1 = localIndexOf(localVertices, at(sourceCorners, 3 * i + 1));
    const c2 = localIndexOf(localVertices, at(sourceCorners, 3 * i + 2));
    triangles[3 * i] = c0;
    triangles[3 * i + 1] = flipped ? c2 : c1;
    triangles[3 * i + 2] = flipped ? c1 : c2;
  }

  const faceNormals = new Float64Array(3 * count);
  const triangleAreas = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    triangleAreas[i] = writeFaceNormal(
      positions,
      at(triangles, 3 * i),
      at(triangles, 3 * i + 1),
      at(triangles, 3 * i + 2),
      faceNormals,
      3 * i,
    );
  }

  // Corner normals follow the corner order of the Part triangle.
  const cornerNormals = new Float64Array(9 * count);
  for (let i = 0; i < count; i++) {
    const t = at(triangleList, i);
    for (let k = 0; k < 3; k++) {
      const sourceK = flipped ? FLIPPED_CORNER_SOURCE[k] : k;
      if (sourceK === undefined) {
        throw new RangeError(`corner ${k} has no source corner`);
      }
      for (let j = 0; j < 3; j++) {
        cornerNormals[9 * i + 3 * k + j] = at(mesh.normals, 9 * t + 3 * sourceK + j);
      }
    }
  }

  // Weld clusters are numbered by their first local vertex. Clusters never span Parts, because
  // welded vertices are always unioned into the same Island. The representative is the local
  // index of the cluster's smallest member, which is also its smallest source index.
  const clusterByRoot = new Map<number, number>();
  const representatives: number[] = [];
  const weldIds = new Uint32Array(localCount);
  for (let j = 0; j < localCount; j++) {
    const root = weld.representative(at(localVertices, j));
    let cluster = clusterByRoot.get(root);
    if (cluster === undefined) {
      cluster = representatives.length;
      clusterByRoot.set(root, cluster);
      representatives.push(j);
    }
    weldIds[j] = cluster;
  }

  return {
    partId: `/${mesh.nodePath.join("/")}#${islandIndex}`,
    sourceNodePath: mesh.nodePath.slice(),
    sourceNodeName: mesh.nodeName,
    islandIndex,
    sourceTriangleIndices: Uint32Array.from(triangleList),
    positions,
    triangles,
    weldIds,
    weldRepresentatives: Uint32Array.from(representatives),
    faceNormals,
    triangleAreas,
    cornerNormals,
  };
}

/** Sorted, distinct copy of `values`. */
function sortedUnique(values: Uint32Array): Uint32Array {
  const sorted = Uint32Array.from(values).sort();
  const unique: number[] = [];
  for (const value of sorted) {
    if (unique.length === 0 || unique[unique.length - 1] !== value) {
      unique.push(value);
    }
  }
  return Uint32Array.from(unique);
}

/** Position of `value` in the ascending list `sorted`. Throws if it is missing. */
function localIndexOf(sorted: Uint32Array, value: number): number {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const candidate = at(sorted, mid);
    if (candidate === value) {
      return mid;
    }
    if (candidate < value) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  throw new RangeError(`source vertex ${value} is missing from the Part vertex list`);
}
