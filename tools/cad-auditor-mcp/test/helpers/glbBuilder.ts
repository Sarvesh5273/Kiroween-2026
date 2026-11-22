/**
 * Builds real binary glTF 2.0 files in memory for the tests. Each box is a closed 24-vertex,
 * 12-triangle mesh with outward counter-clockwise winding and per-face normals.
 */

export interface BoxSpec {
  name: string;
  /** Half side length of the cube. */
  half: number;
  /** Local translation of the box's node. */
  translation: [number, number, number];
}

export interface GlbOptions {
  /** Local translation of an optional parent node that holds every box. */
  parentTranslation?: [number, number, number];
  parentName?: string;
}

/** Face frames `[normal, u, v]` with `u x v = normal`. */
const FACES: [number[], number[], number[]][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];
const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

export function boxData(half: number): { positions: Float32Array; normals: Float32Array; indices: Uint16Array } {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  FACES.forEach(([n, u, v], face) => {
    for (const [a, b] of CORNERS) {
      for (let axis = 0; axis < 3; axis++) {
        positions.push(((n[axis] as number) + a * (u[axis] as number) + b * (v[axis] as number)) * half);
        normals.push(n[axis] as number);
      }
    }
    const base = face * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

/** Wraps a JSON document and an optional BIN payload in the 12-byte header and chunk headers. */
export function packGlb(json: unknown, bin?: Uint8Array): Buffer {
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const chunks: Buffer[] = [chunk(0x4e4f534a, jsonPadded)];
  if (bin !== undefined) {
    const binBuffer = Buffer.from(bin);
    chunks.push(chunk(0x004e4942, Buffer.concat([binBuffer, Buffer.alloc((4 - (binBuffer.length % 4)) % 4, 0)])));
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

function chunk(type: number, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(data.length, 0);
  head.writeUInt32LE(type, 4);
  return Buffer.concat([head, data]);
}

/** A glTF document plus BIN payload for `boxes`, as separate pieces so tests can corrupt them. */
export function boxGltf(boxes: BoxSpec[], options: GlbOptions = {}): { json: Record<string, unknown>; bin: Buffer } {
  const bufferViews: unknown[] = [];
  const accessors: unknown[] = [];
  const meshes: unknown[] = [];
  const nodes: unknown[] = [];
  const parts: Buffer[] = [];
  let offset = 0;
  const addView = (bytes: Buffer): number => {
    const padded = Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4, 0)]);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    parts.push(padded);
    offset += padded.length;
    return bufferViews.length - 1;
  };
  const addAccessor = (view: number, componentType: number, count: number, type: string, extra: object = {}): number => {
    accessors.push({ bufferView: view, componentType, count, type, ...extra });
    return accessors.length - 1;
  };
  const boxNodeIndices: number[] = [];
  boxes.forEach((box, index) => {
    const data = boxData(box.half);
    const pos = addAccessor(addView(Buffer.from(data.positions.buffer)), 5126, 24, "VEC3", {
      min: [-box.half, -box.half, -box.half],
      max: [box.half, box.half, box.half],
    });
    const nor = addAccessor(addView(Buffer.from(data.normals.buffer)), 5126, 24, "VEC3");
    const idx = addAccessor(addView(Buffer.from(data.indices.buffer)), 5123, 36, "SCALAR");
    meshes.push({ name: `${box.name}_mesh`, primitives: [{ attributes: { POSITION: pos, NORMAL: nor }, indices: idx, mode: 4 }] });
    nodes.push({ name: box.name, mesh: index, translation: box.translation });
    boxNodeIndices.push(nodes.length - 1);
  });
  let sceneNodes = boxNodeIndices;
  if (options.parentTranslation !== undefined) {
    nodes.push({ name: options.parentName ?? "assembly", translation: options.parentTranslation, children: boxNodeIndices });
    sceneNodes = [nodes.length - 1];
  }
  const bin = Buffer.concat(parts);
  const json = {
    asset: { version: "2.0", generator: "cad-auditor-mcp tests" },
    scene: 0,
    scenes: [{ name: "test_scene", nodes: sceneNodes }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  return { json, bin };
}

export function buildBoxGlb(boxes: BoxSpec[], options: GlbOptions = {}): Buffer {
  const { json, bin } = boxGltf(boxes, options);
  return packGlb(json, bin);
}

/** The standard two-part fixture: a base plate and a cover that floats above it, under a parent node. */
export const TWO_PART_BOXES: BoxSpec[] = [
  { name: "base_plate", half: 1, translation: [0, 0, 0] },
  { name: "top_cover", half: 0.5, translation: [0, 3, 0] },
];
export const TWO_PART_OPTIONS: GlbOptions = { parentTranslation: [10, 0, 0], parentName: "assembly" };
