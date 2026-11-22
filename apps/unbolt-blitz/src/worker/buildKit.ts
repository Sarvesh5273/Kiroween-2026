import type { Object3D } from "three";
import { DEADLOCK_CAGES, SHOWCASE_KITS } from "@unboltkit/sample-kits";
import { findBundledLevel } from "../levels";
import type { BundledLevelId } from "../protocol";

export class UnknownKitError extends Error {
  readonly levelId: string;

  constructor(levelId: string, detail: string) {
    super(`Unknown bundled level "${levelId}": ${detail}`);
    this.name = "UnknownKitError";
    this.levelId = levelId;
  }
}

/** Builds the procedural assembly of a bundled level with its default parameters. */
export function buildKit(levelId: BundledLevelId): Object3D {
  const level = findBundledLevel(levelId);
  if (level === undefined) {
    throw new UnknownKitError(levelId, "no entry in BUNDLED_LEVELS");
  }
  const entry = [...SHOWCASE_KITS, ...DEADLOCK_CAGES].find((kit) => kit.name === level.kitName);
  if (entry === undefined) {
    throw new UnknownKitError(levelId, `no kit named "${level.kitName}" in @unboltkit/sample-kits`);
  }
  return entry.build();
}
