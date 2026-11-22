import fc from "fast-check";
import type { Group } from "three";
import {
  buildDeadlockCageDumbbellRing,
  buildDeadlockCageShipInBottle,
  buildHauntedClockworkLockbox,
  buildMechanicalKeyboard65,
  buildPlanetaryGearbox3Stage,
} from "../../src/index";

/** A Kit_Builder called with an arbitrary (possibly invalid) parameter object. */
export type AnyBuilder = (params?: unknown) => Group;

const builders = {
  keyboard: buildMechanicalKeyboard65 as AnyBuilder,
  gearbox: buildPlanetaryGearbox3Stage as AnyBuilder,
  lockbox: buildHauntedClockworkLockbox as AnyBuilder,
  dumbbell: buildDeadlockCageDumbbellRing as AnyBuilder,
  bottle: buildDeadlockCageShipInBottle as AnyBuilder,
} as const;
export type KitKey = keyof typeof builders;

export interface ValidKitCase {
  kit: KitKey;
  build: AnyBuilder;
  /** `undefined` calls the builder with no argument. */
  params: Record<string, unknown> | undefined;
  /** Set for keyboard grids: the expected number of keycaps and switches. */
  grid?: { rows: number; columns: number };
}

export interface InvalidKitCase {
  kit: KitKey;
  build: AnyBuilder;
  params: unknown;
  /** The parameter the thrown `KitParameterError` must name. */
  param: string;
}

const integerKit = (kit: KitKey, key: string, min: number, max: number): fc.Arbitrary<ValidKitCase> =>
  fc.oneof(
    fc.constant<ValidKitCase>({ kit, build: builders[kit], params: undefined }),
    fc.constant<ValidKitCase>({ kit, build: builders[kit], params: {} }),
    fc.integer({ min, max }).map((value): ValidKitCase => ({ kit, build: builders[kit], params: { [key]: value } })),
  );

/** Every keyboard grid of 1 to 5 rows by 1 to 15 columns, plus the default 65% layout. */
export const keyboardGridArbitrary: fc.Arbitrary<ValidKitCase> = fc
  .record({ rows: fc.integer({ min: 1, max: 5 }), columns: fc.integer({ min: 1, max: 15 }) })
  .map((grid): ValidKitCase => ({ kit: "keyboard", build: builders.keyboard, params: { layout: { ...grid } }, grid }));

/** Valid parameter objects for every Kit_Builder (Property 38). */
export const validKitArbitrary: fc.Arbitrary<ValidKitCase> = fc.oneof(
  { arbitrary: keyboardGridArbitrary, weight: 4 },
  {
    arbitrary: fc.constantFrom<ValidKitCase>(
      { kit: "keyboard", build: builders.keyboard, params: undefined },
      { kit: "keyboard", build: builders.keyboard, params: { layout: "full65" } },
    ),
    weight: 1,
  },
  { arbitrary: integerKit("gearbox", "planetsPerStage", 3, 6), weight: 2 },
  { arbitrary: integerKit("lockbox", "gearCount", 2, 5), weight: 2 },
  { arbitrary: integerKit("bottle", "ballCount", 1, 3), weight: 2 },
  {
    arbitrary: fc.constantFrom<ValidKitCase>(
      { kit: "dumbbell", build: builders.dumbbell, params: undefined },
      { kit: "dumbbell", build: builders.dumbbell, params: {} },
    ),
    weight: 1,
  },
);

/** Values that are not numbers at all. */
const wrongType = fc.oneof(
  fc.string({ maxLength: 6 }),
  fc.boolean(),
  fc.constant(null),
  fc.constant([] as unknown[]),
  fc.constant({} as Record<string, unknown>),
  fc.bigInt({ min: 0n, max: 9n }),
);

/** A single invalid value for an integer parameter documented as `min..max`. */
function invalidInteger(min: number, max: number): fc.Arbitrary<unknown> {
  return fc.oneof(
    wrongType,
    fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    fc.double({ min, max, noNaN: true }).filter((x) => !Number.isInteger(x)),
    fc.integer({ min: -1000, max: min - 1 }),
    fc.integer({ min: max + 1, max: 1000 }),
  );
}

/** An unknown key that no builder accepts. */
const unknownKey = fc.constantFrom("rows", "columns", "seed", "scale", "teeth", "planets", "gear_count", "Layout");

function integerKitInvalid(kit: KitKey, key: string, min: number, max: number): fc.Arbitrary<InvalidKitCase> {
  return fc.oneof(
    invalidInteger(min, max).map((value): InvalidKitCase => ({ kit, build: builders[kit], params: { [key]: value }, param: key })),
    fc
      .tuple(unknownKey.filter((k) => k !== key), fc.integer({ min, max }))
      .map(([extra, value]): InvalidKitCase => ({ kit, build: builders[kit], params: { [extra]: value }, param: extra })),
  );
}

const keyboardInvalid: fc.Arbitrary<InvalidKitCase> = fc.oneof(
  // The layout itself has the wrong type or is an unknown preset.
  fc
    .oneof(fc.string({ maxLength: 8 }).filter((s) => s !== "full65"), fc.integer(), fc.boolean(), fc.constant(null), fc.constant([3, 2]))
    .map((layout): InvalidKitCase => ({ kit: "keyboard", build: builders.keyboard, params: { layout }, param: "layout" })),
  // Exactly one invalid grid field; the other is valid.
  fc
    .tuple(fc.constantFrom("rows" as const, "columns" as const), fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 15 }))
    .chain(([field, rows, columns]) =>
      invalidInteger(1, field === "rows" ? 5 : 15).map((bad): InvalidKitCase => ({
        kit: "keyboard",
        build: builders.keyboard,
        params: { layout: { rows: field === "rows" ? bad : rows, columns: field === "columns" ? bad : columns } },
        param: `layout.${field}`,
      })),
    ),
  // An unknown key inside the layout.
  fc
    .tuple(fc.constantFrom("depth", "keys", "u"), fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 15 }))
    .map(([extra, rows, columns]): InvalidKitCase => ({
      kit: "keyboard",
      build: builders.keyboard,
      params: { layout: { rows, columns, [extra]: 1 } },
      param: `layout.${extra}`,
    })),
  // An unknown top-level key.
  unknownKey.map((extra): InvalidKitCase => ({ kit: "keyboard", build: builders.keyboard, params: { [extra]: 1 }, param: extra })),
);

/** Parameter objects with exactly one invalid entry, for every Kit_Builder (Property 39). */
export const invalidKitArbitrary: fc.Arbitrary<InvalidKitCase> = fc.oneof(
  keyboardInvalid,
  integerKitInvalid("gearbox", "planetsPerStage", 3, 6),
  integerKitInvalid("lockbox", "gearCount", 2, 5),
  integerKitInvalid("bottle", "ballCount", 1, 3),
  fc
    .tuple(unknownKey, fc.integer({ min: 0, max: 9 }))
    .map(([extra, value]): InvalidKitCase => ({ kit: "dumbbell", build: builders.dumbbell, params: { [extra]: value }, param: extra })),
);
