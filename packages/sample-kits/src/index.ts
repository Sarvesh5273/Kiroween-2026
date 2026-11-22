/**
 * Public API of `@unboltkit/sample-kits`: five deterministic procedural assemblies built in code
 * with `three` only (Req 22, 23, 24).
 */
import type { Group } from "three";
import { buildDeadlockCageDumbbellRing } from "./cageDumbbellRing";
import { buildDeadlockCageShipInBottle } from "./cageShipInBottle";
import { buildHauntedClockworkLockbox } from "./hauntedLockbox";
import { buildMechanicalKeyboard65, KEYBOARD_FIXTURE_LAYOUT, type KeyboardLayout } from "./keyboard65";
import { buildPlanetaryGearbox3Stage } from "./planetaryGearbox";

export {
  buildDeadlockCageDumbbellRing,
  buildDeadlockCageShipInBottle,
  buildHauntedClockworkLockbox,
  buildMechanicalKeyboard65,
  buildPlanetaryGearbox3Stage,
  KEYBOARD_FIXTURE_LAYOUT,
};
export { KitParameterError } from "./shared/params";
export { MESH_NAME_PATTERN } from "./shared/naming";
export type { KeyboardLayout };

/** Parameters of {@link buildMechanicalKeyboard65}. */
export interface MechanicalKeyboard65Params {
  /** `'full65'` (default) or a grid of integer `rows` 1..5 by `columns` 1..15. */
  layout?: KeyboardLayout;
}
/** Parameters of {@link buildPlanetaryGearbox3Stage}. */
export interface PlanetaryGearbox3StageParams {
  /** Integer 3..6, default 3. */
  planetsPerStage?: number;
}
/** Parameters of {@link buildHauntedClockworkLockbox}. */
export interface HauntedClockworkLockboxParams {
  /** Integer 2..5, default 3. */
  gearCount?: number;
}
/** {@link buildDeadlockCageDumbbellRing} takes no parameters. */
export type DeadlockCageDumbbellRingParams = Record<string, never>;
/** Parameters of {@link buildDeadlockCageShipInBottle}. */
export interface DeadlockCageShipInBottleParams {
  /** Integer 1..3, default 2. */
  ballCount?: number;
}

/** A registry entry: a stable kit name and its builder called with default parameters. */
export interface KitEntry {
  readonly name: string;
  readonly build: () => Group;
}

/** The three showcase kits (Req 23). */
export const SHOWCASE_KITS: readonly KitEntry[] = Object.freeze([
  Object.freeze({ name: "mechanical-keyboard-65", build: () => buildMechanicalKeyboard65() }),
  Object.freeze({ name: "planetary-gearbox-3-stage", build: () => buildPlanetaryGearbox3Stage() }),
  Object.freeze({ name: "haunted-clockwork-lockbox", build: () => buildHauntedClockworkLockbox() }),
]);

/** The two Deadlock_Cages (Req 24). */
export const DEADLOCK_CAGES: readonly KitEntry[] = Object.freeze([
  Object.freeze({ name: "deadlock-cage-dumbbell-ring", build: () => buildDeadlockCageDumbbellRing() }),
  Object.freeze({ name: "deadlock-cage-ship-in-bottle", build: () => buildDeadlockCageShipInBottle() }),
]);
