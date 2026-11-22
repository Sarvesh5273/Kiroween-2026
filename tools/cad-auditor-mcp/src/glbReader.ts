/**
 * Pure-Node binary glTF 2.0 (`.glb`) reader.
 *
 * Reads the 12-byte header, the JSON chunk and the optional BIN chunk, then builds a
 * `THREE.Group` that mirrors the node hierarchy: each glTF node becomes an `Object3D` with its
 * local translation, rotation and scale, and each triangle primitive becomes a `Mesh` with a
 * `BufferGeometry` (positions, optional normals, optional indices).
 *
 * It touches no DOM, WebGL, `Image` or `Blob` API. Textures, images and animations are ignored,
 * so it runs in headless Node. Materials are a plain `MeshStandardMaterial`. External buffer
 * files are not supported: a `.glb` carries its data in the BIN chunk (or in `data:` URIs).
 *
 * Every malformed input throws a {@link GlbParseError}. Nothing is swallowed.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from "three";

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const MODE_TRIANGLES = 4;

/** Thrown for any `.glb` that is not a valid, supported glTF 2.0 binary. */
export class GlbParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlbParseError";
  }
}

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}
interface GltfPrimitive {
  attributes?: Record<string, number>;
  indices?: number;
  mode?: number;
}
interface GltfMesh {
  name?: string;
  primitives?: GltfPrimitive[];
}
interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  normalized?: boolean;
  count?: number;
  type?: string;
  sparse?: unknown;
}
interface GltfBufferView {
  buffer?: number;
  byteOffset?: number;
  byteLength?: number;
  byteStride?: number;
}
interface GltfBuffer {
  byteLength?: number;
  uri?: string;
}
interface GltfDocument {
  asset?: { version?: string };
  scene?: number;
  scenes?: { name?: string; nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: GltfBuffer[];
}

interface ComponentInfo {
  size: number;
  read: (view: DataView, offset: number) => number;
  /** Divisor that maps a normalized integer to [-1, 1] or [0, 1]. */
  normalizer: number | null;
}

const COMPONENTS: Record<number, ComponentInfo> = {
  5120: { size: 1, read: (v, o) => v.getInt8(o), normalizer: 127 },
  5121: { size: 1, read: (v, o) => v.getUint8(o), normalizer: 255 },
  5122: { size: 2, read: (v, o) => v.getInt16(o, true), normalizer: 32767 },
  5123: { size: 2, read: (v, o) => v.getUint16(o, true), normalizer: 65535 },
  5125: { size: 4, read: (v, o) => v.getUint32(o, true), normalizer: null },
  5126: { size: 4, read: (v, o) => v.getFloat32(o, true), normalizer: null },
};

const TYPE_WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function fail(message: string): never {
  throw new GlbParseError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireIndex(value: unknown, length: number, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= length) {
    fail(`${what} must be an integer index below ${length}, received ${String(value)}`);
  }
  return value;
}

function requireNumbers(value: unknown, length: number, what: string): number[] {
  if (!Array.isArray(value) || value.length !== length || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    fail(`${what} must be an array of ${length} finite numbers`);
  }
  return value as number[];
}

interface Chunks {
  json: Uint8Array;
  bin: Uint8Array | undefined;
}

function readChunks(bytes: Uint8Array): Chunks {
  if (bytes.byteLength < HEADER_BYTES) {
    fail(`GLB is truncated: ${bytes.byteLength} bytes is smaller than the 12-byte header`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    fail(`Invalid GLB magic 0x${magic.toString(16).padStart(8, "0")}, expected 0x46546c67 ("glTF")`);
  }
  const version = view.getUint32(4, true);
  if (version !== GLB_VERSION) {
    fail(`Unsupported GLB version ${version}, only version 2 is supported`);
  }
  const totalLength = view.getUint32(8, true);
  if (totalLength > bytes.byteLength) {
    fail(`GLB is truncated: header declares ${totalLength} bytes but only ${bytes.byteLength} are present`);
  }
  if (totalLength < HEADER_BYTES) {
    fail(`GLB header declares an impossible length of ${totalLength} bytes`);
  }
  let json: Uint8Array | undefined;
  let bin: Uint8Array | undefined;
  let offset = HEADER_BYTES;
  let chunkIndex = 0;
  while (offset < totalLength) {
    if (offset + CHUNK_HEADER_BYTES > totalLength) {
      fail(`GLB is truncated: chunk ${chunkIndex} header is cut off at byte ${offset}`);
    }
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + CHUNK_HEADER_BYTES;
    const end = start + chunkLength;
    if (end > totalLength) {
      fail(`GLB is truncated: chunk ${chunkIndex} declares ${chunkLength} bytes but only ${totalLength - start} remain`);
    }
    const data = bytes.subarray(start, end);
    if (chunkIndex === 0) {
      if (chunkType !== CHUNK_JSON) {
        fail("The first GLB chunk must be the JSON chunk");
      }
      json = data;
    } else if (chunkType === CHUNK_BIN && bin === undefined) {
      bin = data;
    }
    // Other chunk types are reserved for extensions and are skipped, as the spec requires.
    offset = end;
    chunkIndex += 1;
  }
  if (json === undefined) {
    fail("GLB has no JSON chunk");
  }
  return { json, bin };
}

function parseJson(json: Uint8Array): GltfDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return fail(`GLB JSON chunk is not valid JSON: ${reason}`);
  }
  if (!isRecord(parsed)) {
    fail("GLB JSON chunk must hold an object");
  }
  const doc = parsed as GltfDocument;
  const version = doc.asset?.version;
  if (typeof version !== "string" || !version.startsWith("2")) {
    fail(`glTF asset.version must be "2.x", received ${JSON.stringify(version)}`);
  }
  return doc;
}

/** Resolves every glTF buffer to bytes. Buffer 0 without a `uri` is the BIN chunk. */
function resolveBuffers(doc: GltfDocument, bin: Uint8Array | undefined): Uint8Array[] {
  const buffers = doc.buffers ?? [];
  return buffers.map((buffer, index) => {
    let bytes: Uint8Array;
    if (buffer.uri === undefined) {
      if (index !== 0 || bin === undefined) {
        return fail(`buffers[${index}] has no uri and there is no BIN chunk to back it`);
      }
      bytes = bin;
    } else if (buffer.uri.startsWith("data:")) {
      const comma = buffer.uri.indexOf(",");
      if (comma < 0 || !buffer.uri.slice(0, comma).endsWith(";base64")) {
        return fail(`buffers[${index}] uses a data URI that is not base64`);
      }
      bytes = new Uint8Array(Buffer.from(buffer.uri.slice(comma + 1), "base64"));
    } else {
      return fail(`buffers[${index}] references the external file "${buffer.uri}", which a .glb reader cannot load`);
    }
    if (typeof buffer.byteLength !== "number" || buffer.byteLength > bytes.byteLength) {
      return fail(`buffers[${index}].byteLength ${String(buffer.byteLength)} exceeds the ${bytes.byteLength} bytes available`);
    }
    return bytes;
  });
}

/** Reads an accessor into a flat array of numbers (`count * width` entries). */
function readAccessor(doc: GltfDocument, buffers: Uint8Array[], accessorIndex: number, allowedTypes: string[]): { values: number[]; width: number } {
  const accessors = doc.accessors ?? [];
  const accessor = accessors[requireIndex(accessorIndex, accessors.length, "accessor index")] as GltfAccessor;
  const label = `accessors[${accessorIndex}]`;
  if (accessor.sparse !== undefined) {
    fail(`${label} uses sparse storage, which is not supported`);
  }
  const type = accessor.type;
  if (typeof type !== "string" || !allowedTypes.includes(type)) {
    fail(`${label}.type must be one of ${allowedTypes.join(", ")}, received ${JSON.stringify(type)}`);
  }
  const width = TYPE_WIDTH[type] as number;
  const component = COMPONENTS[accessor.componentType ?? -1];
  if (component === undefined) {
    return fail(`${label}.componentType ${String(accessor.componentType)} is not supported`);
  }
  const count = accessor.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    fail(`${label}.count must be a non-negative integer`);
  }
  if (accessor.bufferView === undefined) {
    // The spec defines a missing bufferView as all zeros.
    return { values: new Array<number>(count * width).fill(0), width };
  }
  const views = doc.bufferViews ?? [];
  const view = views[requireIndex(accessor.bufferView, views.length, `${label}.bufferView`)] as GltfBufferView;
  const buffer = buffers[requireIndex(view.buffer, buffers.length, `bufferViews[${accessor.bufferView}].buffer`)] as Uint8Array;
  const viewStart = view.byteOffset ?? 0;
  const viewLength = view.byteLength;
  if (typeof viewLength !== "number" || viewStart < 0 || viewLength < 0 || viewStart + viewLength > buffer.byteLength) {
    fail(`bufferViews[${accessor.bufferView}] range lies outside its buffer`);
  }
  const elementBytes = component.size * width;
  const stride = view.byteStride ?? elementBytes;
  if (stride < elementBytes) {
    fail(`bufferViews[${accessor.bufferView}].byteStride ${stride} is smaller than one element (${elementBytes} bytes)`);
  }
  const accessorOffset = accessor.byteOffset ?? 0;
  const lastEnd = count === 0 ? 0 : accessorOffset + (count - 1) * stride + elementBytes;
  if (accessorOffset < 0 || lastEnd > viewLength) {
    fail(`${label} reads ${lastEnd} bytes but its bufferView holds ${viewLength}`);
  }
  const data = new DataView(buffer.buffer, buffer.byteOffset + viewStart, viewLength);
  const normalize = accessor.normalized === true && component.normalizer !== null;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const base = accessorOffset + i * stride;
    for (let c = 0; c < width; c++) {
      const raw = component.read(data, base + c * component.size);
      values.push(normalize ? Math.max(raw / (component.normalizer as number), -1) : raw);
    }
  }
  return { values, width };
}

function buildGeometry(doc: GltfDocument, buffers: Uint8Array[], primitive: GltfPrimitive, label: string): BufferGeometry {
  const positionIndex = primitive.attributes?.POSITION;
  if (positionIndex === undefined) {
    fail(`${label} has no POSITION attribute`);
  }
  const positions = readAccessor(doc, buffers, positionIndex, ["VEC3"]);
  const vertexCount = positions.values.length / 3;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions.values), 3));
  const normalIndex = primitive.attributes?.NORMAL;
  if (normalIndex !== undefined) {
    const normals = readAccessor(doc, buffers, normalIndex, ["VEC3"]);
    if (normals.values.length !== positions.values.length) {
      fail(`${label} has ${normals.values.length / 3} normals for ${vertexCount} positions`);
    }
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals.values), 3));
  }
  if (primitive.indices !== undefined) {
    const indices = readAccessor(doc, buffers, primitive.indices, ["SCALAR"]).values;
    if (indices.length % 3 !== 0) {
      fail(`${label} has ${indices.length} indices, which is not a multiple of 3`);
    }
    for (const index of indices) {
      if (index >= vertexCount) {
        fail(`${label} has index ${index} but only ${vertexCount} vertices`);
      }
    }
    geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  } else if (vertexCount % 3 !== 0) {
    fail(`${label} is non-indexed with ${vertexCount} vertices, which is not a multiple of 3`);
  }
  return geometry;
}

function applyLocalTransform(object: Object3D, node: GltfNode, label: string): void {
  if (node.matrix !== undefined) {
    const matrix = new Matrix4().fromArray(requireNumbers(node.matrix, 16, `${label}.matrix`));
    matrix.decompose(object.position, object.quaternion, object.scale);
    return;
  }
  if (node.translation !== undefined) {
    const [x, y, z] = requireNumbers(node.translation, 3, `${label}.translation`) as [number, number, number];
    object.position.set(x, y, z);
  }
  if (node.rotation !== undefined) {
    const [x, y, z, w] = requireNumbers(node.rotation, 4, `${label}.rotation`) as [number, number, number, number];
    object.quaternion.set(x, y, z, w).normalize();
  }
  if (node.scale !== undefined) {
    const [x, y, z] = requireNumbers(node.scale, 3, `${label}.scale`) as [number, number, number];
    object.scale.set(x, y, z);
  }
}

/**
 * Parses a `.glb` (glTF 2.0 binary) into a `THREE.Group`.
 *
 * - A node with one triangle primitive becomes a `Mesh` that carries the node's name and local
 *   TRS. A node with several primitives becomes an `Object3D` whose children are one `Mesh` per
 *   primitive, named `<node>_<n>`. A node without a mesh becomes a plain `Object3D`.
 * - Primitives whose mode is not TRIANGLES are skipped and listed in `group.userData.glbWarnings`.
 * - A node reached twice (instancing) is expanded into two separate objects.
 *
 * @throws GlbParseError on a bad magic, version, length, chunk, JSON, accessor or hierarchy.
 */
export function parseGlb(input: Uint8Array): Group {
  const { json, bin } = readChunks(input);
  const doc = parseJson(json);
  const buffers = resolveBuffers(doc, bin);
  const nodes = doc.nodes ?? [];
  const meshes = doc.meshes ?? [];
  const warnings: string[] = [];
  const material = new MeshStandardMaterial({ name: "glb_default" });

  const buildNode = (index: number, ancestors: ReadonlySet<number>): Object3D => {
    const label = `nodes[${index}]`;
    const rawNode: unknown = nodes[index];
    if (!isRecord(rawNode)) {
      fail(`${label} must be an object`);
    }
    const node = rawNode as GltfNode;
    if (ancestors.has(index)) {
      fail(`${label} is its own ancestor, so the node hierarchy has a cycle`);
    }
    const name = typeof node.name === "string" ? node.name : "";
    let object: Object3D;
    if (node.mesh === undefined) {
      object = new Object3D();
    } else {
      const meshDef = meshes[requireIndex(node.mesh, meshes.length, `${label}.mesh`)] as GltfMesh;
      const triangleSets: { geometry: BufferGeometry; primitiveIndex: number }[] = [];
      (meshDef.primitives ?? []).forEach((primitive, primitiveIndex) => {
        const mode = primitive.mode ?? MODE_TRIANGLES;
        const primitiveLabel = `meshes[${node.mesh}].primitives[${primitiveIndex}]`;
        if (mode !== MODE_TRIANGLES) {
          warnings.push(`${primitiveLabel} skipped: mode ${mode} is not TRIANGLES`);
          return;
        }
        triangleSets.push({ geometry: buildGeometry(doc, buffers, primitive, primitiveLabel), primitiveIndex });
      });
      if (triangleSets.length === 1) {
        object = new Mesh((triangleSets[0] as { geometry: BufferGeometry }).geometry, material);
      } else {
        object = new Object3D();
        triangleSets.forEach((set, n) => {
          const child = new Mesh(set.geometry, material);
          child.name = `${name || meshDef.name || "mesh"}_${n + 1}`;
          object.add(child);
        });
      }
    }
    object.name = name;
    applyLocalTransform(object, node, label);
    const lineage = new Set(ancestors).add(index);
    for (const childIndex of node.children ?? []) {
      object.add(buildNode(requireIndex(childIndex, nodes.length, `${label}.children entry`), lineage));
    }
    return object;
  };

  const root = new Group();
  let rootNodes: number[];
  const scenes = doc.scenes ?? [];
  if (scenes.length > 0) {
    const sceneIndex = requireIndex(doc.scene ?? 0, scenes.length, "scene");
    const scene = scenes[sceneIndex] as { name?: string; nodes?: number[] };
    root.name = typeof scene.name === "string" ? scene.name : "";
    rootNodes = scene.nodes ?? [];
  } else {
    const referenced = new Set<number>();
    for (const node of nodes) {
      for (const child of node.children ?? []) {
        referenced.add(child);
      }
    }
    rootNodes = nodes.map((_, index) => index).filter((index) => !referenced.has(index));
  }
  for (const index of rootNodes) {
    root.add(buildNode(requireIndex(index, nodes.length, "scene root node"), new Set<number>()));
  }
  root.userData["glbWarnings"] = warnings;
  return root;
}
