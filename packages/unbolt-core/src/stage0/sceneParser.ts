import {
  Matrix3,
  Matrix4,
  type BufferAttribute,
  type InterleavedBufferAttribute,
  type Mesh,
  type Object3D,
} from "three";
import { formatNodePath } from "../errors";
import type { Diagnostic, GeometryIssue, MeshRecord, NodePath } from "../types";
import { at } from "./arrayAccess";
import { writeFaceNormal } from "./triangleGeometry";

type AttributeLike = BufferAttribute | InterleavedBufferAttribute;

export interface ParseResult {
  /** One record per usable mesh node (at least one triangle, no problems), in traversal order. */
  meshes: MeshRecord[];
  diagnostics: Diagnostic[];
  /**
   * Every malformed or non-finite finding, in traversal order. One node can appear twice when it
   * has both problems.
   */
  invalid: GeometryIssue[];
}

interface PendingNode {
  node: Object3D;
  path: NodePath;
  parentWorld: Matrix4;
}

interface MeshScan {
  malformed: boolean;
  nonFinite: boolean;
  /** World-space positions, 3 per source vertex. */
  worldPositions: Float64Array;
  /** World-space unit normals per source vertex, or `undefined` when the geometry has none. */
  worldNormals: Float64Array | undefined;
  /** Source vertex indices, 3 per triangle. Valid only when `malformed` is false. */
  triangles: Uint32Array;
}

/**
 * Traverses `root` in pre-order, visiting children in ascending index order and ignoring
 * `visible` (Req 4.1). World matrices come from the local `position`, `quaternion` and `scale`
 * of each node, starting at the root (Req 4.2). `matrixWorld` is never read and
 * `updateMatrixWorld` is never called, so the input hierarchy is not changed (Req 4.7).
 *
 * `drawRange`, `groups` and morph targets are ignored.
 */
export function parseScene(root: Object3D): ParseResult {
  const meshes: MeshRecord[] = [];
  const diagnostics: Diagnostic[] = [];
  const invalid: GeometryIssue[] = [];
  const stack: PendingNode[] = [{ node: root, path: [], parentWorld: new Matrix4() }];

  for (let pending = stack.pop(); pending !== undefined; pending = stack.pop()) {
    const { node, path, parentWorld } = pending;
    const local = new Matrix4().compose(node.position, node.quaternion, node.scale);
    const world = new Matrix4().multiplyMatrices(parentWorld, local);

    if (isMeshNode(node)) {
      visitMesh(node, path, world, meshes, diagnostics, invalid);
    } else {
      diagnostics.push(excludedDiagnostic(node, path, "the node is not a Mesh"));
    }

    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child !== undefined) {
        stack.push({ node: child, path: [...path, i], parentWorld: world });
      }
    }
  }

  return { meshes, diagnostics, invalid };
}

function hasFlag(node: object, flag: string): boolean {
  return (node as Record<string, unknown>)[flag] === true;
}

function isMeshNode(node: Object3D): node is Mesh {
  return hasFlag(node, "isMesh");
}

function excludedDiagnostic(node: Object3D, path: NodePath, reason: string): Diagnostic {
  return {
    code: "excluded-node",
    nodePath: path.slice(),
    nodeType: node.type,
    message: `Node ${formatNodePath(path)} (${node.type}) is excluded from Parts because ${reason}`,
  };
}

function visitMesh(
  mesh: Mesh,
  path: NodePath,
  world: Matrix4,
  meshes: MeshRecord[],
  diagnostics: Diagnostic[],
  invalid: GeometryIssue[],
): void {
  const scan = scanMesh(mesh, world);
  if (scan.malformed) {
    invalid.push({ reason: "malformed", nodePath: path.slice() });
  }
  if (scan.nonFinite) {
    invalid.push({ reason: "non-finite", nodePath: path.slice() });
  }
  if (scan.malformed || scan.nonFinite) {
    return;
  }

  const triangleCount = scan.triangles.length / 3;
  if (triangleCount === 0) {
    diagnostics.push(excludedDiagnostic(mesh, path, "its geometry has no triangles"));
    return;
  }

  // Req 4.6 and design Stage 0a: a mirrored transform reverses the corner order, so the face
  // normals still point outward. Corner normals are stored in source order and are reordered
  // in Stage 0b.
  const flipped = world.determinant() < 0;
  const normalsDerived = scan.worldNormals === undefined;
  const cornerNormals =
    scan.worldNormals === undefined
      ? deriveCornerNormals(scan.worldPositions, scan.triangles, flipped)
      : gatherCornerNormals(scan.worldNormals, scan.triangles);

  meshes.push({
    nodePath: path.slice(),
    nodeName: mesh.name,
    worldMatrix: Array.from(world.elements),
    positions: scan.worldPositions,
    normals: cornerNormals,
    normalsDerived,
    triangles: scan.triangles,
    windingFlipped: flipped,
  });

  if (hasFlag(mesh, "isInstancedMesh")) {
    diagnostics.push({
      code: "instancing-ignored",
      nodePath: path.slice(),
      nodeType: mesh.type,
      message: `Node ${formatNodePath(path)} is an InstancedMesh; only the base geometry is used and the instance matrices are ignored`,
    });
  }
  if (hasFlag(mesh, "isSkinnedMesh")) {
    diagnostics.push({
      code: "skinning-ignored",
      nodePath: path.slice(),
      nodeType: mesh.type,
      message: `Node ${formatNodePath(path)} is a SkinnedMesh; the bind pose geometry is used and skinning is ignored`,
    });
  }
  if (normalsDerived) {
    diagnostics.push({
      code: "derived-normals",
      nodePath: path.slice(),
      nodeType: mesh.type,
      message: `Node ${formatNodePath(path)} has no normal attribute; unit normals were derived from triangle winding`,
    });
  }
}

function scanMesh(mesh: Mesh, world: Matrix4): MeshScan {
  const geometry = mesh.geometry;
  const position: AttributeLike | undefined = geometry.getAttribute("position");
  if (position === undefined || position.itemSize < 3) {
    return {
      malformed: true,
      nonFinite: false,
      worldPositions: new Float64Array(0),
      worldNormals: undefined,
      triangles: new Uint32Array(0),
    };
  }

  const vertexCount = position.count;
  const index = geometry.index;
  const normal: AttributeLike | undefined = geometry.getAttribute("normal");
  const indexCount = index === null ? vertexCount : index.count;

  let malformed = indexCount % 3 !== 0;
  let nonFinite = false;

  const triangles = new Uint32Array(indexCount);
  if (index === null) {
    for (let i = 0; i < indexCount; i++) {
      triangles[i] = i;
    }
  } else {
    for (let i = 0; i < indexCount; i++) {
      const value = index.getX(i);
      if (!Number.isInteger(value) || value < 0 || value >= vertexCount) {
        malformed = true;
      }
      triangles[i] = value;
    }
  }

  const normalUsable = normal !== undefined && normal.itemSize >= 3 && normal.count === vertexCount;
  if (normal !== undefined && !normalUsable) {
    malformed = true;
  }

  const e = world.elements;
  const worldPositions = new Float64Array(3 * vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    if (!allFinite(x, y, z)) {
      nonFinite = true;
    }
    const wx = at(e, 0) * x + at(e, 4) * y + at(e, 8) * z + at(e, 12);
    const wy = at(e, 1) * x + at(e, 5) * y + at(e, 9) * z + at(e, 13);
    const wz = at(e, 2) * x + at(e, 6) * y + at(e, 10) * z + at(e, 14);
    if (!allFinite(wx, wy, wz)) {
      nonFinite = true;
    }
    worldPositions[3 * i] = wx;
    worldPositions[3 * i + 1] = wy;
    worldPositions[3 * i + 2] = wz;
  }

  let worldNormals: Float64Array | undefined;
  if (normal !== undefined && normalUsable) {
    worldNormals = transformNormals(normal, vertexCount, world, () => {
      nonFinite = true;
    });
  }

  return { malformed, nonFinite, worldPositions, worldNormals, triangles };
}

/**
 * Transforms per-vertex normals by the inverse transpose of the upper 3x3 of `world` and
 * re-normalizes them (Req 4.3). A singular transform gives a zero matrix in three.js, so its
 * normals become `[0, 0, 0]` and are not reported as non-finite.
 */
function transformNormals(
  normal: AttributeLike,
  vertexCount: number,
  world: Matrix4,
  onNonFinite: () => void,
): Float64Array {
  const m = new Matrix3().getNormalMatrix(world).elements;
  const out = new Float64Array(3 * vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    if (!allFinite(nx, ny, nz)) {
      onNonFinite();
    }
    const tx = at(m, 0) * nx + at(m, 3) * ny + at(m, 6) * nz;
    const ty = at(m, 1) * nx + at(m, 4) * ny + at(m, 7) * nz;
    const tz = at(m, 2) * nx + at(m, 5) * ny + at(m, 8) * nz;
    const length = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (!allFinite(tx, ty, tz) || !Number.isFinite(length)) {
      onNonFinite();
      continue;
    }
    if (length > 0) {
      out[3 * i] = tx / length;
      out[3 * i + 1] = ty / length;
      out[3 * i + 2] = tz / length;
    }
  }
  return out;
}

function gatherCornerNormals(worldNormals: Float64Array, triangles: Uint32Array): Float64Array {
  const triangleCount = triangles.length / 3;
  const out = new Float64Array(9 * triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vertex = at(triangles, 3 * t + k);
      for (let j = 0; j < 3; j++) {
        out[9 * t + 3 * k + j] = at(worldNormals, 3 * vertex + j);
      }
    }
  }
  return out;
}

/**
 * Derives one unit normal per triangle from its counter-clockwise winding in world space, after
 * the winding correction (Req 4.10). All three corners of a triangle get that normal. A
 * zero-area triangle gets `[0, 0, 0]`.
 */
function deriveCornerNormals(worldPositions: Float64Array, triangles: Uint32Array, flipped: boolean): Float64Array {
  const triangleCount = triangles.length / 3;
  const out = new Float64Array(9 * triangleCount);
  const face = new Float64Array(3);
  for (let t = 0; t < triangleCount; t++) {
    const a = at(triangles, 3 * t);
    const b = at(triangles, 3 * t + 1);
    const c = at(triangles, 3 * t + 2);
    if (flipped) {
      writeFaceNormal(worldPositions, a, c, b, face, 0);
    } else {
      writeFaceNormal(worldPositions, a, b, c, face, 0);
    }
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 3; j++) {
        out[9 * t + 3 * k + j] = at(face, j);
      }
    }
  }
  return out;
}

function allFinite(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}
