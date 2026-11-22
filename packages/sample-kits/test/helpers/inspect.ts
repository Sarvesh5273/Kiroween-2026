import { type Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, type Object3D } from "three";

/** Every descendant mesh in pre-order traversal order. */
export function meshesOf(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if ((node as Mesh).isMesh === true) meshes.push(node as Mesh);
  });
  return meshes;
}

/** Names of every node whose value is a texture (`isTexture === true`), for an untextured check. */
export function textureSlots(material: Material): string[] {
  const slots: string[] = [];
  for (const [key, value] of Object.entries(material)) {
    if (value !== null && typeof value === "object" && (value as { isTexture?: unknown }).isTexture === true) slots.push(key);
  }
  return slots;
}

/** True for exactly one `MeshStandardMaterial` or `MeshPhysicalMaterial` instance (not an array). */
export function isSinglePbrMaterial(material: Mesh["material"]): material is MeshStandardMaterial {
  return !Array.isArray(material) && (material instanceof MeshStandardMaterial || material instanceof MeshPhysicalMaterial);
}

/**
 * A byte-level fingerprint of a hierarchy for the determinism comparison (Req 3.8, 22.8): node
 * names in traversal order, world matrices, and the raw bytes of every position, normal and index
 * buffer. `uuid` and `id` are excluded.
 */
export function fingerprint(root: Object3D): { names: string[]; matrices: number[][]; buffers: Uint8Array[] } {
  root.updateMatrixWorld(true);
  const names: string[] = [];
  const matrices: number[][] = [];
  const buffers: Uint8Array[] = [];
  root.traverse((node) => {
    names.push(node.name);
    matrices.push(Array.from(node.matrixWorld.elements));
    const mesh = node as Mesh;
    if (mesh.isMesh === true) {
      const geometry = mesh.geometry;
      for (const attribute of [geometry.getAttribute("position"), geometry.getAttribute("normal"), geometry.index]) {
        if (attribute === null || attribute === undefined) {
          buffers.push(new Uint8Array(0));
          continue;
        }
        const array = attribute.array as ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
        buffers.push(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      }
    }
  });
  return { names, matrices, buffers };
}
