/**
 * Brute-force all-hit ray caster for tests. It intersects the ray with every triangle in turn
 * (Möller–Trumbore, double sided) and uses no BVH, so it checks the BVH-backed code paths.
 */
import type { Vec3 } from "../../../src/types";

export interface ReferenceHit {
  /** Part-local triangle index. */
  triangle: number;
  /** Distance from the origin along the unit direction. */
  distance: number;
}

function cross(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
    (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
    (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
  ];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

/** Every intersection of the ray `origin + t * dir`, `t >= 0`, with every triangle, in triangle order. */
export function castAllHitsBruteForce(
  origin: readonly number[],
  dir: readonly number[],
  positions: ArrayLike<number>,
  triangles: ArrayLike<number>,
): ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  const vertex = (index: number): Vec3 => [positions[3 * index] ?? 0, positions[3 * index + 1] ?? 0, positions[3 * index + 2] ?? 0];
  for (let t = 0; t < triangles.length / 3; t++) {
    const a = vertex(triangles[3 * t] ?? 0);
    const b = vertex(triangles[3 * t + 1] ?? 0);
    const c = vertex(triangles[3 * t + 2] ?? 0);
    const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const p = cross(dir, e2);
    const det = dot(e1, p);
    if (det === 0) {
      continue;
    }
    const s: Vec3 = [(origin[0] ?? 0) - a[0], (origin[1] ?? 0) - a[1], (origin[2] ?? 0) - a[2]];
    const u = dot(s, p) / det;
    if (u < 0 || u > 1) {
      continue;
    }
    const q = cross(s, e1);
    const v = dot(dir, q) / det;
    if (v < 0 || u + v > 1) {
      continue;
    }
    const distance = dot(e2, q) / det;
    if (distance < 0) {
      continue;
    }
    hits.push({ triangle: t, distance });
  }
  return hits;
}
