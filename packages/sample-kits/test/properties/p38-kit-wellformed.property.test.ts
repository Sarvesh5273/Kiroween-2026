import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MESH_NAME_PATTERN } from "../../src/index";
import { validKitArbitrary } from "../arbitraries/kitParams";
import { fingerprint, isSinglePbrMaterial, meshesOf, textureSlots } from "../helpers/inspect";

const SEED = 0x38c0ffee;

const count = (names: readonly string[], pattern: RegExp): number => names.filter((name) => pattern.test(name)).length;

describe("Kit_Builders", () => {
  it("are well-formed and deterministic for every valid parameter value", { timeout: 600_000 }, () => {
    // Feature: unbolt-core-engine, Property 38: Kit builders are well-formed and deterministic
    fc.assert(
      fc.property(validKitArbitrary, ({ kit, build, params, grid }) => {
        const root = params === undefined ? build() : build(params);
        const meshes = meshesOf(root);
        expect(meshes.length, kit).toBeGreaterThanOrEqual(2);

        for (const mesh of meshes) {
          const geometry = mesh.geometry;
          const position = geometry.getAttribute("position");
          const normal = geometry.getAttribute("normal");
          const index = geometry.index;
          expect(index, `${kit}/${mesh.name} index`).not.toBeNull();
          expect(position, `${kit}/${mesh.name} position`).toBeDefined();
          expect(normal, `${kit}/${mesh.name} normal`).toBeDefined();
          if (index === null) continue;
          expect(index.count % 3, `${kit}/${mesh.name} index count`).toBe(0);
          expect(index.count / 3, `${kit}/${mesh.name} triangles`).toBeGreaterThanOrEqual(1);
          for (let i = 0; i < index.count; i++) {
            const v = index.getX(i);
            if (!(v >= 0 && v < position.count)) {
              expect.fail(`${kit}/${mesh.name}: index ${i} = ${v} is outside 0..${position.count - 1}`);
            }
          }
          for (const attribute of [position, normal]) {
            const values = attribute.array;
            for (let i = 0; i < values.length; i++) {
              if (!Number.isFinite(values[i])) expect.fail(`${kit}/${mesh.name}: non-finite component ${i}`);
            }
          }
          expect(isSinglePbrMaterial(mesh.material), `${kit}/${mesh.name} material`).toBe(true);
          if (isSinglePbrMaterial(mesh.material)) {
            expect(textureSlots(mesh.material), `${kit}/${mesh.name} texture maps`).toEqual([]);
          }
        }

        const names = meshes.map((mesh) => mesh.name);
        expect(new Set(names).size, `${kit} unique names`).toBe(names.length);
        for (const name of names) expect(name, kit).toMatch(MESH_NAME_PATTERN);

        if (grid !== undefined) {
          const cells = grid.rows * grid.columns;
          expect(count(names, /^keycap_\d+$/)).toBe(cells);
          expect(count(names, /^switch_\d+$/)).toBe(cells);
          expect(count(names, /^bottom_case$/)).toBe(1);
          expect(count(names, /^top_frame$/)).toBe(1);
          expect(count(names, /^pcb$/)).toBe(1);
          expect(count(names, /^plate$/)).toBe(1);
          expect(count(names, /^case_screw_\d+$/)).toBeGreaterThanOrEqual(4);
        }

        // A second call with the same parameters gives the same names, transforms and bytes.
        const again = params === undefined ? build() : build(params);
        const a = fingerprint(root);
        const b = fingerprint(again);
        expect(b.names).toEqual(a.names);
        expect(b.matrices).toEqual(a.matrices);
        expect(b.buffers.length).toBe(a.buffers.length);
        a.buffers.forEach((bytes, i) => {
          const other = b.buffers[i] as Uint8Array;
          expect(other.length, `${kit} buffer ${i} length`).toBe(bytes.length);
          if (!bytes.every((byte, k) => other[k] === byte)) expect.fail(`${kit}: buffer ${i} differs between two calls`);
        });
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
});
