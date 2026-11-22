import { describe, expect, it } from "vitest";
import {
  buildMechanicalKeyboard65,
  DEADLOCK_CAGES,
  KEYBOARD_FIXTURE_LAYOUT,
  KitParameterError,
  MESH_NAME_PATTERN,
  SHOWCASE_KITS,
} from "../../src/index";
import { checkedName, indexedName, NameRegistry } from "../../src/shared/naming";
import { isSinglePbrMaterial, meshesOf, textureSlots } from "../helpers/inspect";

const ALL_KITS = [
  ...SHOWCASE_KITS,
  ...DEADLOCK_CAGES,
  { name: "keyboard-fixture", build: () => buildMechanicalKeyboard65({ layout: KEYBOARD_FIXTURE_LAYOUT }) },
];

describe("Node environment (Req 22.12)", () => {
  it("has no DOM globals and builds every kit", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    for (const kit of ALL_KITS) {
      const root = kit.build();
      expect(meshesOf(root).length, kit.name).toBeGreaterThanOrEqual(2);
    }
  });

  it("registers three showcase kits and two cages with distinct names", () => {
    expect(SHOWCASE_KITS.map((kit) => kit.name)).toEqual(["mechanical-keyboard-65", "planetary-gearbox-3-stage", "haunted-clockwork-lockbox"]);
    expect(DEADLOCK_CAGES.map((kit) => kit.name)).toEqual(["deadlock-cage-dumbbell-ring", "deadlock-cage-ship-in-bottle"]);
    expect(KEYBOARD_FIXTURE_LAYOUT).toEqual({ rows: 2, columns: 3 });
  });
});

describe("Mesh naming (Req 22.7, 23.8)", () => {
  it("gives every mesh of every kit a unique name that matches the pattern", () => {
    for (const kit of ALL_KITS) {
      const names = meshesOf(kit.build()).map((mesh) => mesh.name);
      expect(new Set(names).size, kit.name).toBe(names.length);
      for (const name of names) expect(name, kit.name).toMatch(MESH_NAME_PATTERN);
    }
  });

  it("accepts and rejects names by the documented pattern", () => {
    for (const good of ["pcb", "case_screw_3", "top_frame", "planet_gear_12", "ship-ball_2"]) {
      expect(checkedName(good)).toBe(good);
    }
    for (const bad of ["", "ab", "Case_screw", "case__screw", "screw_", "1screw", "case screw", `${"a".repeat(64)}_1`]) {
      expect(() => checkedName(bad), bad).toThrow(RangeError);
    }
    expect(indexedName("lid_fastener", 2)).toBe("lid_fastener_2");
    expect(() => indexedName("lid_fastener", -1)).toThrow(RangeError);
  });

  it("refuses to hand out the same name twice", () => {
    const names = new NameRegistry();
    expect(names.claim("plate")).toBe("plate");
    expect(() => names.claim("plate")).toThrow(RangeError);
  });

  it("names the documented component categories", () => {
    const keyboard = meshesOf(SHOWCASE_KITS[0]?.build() ?? buildMechanicalKeyboard65()).map((m) => m.name);
    expect(keyboard.filter((n) => /^keycap_\d+$/.test(n))).toHaveLength(68);
    expect(keyboard.filter((n) => /^switch_\d+$/.test(n))).toHaveLength(68);
    expect(keyboard.filter((n) => /^case_screw_\d+$/.test(n))).toHaveLength(6);
    expect(keyboard).toEqual(expect.arrayContaining(["bottom_case", "top_frame", "plate", "pcb"]));
    expect(keyboard).toHaveLength(146);

    const gearbox = SHOWCASE_KITS[1]?.build();
    if (gearbox === undefined) throw new Error("the gearbox kit is not registered");
    const stages = gearbox.children.filter((child) => /^stage_\d$/.test(child.name));
    expect(stages.map((stage) => stage.name)).toEqual(["stage_1", "stage_2", "stage_3"]);
    for (const stage of stages) {
      const names = meshesOf(stage).map((m) => m.name);
      expect(names.filter((n) => /^sun_gear_\d+$/.test(n)), stage.name).toHaveLength(1);
      expect(names.filter((n) => /^planet_gear_\d+$/.test(n)), stage.name).toHaveLength(3);
      expect(names.filter((n) => /^carrier_\d+$/.test(n)), stage.name).toHaveLength(1);
      expect(names.filter((n) => /^ring_gear_\d+$/.test(n)), stage.name).toHaveLength(1);
    }
    const housing = meshesOf(gearbox).map((m) => m.name);
    expect(housing).toEqual(expect.arrayContaining(["housing", "housing_base", "housing_cover"]));
    expect(housing.filter((n) => /^housing_fastener_\d+$/.test(n))).toHaveLength(4);
  });
});

describe("Materials (Req 22.5)", () => {
  it("gives every mesh its own untextured PBR material, fresh on every call", () => {
    for (const kit of ALL_KITS) {
      const first = meshesOf(kit.build());
      const second = meshesOf(kit.build());
      const seen = new Set<unknown>();
      first.forEach((mesh, i) => {
        expect(isSinglePbrMaterial(mesh.material), `${kit.name}/${mesh.name}`).toBe(true);
        if (isSinglePbrMaterial(mesh.material)) expect(textureSlots(mesh.material), `${kit.name}/${mesh.name}`).toEqual([]);
        expect(seen.has(mesh.material), `${kit.name}/${mesh.name} shares a material`).toBe(false);
        seen.add(mesh.material);
        expect(second[i]?.material, `${kit.name}/${mesh.name} reuses a material across calls`).not.toBe(mesh.material);
      });
    }
  });
});

describe("Parameter errors (Req 22.10)", () => {
  it("names the parameter for a few hand-picked cases", () => {
    const cases: [() => unknown, string][] = [
      [() => buildMechanicalKeyboard65({ layout: { rows: 0, columns: 3 } }), "layout.rows"],
      [() => buildMechanicalKeyboard65({ layout: { rows: 2, columns: 16 } }), "layout.columns"],
      [() => buildMechanicalKeyboard65({ layout: "tkl" as never }), "layout"],
    ];
    for (const [call, param] of cases) {
      expect(call).toThrow(KitParameterError);
      expect(call).toThrow(param);
    }
  });
});
