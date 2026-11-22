/**
 * Brute-force reference for the Clash_Checker (Property 23).
 *
 * It enumerates welded vertices and positive-area centroids on its own, computes every ray origin
 * independently, and intersects each ray with every triangle of its target Parts without a BVH
 * and without any box culling. It imports only types from `src/`.
 */
import type { ClashPart, ClashResult, Vec3 } from "../../../src/types";
import { castAllHitsBruteForce } from "./raycast";

export interface ReferenceConfig {
  microShrink: number;
  clearanceEpsilon: number;
  tau: number;
}

interface Face {
  /** Unit outward normal, or `[0, 0, 0]` for a zero-area triangle. */
  normal: Vec3;
  area: number;
}

interface Source {
  kind: "vertex" | "centroid";
  index: number;
  triangle: number;
  point: Vec3;
  normal: Vec3;
}

function vertexAt(part: ClashPart, index: number): Vec3 {
  return [part.positions[3 * index] ?? 0, part.positions[3 * index + 1] ?? 0, part.positions[3 * index + 2] ?? 0];
}

function faceOf(part: ClashPart, t: number): Face {
  const a = vertexAt(part, part.triangles[3 * t] ?? 0);
  const b = vertexAt(part, part.triangles[3 * t + 1] ?? 0);
  const c = vertexAt(part, part.triangles[3 * t + 2] ?? 0);
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  // Same rounding as the specification's area: the square root of the summed squares. `Math.hypot`
  // can differ by 1 ulp, which would break ties between mathematically equal areas differently.
  const doubled = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
  if (!(doubled > 0)) {
    return { normal: [0, 0, 0], area: 0 };
  }
  return { normal: [n[0] / doubled, n[1] / doubled, n[2] / doubled], area: doubled / 2 };
}

/** Unit outward face normals of every triangle, 3 numbers each, for tests that filter hits themselves. */
export function referenceFaceNormals(part: ClashPart): Float64Array {
  const cached = faceNormalCache.get(part);
  if (cached !== undefined) {
    return cached;
  }
  const count = part.triangles.length / 3;
  const normals = new Float64Array(3 * count);
  for (let t = 0; t < count; t++) {
    normals.set(faceOf(part, t).normal, 3 * t);
  }
  faceNormalCache.set(part, normals);
  return normals;
}

/** Face normals are recomputed from winding once per Part object, because every ray reads them. */
const faceNormalCache = new WeakMap<ClashPart, Float64Array>();

function raySources(part: ClashPart): Source[] {
  const triangleCount = part.triangles.length / 3;
  const faces = Array.from({ length: triangleCount }, (_, t) => faceOf(part, t));
  const sources: Source[] = [];

  // Welded vertices: one source per distinct weld cluster.
  const clusterIds = Array.from(new Set(Array.from(part.weldIds)));
  for (const cluster of clusterIds) {
    const members: number[] = [];
    part.weldIds.forEach((id, vertex) => {
      if (id === cluster) {
        members.push(vertex);
      }
    });
    const representative = Math.min(...members);
    const incident: number[] = [];
    for (let t = 0; t < triangleCount; t++) {
      const corners = [part.triangles[3 * t] ?? 0, part.triangles[3 * t + 1] ?? 0, part.triangles[3 * t + 2] ?? 0];
      if (corners.some((corner) => part.weldIds[corner] === cluster)) {
        incident.push(t);
      }
    }
    const positive = incident.filter((t) => (faces[t]?.area ?? 0) > 0);
    if (positive.length === 0) {
      continue;
    }
    let largest = positive[0] ?? 0;
    for (const t of positive) {
      if ((faces[t]?.area ?? 0) > (faces[largest]?.area ?? 0)) {
        largest = t;
      }
    }
    const sum: Vec3 = [0, 0, 0];
    for (const t of positive) {
      const face = faces[t];
      if (face === undefined) {
        continue;
      }
      for (let k = 0; k < 3; k++) {
        sum[k] = (sum[k] ?? 0) + face.area * (face.normal[k] ?? 0);
      }
    }
    const sumLength = Math.hypot(sum[0] ?? 0, sum[1] ?? 0, sum[2] ?? 0);
    const normal: Vec3 =
      sumLength <= 1e-12 ? [...(faces[largest]?.normal ?? [0, 0, 0])] as Vec3 : [(sum[0] ?? 0) / sumLength, (sum[1] ?? 0) / sumLength, (sum[2] ?? 0) / sumLength];
    sources.push({ kind: "vertex", index: representative, triangle: largest, point: vertexAt(part, representative), normal });
  }

  // Centroids of triangles with positive area.
  for (let t = 0; t < triangleCount; t++) {
    const face = faces[t];
    if (face === undefined || !(face.area > 0)) {
      continue;
    }
    const a = vertexAt(part, part.triangles[3 * t] ?? 0);
    const b = vertexAt(part, part.triangles[3 * t + 1] ?? 0);
    const c = vertexAt(part, part.triangles[3 * t + 2] ?? 0);
    sources.push({
      kind: "centroid",
      index: t,
      triangle: t,
      point: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
      normal: face.normal,
    });
  }
  return sources;
}

interface Survivor {
  partId: string;
  triangle: number;
  distance: number;
}

/** Casts one ray at every target by brute force and returns the nearest hit that is not discarded. */
function nearestSurvivor(origin: Vec3, dir: Vec3, targets: readonly ClashPart[], config: ReferenceConfig): Survivor | null {
  let best: Survivor | null = null;
  for (const target of targets) {
    const faces = referenceFaceNormals(target);
    for (const hit of castAllHitsBruteForce(origin, dir, target.positions, target.triangles)) {
      if (hit.distance < config.clearanceEpsilon) {
        continue;
      }
      const dot =
        (faces[3 * hit.triangle] ?? 0) * dir[0] + (faces[3 * hit.triangle + 1] ?? 0) * dir[1] + (faces[3 * hit.triangle + 2] ?? 0) * dir[2];
      if (dot >= -config.tau) {
        continue;
      }
      const candidate: Survivor = { partId: target.partId, triangle: hit.triangle, distance: hit.distance };
      if (best === null || isNearer(candidate, best)) {
        best = candidate;
      }
    }
  }
  return best;
}

function isNearer(a: Survivor, b: Survivor): boolean {
  if (a.distance !== b.distance) {
    return a.distance < b.distance;
  }
  if (a.partId !== b.partId) {
    return a.partId < b.partId;
  }
  return a.triangle < b.triangle;
}

function ascending(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((x, y) => x - y);
}

/** The Clash_Checker's specification, evaluated by brute force. */
export function referenceClash(
  moving: ClashPart,
  dir: Vec3,
  statics: readonly ClashPart[],
  config: ReferenceConfig,
): ClashResult {
  const negated: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const collisions: ClashResult["collisions"] = [];
  const movingTriangles: number[] = [];
  const staticTriangles = new Map<string, number[]>();
  const noteStatic = (partId: string, triangle: number): void => {
    staticTriangles.set(partId, [...(staticTriangles.get(partId) ?? []), triangle]);
  };

  for (const source of raySources(moving)) {
    const origin: Vec3 = [
      source.point[0] - config.microShrink * source.normal[0],
      source.point[1] - config.microShrink * source.normal[1],
      source.point[2] - config.microShrink * source.normal[2],
    ];
    const hit = nearestSurvivor(origin, dir, statics, config);
    if (hit === null) {
      continue;
    }
    collisions.push({
      originSide: "moving",
      originPartId: moving.partId,
      originKind: source.kind,
      originIndex: source.index,
      originTriangle: source.triangle,
      hitPartId: hit.partId,
      hitTriangle: hit.triangle,
      distance: hit.distance,
    });
    movingTriangles.push(source.triangle);
    noteStatic(hit.partId, hit.triangle);
  }

  for (const part of statics) {
    for (const source of raySources(part)) {
      const origin: Vec3 = [
        source.point[0] - config.microShrink * source.normal[0],
        source.point[1] - config.microShrink * source.normal[1],
        source.point[2] - config.microShrink * source.normal[2],
      ];
      const hit = nearestSurvivor(origin, negated, [moving], config);
      if (hit === null) {
        continue;
      }
      collisions.push({
        originSide: "static",
        originPartId: part.partId,
        originKind: source.kind,
        originIndex: source.index,
        originTriangle: source.triangle,
        hitPartId: moving.partId,
        hitTriangle: hit.triangle,
        distance: hit.distance,
      });
      movingTriangles.push(hit.triangle);
      noteStatic(part.partId, source.triangle);
    }
  }

  return {
    count: collisions.length,
    movingTriangles: ascending(movingTriangles),
    staticTriangles: [...staticTriangles.keys()]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((partId) => ({ partId, triangles: ascending(staticTriangles.get(partId) ?? []) })),
    collisions,
  };
}

/** One text key per collision, so two unordered collision lists can be compared as sets. */
export function collisionKey(collision: ClashResult["collisions"][number]): string {
  return [
    collision.originSide,
    collision.originPartId,
    collision.originKind,
    collision.originIndex,
    collision.originTriangle,
    collision.hitPartId,
    collision.hitTriangle,
  ].join("|");
}
