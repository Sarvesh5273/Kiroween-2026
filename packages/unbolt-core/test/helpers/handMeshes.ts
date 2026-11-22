import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import type { Stage0Result } from "../../src/types";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import type { ErrorResult, Stage1Result } from "../../src/types";

/**
 * Hand-built meshes for Stage 1 tests. Positions are stored as `Float64Array`, so exact ties in
 * the covariance survive: a `Float32Array` would round them apart by about `1e-8`.
 */

export type Offset = readonly [number, number, number];

export function meshFromArrays(positions: readonly number[], triangles: readonly number[], offset: Offset = [0, 0, 0]): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float64Array(positions), 3));
  geometry.setIndex(triangles.slice());
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.position.set(offset[0], offset[1], offset[2]);
  return mesh;
}

/** Unit cube corners, bottom face first (z = 0), then top (z = 1). */
export const CUBE_POSITIONS: readonly number[] = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];

/** 12 outward-wound triangles of {@link CUBE_POSITIONS}. */
export const CUBE_TRIANGLES: readonly number[] = [
  0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
];

/** A cube used as the second Part of a two-Part Assembly (a Monolithic Assembly is an error). */
export function referenceBox(offset: Offset = [3, 2, -1]): Mesh {
  return meshFromArrays(CUBE_POSITIONS, CUBE_TRIANGLES, offset);
}

/**
 * Five points with an exactly isotropic covariance and no symmetry: the rows of a 5×3 matrix
 * whose three columns are mutually orthogonal, unit length and orthogonal to the all-ones vector
 * (Gram-Schmidt of fixed integer columns). All three eigenvalues are equal, so the whole space
 * is a Tied_Eigenspace, yet the five distances from the centroid all differ, so the farthest
 * vertex is unique and the Part is Frame_Unique.
 */
export function tightFramePositions(scaleFactor = 0.6): number[] {
  const rows = [
    [3, 1, -2],
    [-1, 4, 2],
    [2, -3, 5],
    [0, 2, -4],
    [-4, -4, -1],
  ];
  const columns = [0, 1, 2].map((k) => rows.map((row) => row[k] ?? 0));
  const orthonormal: number[][] = [];
  for (const column of columns) {
    let v = [...column];
    for (const u of orthonormal) {
      const d = v.reduce((sum, x, i) => sum + x * (u[i] ?? 0), 0);
      v = v.map((x, i) => x - d * (u[i] ?? 0));
    }
    const norm = Math.hypot(...v);
    orthonormal.push(v.map((x) => x / norm));
  }
  const positions: number[] = [];
  for (let i = 0; i < 5; i++) {
    for (const column of orthonormal) {
      positions.push((column[i] ?? 0) * scaleFactor);
    }
  }
  return positions;
}

export const TIGHT_FRAME_TRIANGLES: readonly number[] = [0, 1, 2, 1, 2, 3, 2, 3, 4];

/** A skewed hexahedron (cube topology): three distinct eigenvalues and nonzero third moments. */
export const SKEWED_HEXAHEDRON_POSITIONS: readonly number[] = [
  0, 0, 0, 3, 0, 0, 3.3, 2.1, 0.2, 0.2, 2, 0.1, 0.1, 0.1, 1, 2.8, 0.3, 1.2, 3.0, 2.2, 1.0, 0.3, 1.9, 1.4,
];

/**
 * A square pyramid whose side face (corner 0, corner 1, apex) is missing. Corners 0 to 3 are
 * equally far from the axis, so the covariance is tied in the base plane, but the corner that
 * touches the most triangle area is unique.
 */
export const PYRAMID_POSITIONS: readonly number[] = [1, 1, 0, -1, 1, 0, -1, -1, 0, 1, -1, 0, 0, 0, 1.5];
export const PYRAMID_TRIANGLES: readonly number[] = [0, 2, 1, 0, 3, 2, 1, 2, 4, 2, 3, 4, 3, 0, 4];

/**
 * An octahedron with two triangles of equal area and equal normals (1,1,1)/sqrt(3), joined by a
 * zero-area triangle so that Stage 0 keeps one Island. Every vertex is equally far from the
 * centroid and the farthest-vertex sum is zero, so the largest-face step decides the first axis
 * and fallback F1 decides the second.
 */
export const OCTAHEDRON_POSITIONS: readonly number[] = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1].map(
  (v) => v * 0.5,
);
export const OCTAHEDRON_TRIANGLES: readonly number[] = [0, 2, 4, 1, 3, 5, 0, 1, 1];

/** Three collinear points on the x axis (one zero-area triangle). */
export function collinearSegment(from: number, to: number): { positions: number[]; triangles: number[] } {
  const mid = (from + to) / 2;
  return { positions: [from, 0, 0, mid, 0, 0, to, 0, 0], triangles: [0, 1, 2] };
}

/** Applies a permutation of the vertices: new vertex `i` is old vertex `order[i]`. Triangle order is kept. */
export function permuteVertices(
  positions: readonly number[],
  triangles: readonly number[],
  order: readonly number[],
): { positions: number[]; triangles: number[] } {
  const newIndexOfOld = new Map<number, number>(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  const permutedPositions: number[] = [];
  for (const oldIndex of order) {
    permutedPositions.push(positions[3 * oldIndex] ?? 0, positions[3 * oldIndex + 1] ?? 0, positions[3 * oldIndex + 2] ?? 0);
  }
  return {
    positions: permutedPositions,
    triangles: triangles.map((oldIndex) => {
      const index = newIndexOfOld.get(oldIndex);
      if (index === undefined) {
        throw new RangeError(`vertex ${oldIndex} is missing from the permutation`);
      }
      return index;
    }),
  };
}

export function requireStage0(result: Stage0Result | ErrorResult): Stage0Result {
  if (result.status !== "ok") {
    throw new Error(`expected a Stage 0 result, received ${result.error.kind}: ${result.error.message}`);
  }
  return result;
}

export function requireStage1(result: Stage1Result | ErrorResult): Stage1Result {
  if (result.status !== "ok") {
    throw new Error(`expected a Stage 1 result, received ${result.error.kind}: ${result.error.message}`);
  }
  return result;
}

/** Runs Stage 0 and Stage 1 on a root that holds the given meshes. */
export function prepare(root: Group): Stage1Result {
  return requireStage1(stage1Prepare(requireStage0(stage0ParseScene(root))));
}

export function groupOf(...meshes: Mesh[]): Group {
  const group = new Group();
  for (const mesh of meshes) {
    group.add(mesh);
  }
  return group;
}
