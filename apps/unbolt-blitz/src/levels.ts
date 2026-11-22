import type { BundledLevelId } from "./protocol";

/** Plain data table of the five bundled levels. */
export interface BundledLevel {
  id: BundledLevelId;
  label: string;
  /** `name` of the matching entry in `SHOWCASE_KITS` or `DEADLOCK_CAGES`. */
  kitName: string;
}

export const BUNDLED_LEVELS: readonly BundledLevel[] = [
  { id: "lockbox", label: "Lockbox", kitName: "haunted-clockwork-lockbox" },
  { id: "planetary-gearbox", label: "Planetary Gearbox", kitName: "planetary-gearbox-3-stage" },
  { id: "keyboard-65", label: "65% Keyboard", kitName: "mechanical-keyboard-65" },
  { id: "dumbbell-cage", label: "Dumbbell Cage", kitName: "deadlock-cage-dumbbell-ring" },
  { id: "ship-in-bottle", label: "Ship-in-Bottle", kitName: "deadlock-cage-ship-in-bottle" },
];

/** The level loaded automatically on start. */
export const DEFAULT_LEVEL_ID: BundledLevelId = "lockbox";

export function findBundledLevel(id: BundledLevelId): BundledLevel | undefined {
  return BUNDLED_LEVELS.find((level) => level.id === id);
}
