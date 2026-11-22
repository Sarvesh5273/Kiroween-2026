/**
 * The five bundled kit names, their human titles and the Kit_Selector groups.
 *
 * Plain data only. This module imports nothing, so the main-thread bundle does not pull in the
 * Sample_Kits builders (they run in the Solver_Worker). A unit test checks that `KIT_NAMES`
 * matches the names in `SHOWCASE_KITS` and `DEADLOCK_CAGES` from `@unboltkit/sample-kits`.
 */

/** Showcase kits, in Sample_Kits `SHOWCASE_KITS` order. */
export const SHOWCASE_KIT_NAMES = [
  "mechanical-keyboard-65",
  "planetary-gearbox-3-stage",
  "haunted-clockwork-lockbox",
] as const;

/** Deadlock cages, in Sample_Kits `DEADLOCK_CAGES` order. */
export const DEADLOCK_CAGE_NAMES = [
  "deadlock-cage-dumbbell-ring",
  "deadlock-cage-ship-in-bottle",
] as const;

/** All five kit names: the Showcase kits first, then the Deadlock cages. */
export const KIT_NAMES = [...SHOWCASE_KIT_NAMES, ...DEADLOCK_CAGE_NAMES] as const;

export type KitName = (typeof KIT_NAMES)[number];

/** The kit opened on first load and offered by every Recovery_Card. */
export const DEFAULT_KIT_NAME: KitName = "mechanical-keyboard-65";

/** Human-friendly title per kit name. */
export const KIT_TITLES: Readonly<Record<KitName, string>> = {
  "mechanical-keyboard-65": "Mechanical Keyboard 65%",
  "planetary-gearbox-3-stage": "Planetary Gearbox (3-Stage)",
  "haunted-clockwork-lockbox": "Haunted Clockwork Lockbox",
  "deadlock-cage-dumbbell-ring": "Deadlock Cage: Dumbbell and Ring",
  "deadlock-cage-ship-in-bottle": "Deadlock Cage: Ship in a Bottle",
};

export interface KitGroup {
  /** Group label shown in the Kit_Selector. */
  readonly label: "Showcase" | "Deadlock Cage";
  readonly kitNames: readonly KitName[];
}

/** Kit_Selector groups, in display order. */
export const KIT_GROUPS: readonly KitGroup[] = [
  { label: "Showcase", kitNames: SHOWCASE_KIT_NAMES },
  { label: "Deadlock Cage", kitNames: DEADLOCK_CAGE_NAMES },
];
