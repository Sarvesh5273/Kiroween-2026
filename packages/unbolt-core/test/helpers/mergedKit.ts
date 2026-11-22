import fc from "fast-check";
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { DEFAULT_SOLVER_CONFIG } from "../../src/config";
import type { Part } from "../../src/types";
import { failWith, type DomainContext } from "./failWith";
import { findFirstStepClash, solveStaged } from "./stagedSolve";
import type { InvariantKit, InvariantTally } from "./invariants";
/**
 * Helpers for Invariant 4, merged-mesh island recovery (Property 37, Req 29).
 *
 * A kit is baked once into one world-space geometry per source mesh. Each run then picks a subset
 * of those geometries and builds two inputs from the same baked data: the subset left unmerged,
 * each Part in its own mesh node, and the subset merged into one `BufferGeometry` in one Mesh with
 * an identity local transform. Using the same baked float32 positions for both inputs means the
 * unmerged Parts are the "source Parts" of Req 29.4 exactly.
 *
 * Nothing here reads `src/` except the default Weld_Tolerance and the stage functions.
 */
export interface BakedPart {
  /** Node name of the source mesh, for failure reports. */
  readonly name: string;
  /** Indexed geometry with `position` and `normal` in world space (float32). */
  readonly geometry: BufferGeometry;
}
/**
 * Bakes every mesh of `root` into world space: positions by the mesh's world matrix, normals by
 * its normal matrix, and the winding reversed when the matrix mirrors. World matrices come from
 * the local transforms, the way Stage 0 computes them. `root` is mutated (world matrices only),
 * so pass a fresh kit.
 *
 * @throws RangeError when a mesh has no index or lacks `position` or `normal`, since every kit
 *   mesh is indexed with both attributes (design rule R2).
 */
export function bakeKit(root: Object3D): BakedPart[] {
  root.updateWorldMatrix(false, true);
  const baked: BakedPart[] = [];
  root.traverse((node) => {
    if (!(node as Mesh).isMesh) {
      return;
    }
    const mesh = node as Mesh;
    const source = mesh.geometry;
    const index = source.getIndex();
    const position = source.getAttribute("position");
    const normal = source.getAttribute("normal");
    if (index === null || position === undefined || normal === undefined) {
      throw new RangeError(`mesh "${mesh.name}" must be indexed and have position and normal attributes`);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", position.clone());
    geometry.setAttribute("normal", normal.clone());
    geometry.setIndex(index.clone());
    geometry.applyMatrix4(mesh.matrixWorld);
    if (mesh.matrixWorld.determinant() < 0) {
      const flipped = (geometry.getIndex() as BufferAttribute).array.slice();
      for (let t = 0; t + 2 < flipped.length; t += 3) {
        const second = flipped[t + 1] as number;
        flipped[t + 1] = flipped[t + 2] as number;
        flipped[t + 2] = second;
      }
      geometry.setIndex(new BufferAttribute(flipped, 1));
    }
    baked.push({ name: mesh.name, geometry });
  });
  return baked;
}
/** Builds a fresh kit and bakes it. Every run of a property file shares the result. */
export function bakeKitOf(kit: InvariantKit): BakedPart[] {
  return bakeKit(kit.build());
}
const MATERIAL = new MeshStandardMaterial();
function expandedGeometry(part: BakedPart): BufferGeometry {
  return part.geometry.toNonIndexed();
}
/** The subset with each Part in its own mesh node, indexed or non-indexed as chosen. */
export function buildUnmerged(parts: readonly BakedPart[], indexed: boolean): Group {
  const group = new Group();
  for (const part of parts) {
    const mesh = new Mesh(indexed ? part.geometry : expandedGeometry(part), MATERIAL);
    mesh.name = part.name;
    group.add(mesh);
  }
  return group;
}
/**
 * The subset baked into one `BufferGeometry` inside one identity-transform Mesh (Req 29.1). When
 * `indexed` is false the geometry has no index and repeats each triangle's three corners.
 */
export function buildMerged(parts: readonly BakedPart[], indexed: boolean): Group {
  const pieces = parts.map((part) => (indexed ? part.geometry : expandedGeometry(part)));
  const vertexTotal = pieces.reduce((sum, piece) => sum + piece.getAttribute("position").count, 0);
  const positions = new Float32Array(3 * vertexTotal);
  const normals = new Float32Array(3 * vertexTotal);
  const indexTotal = indexed ? pieces.reduce((sum, piece) => sum + (piece.getIndex() as BufferAttribute).count, 0) : 0;
  const indices = new Uint32Array(indexTotal);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const piece of pieces) {
    const position = piece.getAttribute("position");
    const normal = piece.getAttribute("normal");
    for (let v = 0; v < position.count; v++) {
      for (let k = 0; k < 3; k++) {
        positions[3 * (vertexOffset + v) + k] = position.getComponent(v, k);
        normals[3 * (vertexOffset + v) + k] = normal.getComponent(v, k);
      }
    }
    if (indexed) {
      const index = piece.getIndex() as BufferAttribute;
      for (let i = 0; i < index.count; i++) {
        indices[indexOffset + i] = index.getX(i) + vertexOffset;
      }
      indexOffset += index.count;
    }
    vertexOffset += position.count;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  if (indexed) {
    geometry.setIndex(new BufferAttribute(indices, 1));
  }
  const mesh = new Mesh(geometry, MATERIAL);
  mesh.name = "merged";
  const group = new Group();
  group.add(mesh);
  return group;
}
/** Length of the diagonal of the box around every vertex of `parts`. */
export function diagonalOf(parts: readonly BakedPart[]): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const position = part.geometry.getAttribute("position");
    for (let v = 0; v < position.count; v++) {
      for (let k = 0; k < 3; k++) {
        const value = position.getComponent(v, k);
        min[k] = Math.min(min[k] as number, value);
        max[k] = Math.max(max[k] as number, value);
      }
    }
  }
  return Math.hypot((max[0] as number) - (min[0] as number), (max[1] as number) - (min[1] as number), (max[2] as number) - (min[2] as number));
}
/** The default Weld_Tolerance as a distance: `1e-6` times the diagonal of the subset's box (Req 29.2). */
export function weldDistanceOf(parts: readonly BakedPart[]): number {
  return DEFAULT_SOLVER_CONFIG.weldTolerance * diagonalOf(parts);
}
/**
 * True when two different Parts of `parts` have vertices at most `distance` apart (Req 29.2). A
 * uniform grid of cell size `distance` is searched in the 27 cells around each vertex, so only
 * pairs closer than one cell can be missed, and none are.
 */
export function hasCloseCrossPartVertices(parts: readonly BakedPart[], distance: number): boolean {
  if (!(distance > 0)) {
    return false;
  }
  const grid = new Map<string, { part: number; x: number; y: number; z: number }[]>();
  const cellOf = (value: number): number => Math.floor(value / distance);
  parts.forEach((part, partIndex) => {
    const position = part.geometry.getAttribute("position");
    for (let v = 0; v < position.count; v++) {
      const x = position.getX(v);
      const y = position.getY(v);
      const z = position.getZ(v);
      const key = `${cellOf(x)},${cellOf(y)},${cellOf(z)}`;
      const cell = grid.get(key);
      if (cell === undefined) {
        grid.set(key, [{ part: partIndex, x, y, z }]);
      } else {
        cell.push({ part: partIndex, x, y, z });
      }
    }
  });
  for (const cell of grid.values()) {
    const first = cell[0];
    if (first === undefined) continue;
    const cx = cellOf(first.x);
    const cy = cellOf(first.y);
    const cz = cellOf(first.z);
    for (const point of cell) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const other of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (other.part !== point.part && Math.hypot(point.x - other.x, point.y - other.y, point.z - other.z) <= distance) {
                return true;
              }
            }
          }
        }
      }
    }
  }
  return false;
}
/**
 * Subsets of 2 to all of `partCount` Parts, in random order, biased toward 2 to 16 Parts, with
 * "all Parts" generated explicitly (design, Test Strategy).
 */
export function subsetArbitrary(partCount: number): fc.Arbitrary<number[]> {
  const indices = Array.from({ length: partCount }, (_, i) => i);
  return fc.oneof(
    { weight: 6, arbitrary: fc.shuffledSubarray(indices, { minLength: 2, maxLength: Math.min(16, partCount) }) },
    { weight: 2, arbitrary: fc.shuffledSubarray(indices, { minLength: 2, maxLength: partCount }) },
    { weight: 1, arbitrary: fc.shuffledSubarray(indices, { minLength: partCount, maxLength: partCount }) },
  );
}
/** The Parts of `all` at `indices`, in that order. */
export function subsetOf(all: readonly BakedPart[], indices: readonly number[]): BakedPart[] {
  return indices.map((i) => {
    const part = all[i];
    if (part === undefined) {
      throw new RangeError(`no Part at index ${i} of ${all.length}`);
    }
    return part;
  });
}
/** Req 29.2: a subset is accepted only when no two of its Parts have vertices within the weld distance. */
export function isAccepted(parts: readonly BakedPart[]): boolean {
  return !hasCloseCrossPartVertices(parts, weldDistanceOf(parts));
}
function cornerDistance(a: Part, b: Part, triangle: number, corner: number): number {
  const va = a.triangles[3 * triangle + corner] as number;
  const vb = b.triangles[3 * triangle + corner] as number;
  return Math.hypot(
    (a.positions[3 * va] as number) - (b.positions[3 * vb] as number),
    (a.positions[3 * va + 1] as number) - (b.positions[3 * vb + 1] as number),
    (a.positions[3 * va + 2] as number) - (b.positions[3 * vb + 2] as number),
  );
}
/**
 * Req 29.5: an Island matches a source Part when both have the same triangle count and each
 * Island triangle has a source triangle whose 3 vertex positions each lie within `tolerance` of
 * the matching Island vertex positions. Parts list their triangles in ascending source-triangle
 * order, and the merge keeps each mesh's triangle order, so triangle `t` pairs with triangle `t`.
 */
export function islandMatchesSource(island: Part, source: Part, tolerance: number): boolean {
  const count = island.triangles.length / 3;
  if (count !== source.triangles.length / 3) {
    return false;
  }
  for (let t = 0; t < count; t++) {
    for (let corner = 0; corner < 3; corner++) {
      if (!(cornerDistance(island, source, t, corner) <= tolerance)) {
        return false;
      }
    }
  }
  return true;
}
/** One-to-one mapping from each Island to the source Part it matches, or a description of the failure. */
export function matchIslands(islands: readonly Part[], sources: readonly Part[], tolerance: number): { mapping: number[] } | { problem: string } {
  const claimed = new Map<number, string>();
  const mapping: number[] = [];
  for (const island of islands) {
    const candidates = sources.flatMap((source, index) => (islandMatchesSource(island, source, tolerance) ? [index] : []));
    if (candidates.length !== 1) {
      return { problem: `Island ${island.partId} matches ${candidates.length} source Parts` };
    }
    const sourceIndex = candidates[0] as number;
    const previous = claimed.get(sourceIndex);
    if (previous !== undefined) {
      return { problem: `Islands ${previous} and ${island.partId} both match source Part ${(sources[sourceIndex] as Part).partId}` };
    }
    claimed.set(sourceIndex, island.partId);
    mapping.push(sourceIndex);
  }
  return { mapping };
}
/**
 * Req 29.4 to 29.7 for one accepted subset. The subset left unmerged and the subset merged are
 * solved with the same Solver_Config (seed `configSeed`, other fields at their defaults). The
 * merged input must split into as many Parts as the unmerged one, map one-to-one onto its Parts,
 * return no MonolithicMeshError, and, when the unmerged subset is solved, solve with one step per
 * Part, unique Part_IDs and no clash for any step against the Parts still unremoved.
 */
export function verifyInvariant4(
  kit: InvariantKit,
  all: readonly BakedPart[],
  indices: readonly number[],
  indexed: boolean,
  configSeed: number,
  ctx: fc.ContextValue,
  tally: InvariantTally,
): void {
  const subset = subsetOf(all, indices);
  const domain: DomainContext = {
    kit: kit.name,
    configSeed,
    indexed,
    subsetSize: subset.length,
    subsetNames: subset.map((part) => part.name),
  };
  const tolerance = weldDistanceOf(subset);
  const unmerged = solveStaged(buildUnmerged(subset, indexed), { seed: configSeed });
  if (unmerged.status === "error") {
    failWith(ctx, { ...domain, errorKind: unmerged.plan.error.kind, errorMessage: unmerged.plan.error.message }, "Invariant 4: the unmerged subset returned an error result");
  }
  const merged = solveStaged(buildMerged(subset, indexed), { seed: configSeed });
  if (merged.status === "error") {
    failWith(ctx, { ...domain, errorKind: merged.plan.error.kind, errorMessage: merged.plan.error.message }, "Invariant 4: the merged input returned an error result");
  }
  const sources = unmerged.stage0.parts;
  const islands = merged.stage0.parts;
  if (islands.length !== sources.length || sources.length !== subset.length) {
    failWith(
      ctx,
      { ...domain, islandCount: islands.length, sourcePartCount: sources.length },
      "Invariant 4: the Island_Splitter did not produce one Part per source Part",
    );
  }
  const matched = matchIslands(islands, sources, tolerance);
  if ("problem" in matched) {
    failWith(ctx, { ...domain, weldDistance: tolerance }, `Invariant 4: ${matched.problem}`);
  }
  tally.itemsChecked += islands.length;
  if (unmerged.plan.status === "solved") {
    const { plan } = merged;
    if (plan.status !== "solved") {
      failWith(ctx, { ...domain, mergedStatus: plan.status, unmergedStatus: unmerged.plan.status }, "Invariant 4: the unmerged subset solves but the merged input does not");
    }
    const stepIds = plan.steps.map((step) => step.partId);
    const partIds = merged.stage1.parts.map((part) => part.partId);
    if (stepIds.length !== partIds.length || new Set(stepIds).size !== stepIds.length || stepIds.some((id) => !partIds.includes(id))) {
      failWith(ctx, { ...domain, stepIds, partIds }, "Invariant 4: the merged plan does not have exactly one step per merged Part");
    }
    const clash = findFirstStepClash(merged.stage1, plan.steps);
    if (clash !== null) {
      failWith(
        ctx,
        {
          ...domain,
          stepIndex: clash.stepIndex,
          partId: clash.partId,
          dir: clash.dir,
          clashCount: clash.count,
          movingTriangles: clash.movingTriangles,
          staticTriangles: clash.staticTriangles,
        },
        "Invariant 4: a merged Plan_Step is not clash-free against the merged Parts still unremoved",
      );
    }
    tally.stepsChecked += plan.steps.length;
  }
  tally.runs += 1;
}
