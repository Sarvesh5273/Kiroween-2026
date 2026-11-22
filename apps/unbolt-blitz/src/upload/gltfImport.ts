import type { Material, Object3D, Texture } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SolveSource } from "../protocol";
import type { RecoveryCause } from "../recovery/recoveryCause";
import { objectToPayload } from "../scene/scenePayload";
import { classifyFile } from "./fileKind";

/** The part of `GLTFLoader` this module uses. Tests can pass a stand-in. */
export interface GltfParser {
  parseAsync(data: ArrayBuffer | string, path: string): Promise<{ scene: Object3D }>;
}

export type ImportFailure =
  | { reason: "unsupported-extension"; fileName: string }
  | { reason: "unreadable-file"; message: string }
  | { reason: "no-geometry"; detail: string };

export type ImportResult =
  | { ok: true; source: Extract<SolveSource, { kind: "scene" }>; transfer: ArrayBuffer[] }
  | { ok: false; failure: ImportFailure };

/** Both `unreadable-file` and `no-geometry` tell the player the file holds no playable geometry (Req 3.2). */
export function importFailureToRecoveryCause(failure: ImportFailure): RecoveryCause {
  switch (failure.reason) {
    case "unsupported-extension":
      return { reason: "unsupported-extension", fileName: failure.fileName };
    case "unreadable-file":
      return { reason: "no-geometry", detail: `The file could not be read: ${failure.message}` };
    case "no-geometry":
      return { reason: "no-geometry", detail: failure.detail };
  }
}

function errorMessage(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  return String(thrown);
}

function isTexture(value: unknown): value is Texture {
  return typeof value === "object" && value !== null && (value as Texture).isTexture === true;
}

function disposeTexture(texture: Texture): void {
  const image: unknown = texture.image;
  if (typeof image === "object" && image !== null && typeof (image as ImageBitmap).close === "function") {
    (image as ImageBitmap).close();
  }
  texture.dispose();
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (isTexture(value)) disposeTexture(value);
  }
  material.dispose();
}

/** Releases geometries, materials, textures, and image bitmaps of a loaded glTF scene. */
export function disposeLoadedScene(scene: Object3D): void {
  scene.traverse((node) => {
    const mesh = node as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };
    mesh.geometry?.dispose();
    if (mesh.material === undefined) return;
    if (Array.isArray(mesh.material)) mesh.material.forEach(disposeMaterial);
    else disposeMaterial(mesh.material);
  });
}

/**
 * Parses a dropped or selected file with `GLTFLoader` on the main thread and returns plain buffers
 * for the worker. The loaded scene is disposed before returning.
 */
export async function importGltfFile(
  file: File,
  loader: GltfParser = new GLTFLoader(),
): Promise<ImportResult> {
  if (classifyFile(file.name) === "unsupported") {
    return { ok: false, failure: { reason: "unsupported-extension", fileName: file.name } };
  }

  let scene: Object3D;
  try {
    const data = await file.arrayBuffer();
    scene = (await loader.parseAsync(data, "")).scene;
  } catch (thrown) {
    return { ok: false, failure: { reason: "unreadable-file", message: errorMessage(thrown) } };
  }

  try {
    const payload = objectToPayload(scene);
    if (payload.meshCount === 0) {
      return { ok: false, failure: { reason: "no-geometry", detail: "The file contains no meshes." } };
    }
    return {
      ok: true,
      source: { kind: "scene", fileName: file.name, scene: { root: payload.root, meshCount: payload.meshCount } },
      transfer: payload.transfer,
    };
  } finally {
    disposeLoadedScene(scene);
  }
}
