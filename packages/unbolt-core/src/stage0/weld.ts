import { at } from "./arrayAccess";
import type { UnionFind } from "./unionFind";

/**
 * Cell indices above this magnitude are no longer exact integers after `floor(x / cell)`, so
 * the grid cannot be trusted. Such inputs use the exhaustive scan instead.
 */
const MAX_EXACT_CELL_INDEX = 2 ** 50;

/**
 * Welds the listed vertices. Two vertices are unioned when their world-space distance is
 * `<= radius` (Req 5.2). The relation is transitive because Union-Find closes it.
 *
 * `vertices` must be ascending source indices. `positions` holds 3 numbers per source vertex.
 * Only the vertices named in `vertices` are welded, so an unreferenced vertex cannot join two
 * islands. A radius of `0` welds exact coordinate duplicates only.
 *
 * Cost is O(n) expected for a spatial grid with cell size `2 * radius`. If a coordinate divided
 * by the cell size is too large to keep exact cell indices, the function scans every pair, which
 * is O(n²). Only extreme `weldTolerance` values reach that path.
 */
export function weldVertices(
  positions: Float64Array,
  vertices: Uint32Array,
  radius: number,
  weld: UnionFind,
): void {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new RangeError(`weld radius must be finite and >= 0; received ${String(radius)}`);
  }
  if (vertices.length === 0) {
    return;
  }
  if (radius === 0) {
    weldExactCoordinates(positions, vertices, weld);
    return;
  }
  const cell = 2 * radius;
  if (needsExhaustiveScan(positions, vertices, cell)) {
    weldExhaustively(positions, vertices, radius, weld);
    return;
  }
  weldWithGrid(positions, vertices, radius, cell, weld);
}

function coordinateKey(positions: Float64Array, vertex: number): string {
  return `${at(positions, 3 * vertex)},${at(positions, 3 * vertex + 1)},${at(positions, 3 * vertex + 2)}`;
}

function distanceWithin(positions: Float64Array, a: number, b: number, radius: number): boolean {
  const dx = at(positions, 3 * a) - at(positions, 3 * b);
  const dy = at(positions, 3 * a + 1) - at(positions, 3 * b + 1);
  const dz = at(positions, 3 * a + 2) - at(positions, 3 * b + 2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= radius;
}

function weldExactCoordinates(positions: Float64Array, vertices: Uint32Array, weld: UnionFind): void {
  const firstByKey = new Map<string, number>();
  for (const vertex of vertices) {
    const key = coordinateKey(positions, vertex);
    const first = firstByKey.get(key);
    if (first === undefined) {
      firstByKey.set(key, vertex);
    } else {
      weld.union(first, vertex);
    }
  }
}

function needsExhaustiveScan(positions: Float64Array, vertices: Uint32Array, cell: number): boolean {
  for (const vertex of vertices) {
    for (let k = 0; k < 3; k++) {
      if (Math.abs(at(positions, 3 * vertex + k) / cell) > MAX_EXACT_CELL_INDEX) {
        return true;
      }
    }
  }
  return false;
}

function weldExhaustively(positions: Float64Array, vertices: Uint32Array, radius: number, weld: UnionFind): void {
  for (let i = 0; i < vertices.length; i++) {
    const a = at(vertices, i);
    for (let j = i + 1; j < vertices.length; j++) {
      const b = at(vertices, j);
      if (distanceWithin(positions, a, b, radius)) {
        weld.union(a, b);
      }
    }
  }
}

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function weldWithGrid(
  positions: Float64Array,
  vertices: Uint32Array,
  radius: number,
  cell: number,
  weld: UnionFind,
): void {
  // Vertices are inserted in ascending index order. Each one is compared only with vertices
  // already in its 27 neighboring cells. Any pair within `radius` falls into adjacent cells
  // because `radius < cell`, so no pair is missed.
  const grid = new Map<string, number[]>();
  for (const vertex of vertices) {
    const cx = Math.floor(at(positions, 3 * vertex) / cell);
    const cy = Math.floor(at(positions, 3 * vertex + 1) / cell);
    const cz = Math.floor(at(positions, 3 * vertex + 2) / cell);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (bucket === undefined) {
            continue;
          }
          for (const other of bucket) {
            if (distanceWithin(positions, other, vertex, radius)) {
              weld.union(other, vertex);
            }
          }
        }
      }
    }

    const ownKey = cellKey(cx, cy, cz);
    const own = grid.get(ownKey);
    if (own === undefined) {
      grid.set(ownKey, [vertex]);
    } else {
      own.push(vertex);
    }
  }
}
