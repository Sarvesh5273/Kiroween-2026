/**
 * Conversion between a Three `Object3D` tree and the plain-data `ScenePayload`.
 *
 * `objectToPayload` runs on the Main_Thread after `GLTFLoader` has parsed a file. It copies the
 * node names, the local translation, quaternion and scale, and the position, normal and index
 * buffers of every mesh, plus a `MaterialDescriptor` per mesh. It reads nothing else, so no
 * texture, image, canvas or DOM object can reach the payload (Requirements 7.6, 7.9).
 *
 * `payloadToObject` runs in the Solver_Worker and rebuilds an `Object3D` tree with the same local
 * transforms and child order, so Core node paths of the rebuilt tree equal those of the source
 * tree (Requirement 7.8).
 *
 * This module uses `three` only. It touches no DOM, so it runs on both threads and in Node tests.
 */
import {
  BufferAttribute,
  BufferGeometry,
  InterleavedBufferAttribute,
  Mesh,
  Object3D,
} from "three";
import type { Vec3 } from "@unboltkit/core";
import type { ScenePayload, ScenePayloadMesh, ScenePayloadNode } from "../protocol";
import { descriptorToMaterial, materialToDescriptor } from "./materialDescriptor";

type AnyAttribute = BufferAttribute | InterleavedBufferAttribute;

/**
 * Result of `objectToPayload`. `root` and `meshCount` form the `ScenePayload` that goes into the
 * Solve_Request. `transfer` is the transfer list for `postMessage` and is not part of the payload.
 */
export interface ObjectToPayloadResult extends ScenePayload {
  /** The `ArrayBuffer` of every typed array in the payload, each listed exactly once. */
  transfer: ArrayBuffer[];
}

function hasFlag(node: object, flag: string): boolean {
  return (node as Record<string, unknown>)[flag] === true;
}

/**
 * Copies `count` vertices of `attribute` into a fresh `Float32Array` with `getX/getY/getZ`, so
 * interleaved and normalized attributes yield their logical values.
 */
function copyVec3Attribute(attribute: AnyAttribute, transfer: Set<ArrayBuffer>): Float32Array {
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    out[3 * i] = attribute.getX(i);
    out[3 * i + 1] = attribute.getY(i);
    out[3 * i + 2] = attribute.getZ(i);
  }
  transfer.add(out.buffer);
  return out;
}

function copyIndex(index: BufferAttribute, transfer: Set<ArrayBuffer>): Uint32Array {
  const out = new Uint32Array(index.count);
  for (let i = 0; i < index.count; i++) {
    out[i] = index.getX(i);
  }
  transfer.add(out.buffer);
  return out;
}

function meshToPayload(mesh: Mesh, transfer: Set<ArrayBuffer>): ScenePayloadMesh {
  const geometry = mesh.geometry;

  // A mesh without a usable position attribute stays a mesh with an empty buffer. The worker then
  // rebuilds a geometry without positions, and Core reports it as invalid geometry, as it would for
  // the source tree.
  const position: AnyAttribute | undefined = geometry.getAttribute("position");
  let positions: Float32Array;
  if (position !== undefined && position.itemSize >= 3) {
    positions = copyVec3Attribute(position, transfer);
  } else {
    const empty = new Float32Array(0);
    transfer.add(empty.buffer);
    positions = empty;
  }

  const normal: AnyAttribute | undefined = geometry.getAttribute("normal");
  const normals =
    normal !== undefined && normal.itemSize >= 3 ? copyVec3Attribute(normal, transfer) : null;

  const index = geometry.index;
  const indices = index === null ? null : copyIndex(index, transfer);

  return { positions, normals, indices, material: materialToDescriptor(mesh.material) };
}

function toVec3(source: { x: number; y: number; z: number }): Vec3 {
  return [source.x, source.y, source.z];
}

function emptyNode(object: Object3D): ScenePayloadNode {
  return {
    name: object.name,
    position: toVec3(object.position),
    quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
    scale: toVec3(object.scale),
    mesh: null,
    children: [],
  };
}

/**
 * Walks `root` in child order and copies it into plain data.
 *
 * Every node, mesh or not, becomes one payload node, so child indices (and therefore Core node
 * paths) are preserved. Local `position`, `quaternion` and `scale` are read directly; `matrix` and
 * `matrixWorld` are never read. All buffers are fresh copies, so transferring them cannot detach
 * a buffer that `GLTFLoader` shares between meshes. Each copy owns its own `ArrayBuffer`, and
 * `transfer` lists each of them once.
 */
export function objectToPayload(root: Object3D): ObjectToPayloadResult {
  const transfer = new Set<ArrayBuffer>();
  const rootNode = emptyNode(root);
  let meshCount = 0;

  const stack: { object: Object3D; node: ScenePayloadNode }[] = [{ object: root, node: rootNode }];
  for (let pending = stack.pop(); pending !== undefined; pending = stack.pop()) {
    const { object, node } = pending;
    if (hasFlag(object, "isMesh")) {
      node.mesh = meshToPayload(object as Mesh, transfer);
      meshCount++;
    }
    for (const child of object.children) {
      const childNode = emptyNode(child);
      node.children.push(childNode);
      stack.push({ object: child, node: childNode });
    }
  }

  return { root: rootNode, meshCount, transfer: [...transfer] };
}

function payloadMeshToMesh(payload: ScenePayloadMesh): Mesh {
  const geometry = new BufferGeometry();
  if (payload.positions.length > 0) {
    geometry.setAttribute("position", new BufferAttribute(payload.positions, 3));
  }
  if (payload.normals !== null) {
    geometry.setAttribute("normal", new BufferAttribute(payload.normals, 3));
  }
  if (payload.indices !== null) {
    geometry.setIndex(new BufferAttribute(payload.indices, 1));
  }
  return new Mesh(geometry, descriptorToMaterial(payload.material));
}

function payloadNodeToObject(node: ScenePayloadNode): Object3D {
  const object = node.mesh === null ? new Object3D() : payloadMeshToMesh(node.mesh);
  object.name = node.name;
  object.position.set(node.position[0], node.position[1], node.position[2]);
  object.quaternion.set(node.quaternion[0], node.quaternion[1], node.quaternion[2], node.quaternion[3]);
  object.scale.set(node.scale[0], node.scale[1], node.scale[2]);
  return object;
}

/**
 * Rebuilds an `Object3D` tree from a payload node. The result has the local transforms, the child
 * order and the names of the payload, `BufferGeometry` meshes that use the payload buffers
 * directly (no copy), and a `MeshPhysicalMaterial` per mesh built from its descriptor.
 */
export function payloadToObject(root: ScenePayloadNode): Object3D {
  const rootObject = payloadNodeToObject(root);
  const stack: { node: ScenePayloadNode; object: Object3D }[] = [{ node: root, object: rootObject }];
  for (let pending = stack.pop(); pending !== undefined; pending = stack.pop()) {
    const { node, object } = pending;
    for (const childNode of node.children) {
      const childObject = payloadNodeToObject(childNode);
      object.add(childObject);
      stack.push({ node: childNode, object: childObject });
    }
  }
  return rootObject;
}
