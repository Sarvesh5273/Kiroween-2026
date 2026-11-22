import { BufferAttribute, BufferGeometry, Mesh, Object3D } from "three";
import type { Vec3 } from "@unboltkit/core";
import type { MaterialDescriptor, ScenePayload, ScenePayloadNode } from "../protocol";
import { descriptorToMaterial, materialToDescriptor } from "./materialDescriptor";

export interface PayloadResult {
  root: ScenePayloadNode;
  meshCount: number;
  /** Each distinct `ArrayBuffer` of the payload exactly once. */
  transfer: ArrayBuffer[];
}

interface AttributeLike {
  count: number;
  itemSize: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

/** Copies a 3-component attribute into a fresh Float32Array (handles interleaved and normalized data). */
function copyVec3Attribute(attribute: AttributeLike): Float32Array {
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i += 1) {
    out[i * 3] = attribute.getX(i);
    out[i * 3 + 1] = attribute.getY(i);
    out[i * 3 + 2] = attribute.getZ(i);
  }
  return out;
}

function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true;
}

function nodeToPayload(object: Object3D, counter: { meshes: number }): ScenePayloadNode {
  let mesh: ScenePayloadNode["mesh"] = null;
  if (isMesh(object)) {
    const geometry = object.geometry;
    const position = geometry.getAttribute("position");
    if (position !== undefined && position.itemSize >= 3 && position.count > 0) {
      const normal = geometry.getAttribute("normal");
      const index = geometry.getIndex();
      mesh = {
        positions: copyVec3Attribute(position),
        normals:
          normal !== undefined && normal.itemSize >= 3 && normal.count === position.count
            ? copyVec3Attribute(normal)
            : null,
        indices: index !== null ? new Uint32Array(index.array) : null,
        material: materialToDescriptor(object.material),
      };
      counter.meshes += 1;
    }
  }
  const localPosition: Vec3 = [object.position.x, object.position.y, object.position.z];
  const localScale: Vec3 = [object.scale.x, object.scale.y, object.scale.z];
  return {
    name: object.name,
    position: localPosition,
    quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
    scale: localScale,
    mesh,
    children: object.children.map((child) => nodeToPayload(child, counter)),
  };
}

function collectBuffers(node: ScenePayloadNode, into: Set<ArrayBuffer>): void {
  if (node.mesh !== null) {
    into.add(node.mesh.positions.buffer as ArrayBuffer);
    if (node.mesh.normals !== null) into.add(node.mesh.normals.buffer as ArrayBuffer);
    if (node.mesh.indices !== null) into.add(node.mesh.indices.buffer as ArrayBuffer);
  }
  for (const child of node.children) collectBuffers(child, into);
}

/**
 * Copies an Object3D tree into plain data: names, local TRS, and per-mesh buffers.
 * Child order is kept so Core node paths of the rebuilt tree equal those of the source.
 */
export function objectToPayload(root: Object3D): PayloadResult {
  const counter = { meshes: 0 };
  const payloadRoot = nodeToPayload(root, counter);
  const buffers = new Set<ArrayBuffer>();
  collectBuffers(payloadRoot, buffers);
  return { root: payloadRoot, meshCount: counter.meshes, transfer: [...buffers] };
}

function buildGeometry(mesh: NonNullable<ScenePayloadNode["mesh"]>): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  if (mesh.normals !== null) geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  if (mesh.indices !== null) geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  return geometry;
}

function payloadNodeToObject(node: ScenePayloadNode): Object3D {
  let object: Object3D;
  if (node.mesh !== null) {
    const material: MaterialDescriptor = node.mesh.material;
    object = new Mesh(buildGeometry(node.mesh), descriptorToMaterial(material));
  } else {
    object = new Object3D();
  }
  object.name = node.name;
  object.position.set(node.position[0], node.position[1], node.position[2]);
  object.quaternion.set(node.quaternion[0], node.quaternion[1], node.quaternion[2], node.quaternion[3]);
  object.scale.set(node.scale[0], node.scale[1], node.scale[2]);
  for (const child of node.children) object.add(payloadNodeToObject(child));
  return object;
}

/** Rebuilds an Object3D tree (same child order, names, local TRS). Runs in the worker. */
export function payloadToObject(root: ScenePayloadNode): Object3D {
  return payloadNodeToObject(root);
}

/** Convenience for callers that hold a full `ScenePayload`. */
export function scenePayloadToObject(scene: ScenePayload): Object3D {
  return payloadToObject(scene.root);
}
