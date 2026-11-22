import type { BufferGeometry, Material, Object3D } from "three";
import { expect } from "vitest";

/**
 * Deep snapshots for mutation checks (Property 2, Req 1.8). A snapshot copies every value,
 * so later changes to the live objects cannot alter it.
 */

interface MaterialReference {
  uuid: string;
  type: string;
}

interface GeometrySnapshot {
  uuid: string;
  attributes: Record<string, { itemSize: number; count: number; normalized: boolean; values: number[] }>;
  index: number[] | null;
}

export interface NodeSnapshot {
  uuid: string;
  type: string;
  name: string;
  position: number[];
  quaternion: number[];
  scale: number[];
  matrix: number[];
  matrixWorld: number[];
  childUuids: string[];
  geometry: GeometrySnapshot | null;
  material: MaterialReference | MaterialReference[] | null;
}

/** Pre-order snapshot of every node under `root`, children in their stored order. */
export function snapshotHierarchy(root: Object3D): NodeSnapshot[] {
  const nodes: NodeSnapshot[] = [];
  const stack: Object3D[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    const mesh = node as Partial<{ geometry: BufferGeometry; material: Material | Material[] }>;
    nodes.push({
      uuid: node.uuid,
      type: node.type,
      name: node.name,
      position: node.position.toArray(),
      quaternion: node.quaternion.toArray(),
      scale: node.scale.toArray(),
      matrix: node.matrix.elements.slice(),
      matrixWorld: node.matrixWorld.elements.slice(),
      childUuids: node.children.map((child) => child.uuid),
      geometry: mesh.geometry === undefined ? null : snapshotGeometry(mesh.geometry),
      material: mesh.material === undefined ? null : snapshotMaterial(mesh.material),
    });
    // Push in reverse so the first child is popped first (pre-order).
    for (const child of node.children.slice().reverse()) {
      stack.push(child);
    }
  }
  return nodes;
}

function snapshotGeometry(geometry: BufferGeometry): GeometrySnapshot {
  const attributes: GeometrySnapshot["attributes"] = {};
  for (const name of Object.keys(geometry.attributes).sort()) {
    const attribute = geometry.attributes[name];
    if (attribute === undefined) {
      continue;
    }
    // getX/getY/getZ/getW handle both plain and interleaved attributes.
    const readers = [
      attribute.getX.bind(attribute),
      attribute.getY.bind(attribute),
      attribute.getZ.bind(attribute),
      attribute.getW.bind(attribute),
    ];
    const values: number[] = [];
    for (let i = 0; i < attribute.count; i++) {
      for (let c = 0; c < attribute.itemSize; c++) {
        const read = readers[c];
        if (read === undefined) {
          throw new RangeError(`snapshotGeometry: itemSize ${attribute.itemSize} exceeds 4`);
        }
        values.push(read(i));
      }
    }
    attributes[name] = {
      itemSize: attribute.itemSize,
      count: attribute.count,
      normalized: attribute.normalized,
      values,
    };
  }
  return {
    uuid: geometry.uuid,
    attributes,
    index: geometry.index === null ? null : Array.from(geometry.index.array),
  };
}

function snapshotMaterial(material: Material | Material[]): MaterialReference | MaterialReference[] {
  if (Array.isArray(material)) {
    return material.map((entry) => ({ uuid: entry.uuid, type: entry.type }));
  }
  return { uuid: material.uuid, type: material.type };
}

/**
 * Deep copy of plain data, typed arrays and arrays. Class instances (including `THREE` objects
 * and `MeshBVH`) are rejected, so the caller must snapshot their plain fields instead.
 */
export function snapshotValue(value: unknown): unknown {
  return copyValue(value, new Set<object>(), "$");
}

function copyValue(value: unknown, ancestors: Set<object>, path: string): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (ancestors.has(value)) {
    throw new TypeError(`snapshotValue: cycle at ${path}`);
  }
  if (ArrayBuffer.isView(value)) {
    const elements = value as unknown as ArrayLike<number | bigint>;
    return { tag: Object.prototype.toString.call(value), values: Array.from(elements) };
  }
  ancestors.add(value);
  let copy: unknown;
  if (Array.isArray(value)) {
    copy = value.map((entry: unknown, i) => copyValue(entry, ancestors, `${path}[${i}]`));
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(
        `snapshotValue: class instance at ${path} (${Object.prototype.toString.call(value)}); snapshot its plain fields instead`,
      );
    }
    const record: Record<string, unknown> = {};
    const source = value as Record<string, unknown>;
    for (const key of Object.keys(source).sort()) {
      record[key] = copyValue(source[key], ancestors, `${path}.${key}`);
    }
    copy = record;
  }
  ancestors.delete(value);
  return copy;
}

/** Asserts that `after` deep-equals `before`. `label` names the call that was checked. */
export function expectSnapshotUnchanged(before: unknown, after: unknown, label: string): void {
  expect(after, `${label} mutated its input`).toStrictEqual(before);
}
