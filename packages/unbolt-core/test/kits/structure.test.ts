import { buildMechanicalKeyboard65, DEADLOCK_CAGES } from "@unboltkit/sample-kits";
import type { Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import { computePartMetrics } from "../../src/stage1/partMetrics";
import type { NormalizedPart, Stage0Result, Stage1Result } from "../../src/types";
import { type KitCase, KIT_CASES, kitsIn } from "../helpers/kitSet";
/**
 * Kit structure and budget tests (Req 22.1, 22.4, 22.11, 22.13, 22.14, 23.1 to 23.3, 23.6 to
 * 23.8, 23.10, 24.1, 24.5, 24.6). Parts are selected by node-name category, never by Part_ID, and
 * Fastener status comes from `computePartMetrics` with the default Solver_Config.
 */
const TEST_TIMEOUT = 120_000;
const POLY_BUDGET = 150_000;
const SHOWCASE_TRIANGLE_CAP = 60_000;
const SMALL_KIT_TRIANGLE_CAP = 10_000;
interface Prepared {
  root: Group;
  meshes: Mesh[];
  stage0: Stage0Result;
  stage1: Stage1Result;
}
function prepareGroup(label: string, root: Group): Prepared {
  const stage0 = stage0ParseScene(root);
  if (stage0.status !== "ok") {
    throw new Error(`${label}: Stage 0 returned ${stage0.error.kind}: ${stage0.error.message}`);
  }
  const stage1 = stage1Prepare(stage0);
  if (stage1.status !== "ok") {
    throw new Error(`${label}: Stage 1 returned ${stage1.error.kind}: ${stage1.error.message}`);
  }
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if ((node as Mesh).isMesh === true) meshes.push(node as Mesh);
  });
  return { root, meshes, stage0, stage1 };
}
const prepared = new Map<string, Prepared>();
function prepareKit(kit: KitCase): Prepared {
  const cached = prepared.get(kit.name);
  if (cached !== undefined) {
    return cached;
  }
  const result = prepareGroup(kit.name, kit.build());
  prepared.set(kit.name, result);
  return result;
}
function namesOf(meshes: readonly Mesh[]): string[] {
  return meshes.map((mesh) => mesh.name);
}
function countMatching(names: readonly string[], pattern: RegExp): number {
  return names.filter((name) => pattern.test(name)).length;
}
/** The Parts whose source node name matches `pattern`, with their Fastener status. */
function partsNamed(stage1: Stage1Result, pattern: RegExp): { part: NormalizedPart; isFastener: boolean }[] {
  return stage1.parts
    .filter((part) => pattern.test(part.sourceNodeName))
    .map((part) => ({ part, isFastener: computePartMetrics(part.frame.obb.halfExtents, stage1.config).isFastener }));
}
function expectAllFasteners(stage1: Stage1Result, pattern: RegExp, minimum: number, label: string): void {
  const parts = partsNamed(stage1, pattern);
  expect(parts.length, `${label}: number of ${String(pattern)} Parts`).toBeGreaterThanOrEqual(minimum);
  const notFasteners = parts.filter((entry) => !entry.isFastener).map((entry) => entry.part.sourceNodeName);
  expect(notFasteners, `${label}: ${String(pattern)} Parts that are not Fasteners`).toEqual([]);
}
const KEYBOARD_NAMES = [/^bottom_case$/, /^top_frame$/, /^pcb$/, /^plate$/, /^keycap_\d+$/, /^switch_\d+$/, /^case_screw_\d+$/];
const GEARBOX_NAMES = [
  /^sun_gear_\d+$/,
  /^planet_gear_\d+$/,
  /^carrier_\d+$/,
  /^ring_gear_\d+$/,
  /^housing$/,
  /^housing_base$/,
  /^housing_cover$/,
  /^housing_fastener_\d+$/,
];
const LOCKBOX_NAMES = [/^box_body$/, /^lid$/, /^clock_gear_\d+$/, /^gear_spindle_\d+$/, /^latch$/, /^lid_fastener_\d+$/, /^screw_standoff_\d+$/];
/** Mesh names of the three showcase kits, in registry order. */
function showcase(): { keyboard: Prepared; gearbox: Prepared; lockbox: Prepared } {
  const [keyboard, gearbox, lockbox] = kitsIn("showcase").map(prepareKit);
  if (keyboard === undefined || gearbox === undefined || lockbox === undefined) {
    throw new Error("expected three showcase kits");
  }
  return { keyboard, gearbox, lockbox };
}
describe("every kit (Req 22.1)", () => {
  for (const kit of KIT_CASES) {
    it(
      `${kit.name}: at least 2 meshes, each with at least 1 triangle`,
      () => {
        const { meshes } = prepareKit(kit);
        expect(meshes.length).toBeGreaterThanOrEqual(2);
        for (const mesh of meshes) {
          expect((mesh.geometry.index?.count ?? 0) / 3, mesh.name).toBeGreaterThanOrEqual(1);
        }
      },
      TEST_TIMEOUT,
    );
  }
});
describe("65% keyboard composition (Req 23.1, 23.8)", () => {
  it(
    "the default keyboard has the required categories, one switch per keycap and Fastener case screws",
    () => {
      const { keyboard } = showcase();
      const names = namesOf(keyboard.meshes);
      expect(countMatching(names, /^bottom_case$/)).toBeGreaterThanOrEqual(1);
      expect(countMatching(names, /^top_frame$/)).toBeGreaterThanOrEqual(1);
      expect(countMatching(names, /^pcb$/)).toBeGreaterThanOrEqual(1);
      expect(countMatching(names, /^plate$/)).toBeGreaterThanOrEqual(1);
      const keycaps = countMatching(names, /^keycap_\d+$/);
      expect(keycaps).toBeGreaterThanOrEqual(60);
      expect(countMatching(names, /^switch_\d+$/)).toBe(keycaps);
      expectAllFasteners(keyboard.stage1, /^case_screw_\d+$/, 4, "keyboard");
    },
    TEST_TIMEOUT,
  );
  it(
    "every mesh of every showcase kit belongs to a documented component category (Req 23.8)",
    () => {
      const { keyboard, gearbox, lockbox } = showcase();
      for (const [label, set, patterns] of [
        ["keyboard", keyboard, KEYBOARD_NAMES],
        ["gearbox", gearbox, GEARBOX_NAMES],
        ["lockbox", lockbox, LOCKBOX_NAMES],
      ] as const) {
        const uncategorized = namesOf(set.meshes).filter((name) => !patterns.some((pattern) => pattern.test(name)));
        expect(uncategorized, `${label}: mesh names outside the documented categories`).toEqual([]);
      }
    },
    TEST_TIMEOUT,
  );
});
describe("keyboard grid layouts (Req 23.9, 23.10)", () => {
  const layouts = [
    { rows: 1, columns: 1 },
    { rows: 1, columns: 15 },
    { rows: 5, columns: 1 },
    { rows: 2, columns: 3 },
    { rows: 3, columns: 5 },
    { rows: 5, columns: 15 },
  ];
  for (const layout of layouts) {
    it(
      `${layout.rows} x ${layout.columns} grid: rows x columns keycaps, one switch each, one of each case Part, Fastener screws`,
      () => {
        const grid = prepareGroup(`grid ${layout.rows}x${layout.columns}`, buildMechanicalKeyboard65({ layout }));
        const names = namesOf(grid.meshes);
        expect(countMatching(names, /^keycap_\d+$/)).toBe(layout.rows * layout.columns);
        expect(countMatching(names, /^switch_\d+$/)).toBe(layout.rows * layout.columns);
        for (const single of [/^bottom_case$/, /^top_frame$/, /^pcb$/, /^plate$/]) {
          expect(countMatching(names, single), String(single)).toBe(1);
        }
        expectAllFasteners(grid.stage1, /^case_screw_\d+$/, 4, `grid ${layout.rows}x${layout.columns}`);
        expect(grid.stage0.parts, "one Island per mesh").toHaveLength(grid.meshes.length);
      },
      TEST_TIMEOUT,
    );
  }
});
describe("planetary gearbox composition (Req 23.2)", () => {
  it(
    "has 3 stages with a sun gear, at least 3 planet gears and a carrier each, a ring gear or housing, and Fastener housing fasteners",
    () => {
      const { gearbox } = showcase();
      const stages = gearbox.root.children.filter((child) => /^stage_\d+$/.test(child.name));
      expect(stages, "exactly 3 stage groups").toHaveLength(3);
      for (const stage of stages) {
        const names: string[] = [];
        stage.traverse((node) => {
          if ((node as Mesh).isMesh === true) names.push(node.name);
        });
        expect(countMatching(names, /^sun_gear_\d+$/), `${stage.name}: sun gears`).toBe(1);
        expect(countMatching(names, /^planet_gear_\d+$/), `${stage.name}: planet gears`).toBeGreaterThanOrEqual(3);
        expect(countMatching(names, /^carrier_\d+$/), `${stage.name}: carriers`).toBe(1);
      }
      const names = namesOf(gearbox.meshes);
      expect(countMatching(names, /^(ring_gear_\d+|housing)$/), "at least one ring gear or housing").toBeGreaterThanOrEqual(1);
      expectAllFasteners(gearbox.stage1, /^housing_fastener_\d+$/, 2, "gearbox");
    },
    TEST_TIMEOUT,
  );
});
describe("clockwork lockbox composition (Req 23.3)", () => {
  it(
    "has a box body, a lid, at least 2 gears, a latch and at least 2 Fastener fasteners",
    () => {
      const { lockbox } = showcase();
      const names = namesOf(lockbox.meshes);
      expect(countMatching(names, /^box_body$/)).toBeGreaterThanOrEqual(1);
      expect(countMatching(names, /^lid$/)).toBeGreaterThanOrEqual(1);
      expect(countMatching(names, /^clock_gear_\d+$/)).toBeGreaterThanOrEqual(2);
      expect(countMatching(names, /^latch$/)).toBeGreaterThanOrEqual(1);
      expectAllFasteners(lockbox.stage1, /^lid_fastener_\d+$/, 2, "lockbox");
    },
    TEST_TIMEOUT,
  );
});
describe("geometry types of the major Parts (Req 22.4)", () => {
  const extrudeOrLathe = [
    /^(sun|planet|ring|clock)_gear/,
    /^(bottom_case|housing|housing_base|housing_cover|box_body)$/,
    /^top_frame$/,
    /^plate$/,
    /^keycap_/,
    /^carrier_/,
    /^lid$/,
  ];
  it(
    "builds every gear, case, frame, plate, keycap, housing, carrier, box body and lid from ExtrudeGeometry or LatheGeometry",
    () => {
      const { keyboard, gearbox, lockbox } = showcase();
      const checked: string[] = [];
      const wrong: string[] = [];
      for (const set of [keyboard, gearbox, lockbox]) {
        for (const mesh of set.meshes) {
          if (!extrudeOrLathe.some((pattern) => pattern.test(mesh.name))) continue;
          checked.push(mesh.name);
          if (mesh.geometry.type !== "ExtrudeGeometry" && mesh.geometry.type !== "LatheGeometry") {
            wrong.push(`${mesh.name}: ${mesh.geometry.type}`);
          }
        }
      }
      expect(wrong, "Parts built from other geometry").toEqual([]);
      // The filter must reach every category, so a renamed Part cannot slip past it.
      for (const category of ["sun_gear", "planet_gear", "ring_gear", "clock_gear", "bottom_case", "housing", "top_frame", "plate", "keycap", "carrier", "box_body", "lid"]) {
        expect(
          checked.some((name) => name === category || name.startsWith(`${category}_`)),
          `no Part of category ${category} was checked`,
        ).toBe(true);
      }
    },
    TEST_TIMEOUT,
  );
});
describe("triangle budgets (Req 22.11, 22.13, 22.14, 23.7, 24.6)", () => {
  for (const kit of KIT_CASES) {
    it(
      `${kit.name}: stays within its triangle cap and the Poly_Budget`,
      () => {
        const { stage0 } = prepareKit(kit);
        expect(stage0.totalTriangles).toBeLessThanOrEqual(POLY_BUDGET);
        expect(stage0.sampling.polyBudgetExceeded).toBe(false);
        expect(stage0.sampling.stride).toBe(1);
        if (kit.group === "showcase") {
          expect(stage0.totalTriangles).toBeLessThanOrEqual(SHOWCASE_TRIANGLE_CAP);
        } else {
          expect(stage0.totalTriangles).toBeLessThanOrEqual(SMALL_KIT_TRIANGLE_CAP);
        }
        expect(stage0.totalTriangles).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );
  }
});
describe("one Island per mesh (Req 23.6, 24.5)", () => {
  for (const kit of KIT_CASES) {
    it(
      `${kit.name}: the Part count equals the mesh count and no mesh is split or merged`,
      () => {
        const { meshes, stage0 } = prepareKit(kit);
        expect(stage0.parts).toHaveLength(meshes.length);
        const paths = stage0.parts.map((part) => part.sourceNodePath.join("/"));
        expect(new Set(paths).size, "every Part comes from a different mesh node").toBe(meshes.length);
        expect(stage0.parts.every((part) => part.islandIndex === 0)).toBe(true);
      },
      TEST_TIMEOUT,
    );
  }
});
describe("the two Deadlock_Cages are distinct (Req 24.1)", () => {
  it("exports exactly 2 cages that differ in Part count or in their per-Part triangle counts", () => {
    expect(DEADLOCK_CAGES).toHaveLength(2);
    const [first, second] = kitsIn("cage").map((kit) => {
      const { stage0 } = prepareKit(kit);
      return stage0.parts.map((part) => part.triangles.length / 3).sort((a, b) => a - b);
    });
    if (first === undefined || second === undefined) {
      throw new Error("expected two cages");
    }
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(second.length).toBeGreaterThanOrEqual(2);
    expect(first.length !== second.length || first.some((count, i) => count !== second[i])).toBe(true);
  });
});
