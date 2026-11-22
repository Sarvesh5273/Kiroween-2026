import {
  buildMechanicalKeyboard65,
  DEADLOCK_CAGES,
  KEYBOARD_FIXTURE_LAYOUT,
  SHOWCASE_KITS,
} from "@unboltkit/sample-kits";
import type { Group } from "three";
/**
 * The kits that the kit guarantee tests loop over: the three showcase kits and the two
 * Deadlock_Cages at default parameters, and the Keyboard_Fixture (Req 22.15 to 22.18, 23.11).
 * Names come from the kit registry, so no test spells a kit name itself.
 */
export interface KitCase {
  readonly name: string;
  readonly group: "showcase" | "cage" | "fixture";
  readonly build: () => Group;
}
export const KEYBOARD_FIXTURE_NAME = "keyboard-fixture";
export const KIT_CASES: readonly KitCase[] = [
  ...SHOWCASE_KITS.map((kit): KitCase => ({ name: kit.name, group: "showcase", build: kit.build })),
  ...DEADLOCK_CAGES.map((kit): KitCase => ({ name: kit.name, group: "cage", build: kit.build })),
  {
    name: KEYBOARD_FIXTURE_NAME,
    group: "fixture",
    build: () => buildMechanicalKeyboard65({ layout: KEYBOARD_FIXTURE_LAYOUT }),
  },
];
/** Every kit whose group is one of `groups`. */
export function kitsIn(...groups: KitCase["group"][]): KitCase[] {
  return KIT_CASES.filter((kit) => groups.includes(kit.group));
}
