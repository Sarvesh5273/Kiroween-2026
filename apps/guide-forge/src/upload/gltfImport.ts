/**
 * glTF import on the Main_Thread.
 *
 * `importGltfFile` classifies the file name, reads the file, parses it with Three `GLTFLoader`
 * (Requirement 7.4), converts the loaded scene to a `ScenePayload` with `objectToPayload`
 * (Requirements 7.5, 7.6, 7.7) and disposes the loaded scene. Every unusable outcome becomes a
 * Recovery_Card: an unsupported extension (7.10), a loader failure carrying the loader message
 * (7.11) and a scene without a mesh (7.12, no solve request is built).
 *
 * This is the only module that imports `GLTFLoader`. The loader is injectable so tests can run
 * in Node with a stub parser.
 */
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Object3D } from "three";
import type { SolveLabel, SolveSource } from "../protocol";
import { objectToPayload } from "../scene/scenePayload";
import {
  buildEmptyAssemblyCard,
  buildLoaderFailureCard,
  buildUnsupportedFileCard,
  classifyFile,
} from "../state/recovery";
import type { RecoveryCard } from "../state/types";

/** The part of `GLTFLoader` that the import uses. */
export interface GltfParser {
  parseAsync(data: ArrayBuffer, path: string): Promise<{ scene: Object3D }>;
}

/** A solve request that is ready for `SolverClient.solve(source, label, transfer)`. */
export interface ImportSuccess {
  ok: true;
  source: Extract<SolveSource, { kind: "scene" }>;
  label: Extract<SolveLabel, { kind: "file" }>;
  /** The `ArrayBuffer` of every typed array in the payload, each listed once. */
  transfer: Transferable[];
}

export interface ImportFailure {
  ok: false;
  card: RecoveryCard;
}

export type ImportOutcome = ImportSuccess | ImportFailure;

function errorMessage(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.message;
  }
  return String(thrown);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasDispose(value: unknown): value is { dispose(): void } {
  return isRecord(value) && typeof value["dispose"] === "function";
}

function isTexture(value: unknown): value is { isTexture: true; image?: unknown; dispose(): void } {
  return isRecord(value) && value["isTexture"] === true && hasDispose(value);
}

function closeBitmap(image: unknown): void {
  if (isRecord(image) && typeof image["close"] === "function") {
    (image as { close(): void }).close();
  }
}

function disposeTexture(texture: { image?: unknown; dispose(): void }): void {
  closeBitmap(texture.image);
  texture.dispose();
}

function disposeMaterial(material: unknown): void {
  if (!isRecord(material)) {
    return;
  }
  for (const value of Object.values(material)) {
    if (isTexture(value)) {
      disposeTexture(value);
    }
  }
  if (hasDispose(material)) {
    material.dispose();
  }
}

/**
 * Releases the geometries, materials and textures of a loaded glTF scene, and closes
 * `ImageBitmap` images when present. Safe to call on a scene whose buffers were already copied.
 */
export function disposeLoadedScene(root: Object3D): void {
  root.traverse((object) => {
    const holder = object as unknown as Record<string, unknown>;
    const geometry = holder["geometry"];
    if (hasDispose(geometry)) {
      geometry.dispose();
    }
    const material = holder["material"];
    if (Array.isArray(material)) {
      for (const entry of material) {
        disposeMaterial(entry);
      }
    } else {
      disposeMaterial(material);
    }
  });
}

/**
 * Imports a `.glb` or `.gltf` file.
 *
 * Returns a solve request (`source`, `label`, `transfer`) when the file parses and holds at
 * least one mesh, and otherwise a Recovery_Card. The loaded scene is disposed before returning.
 */
export async function importGltfFile(file: File, loader?: GltfParser): Promise<ImportOutcome> {
  if (classifyFile(file.name) === "unsupported") {
    return { ok: false, card: buildUnsupportedFileCard(file.name) };
  }

  const parser: GltfParser = loader ?? new GLTFLoader();

  let scene: Object3D;
  try {
    const buffer = await file.arrayBuffer();
    scene = (await parser.parseAsync(buffer, "")).scene;
  } catch (thrown) {
    return { ok: false, card: buildLoaderFailureCard(errorMessage(thrown)) };
  }

  try {
    const { root, meshCount, transfer } = objectToPayload(scene);
    if (meshCount === 0) {
      return { ok: false, card: buildEmptyAssemblyCard() };
    }
    return {
      ok: true,
      source: { kind: "scene", fileName: file.name, scene: { root, meshCount } },
      label: { kind: "file", fileName: file.name },
      transfer,
    };
  } finally {
    disposeLoadedScene(scene);
  }
}
