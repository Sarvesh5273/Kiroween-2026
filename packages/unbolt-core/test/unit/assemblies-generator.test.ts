import fc from "fast-check";
import { BoxGeometry } from "three";
import { describe, expect, it } from "vitest";
import { ASSEMBLY_LAYOUTS, assemblyArbitrary, worldGeometry, type GeneratedAssembly } from "../arbitraries/assemblies";
import { checkWatertight } from "../helpers/watertight";

const SEED = 0x5a17e5;
const SAMPLE_COUNT = 200;

function sampleAssemblies(): GeneratedAssembly[] {
  return fc.sample(assemblyArbitrary(), { seed: SEED, numRuns: SAMPLE_COUNT });
}

describe("watertight assembly generator (Req 11.7)", () => {
  const assemblies = sampleAssemblies();

  it("draws 200 Assemblies and every Part passes the independent watertightness checker", () => {
    expect(assemblies).toHaveLength(SAMPLE_COUNT);
    for (const [assemblyIndex, assembly] of assemblies.entries()) {
      // Micro_Shrink is in normalized units, so the world-space thickness floor scales with the extent.
      const minThickness = assembly.config.microShrink * assembly.extent;
      for (const part of assembly.parts) {
        const { positions, index } = worldGeometry(part);
        const report = checkWatertight(positions, index, { minThickness });
        expect(
          report.ok,
          `assembly ${assemblyIndex} (${assembly.layout}, microShrink ${assembly.config.microShrink}, extent ${assembly.extent}) ` +
            `part ${part.name} (${part.kind}): ${report.problems.join("; ")}`,
        ).toBe(true);
        expect(report.signedVolume).toBeGreaterThan(0);
        expect(report.thickness).toBeGreaterThan(minThickness);
      }
    }
  });

  it("draws 2 to 8 Parts, covers all four layouts and all three constructions, and keeps Clearance_Epsilon below Micro_Shrink", () => {
    const layouts = new Set<string>();
    const kinds = new Set<string>();
    for (const assembly of assemblies) {
      expect(assembly.parts.length).toBeGreaterThanOrEqual(2);
      expect(assembly.parts.length).toBeLessThanOrEqual(8);
      expect(assembly.config.microShrink).toBeGreaterThanOrEqual(1e-5);
      expect(assembly.config.microShrink).toBeLessThanOrEqual(2e-4);
      expect(assembly.config.clearanceEpsilon).toBeGreaterThan(0);
      expect(assembly.config.clearanceEpsilon).toBeLessThan(assembly.config.microShrink);
      layouts.add(assembly.layout);
      for (const part of assembly.parts) {
        kinds.add(part.kind);
      }
    }
    expect([...layouts].sort()).toEqual([...ASSEMBLY_LAYOUTS].sort());
    expect([...kinds].sort()).toEqual(["box", "extrude", "lathe"]);
  });

  it("is deterministic for a fixed seed", () => {
    const again = sampleAssemblies();
    const summary = (list: readonly GeneratedAssembly[]): string[] =>
      list.map((assembly) => {
        const first = assembly.parts[0];
        const positions = first === undefined ? [] : Array.from(worldGeometry(first).positions.slice(0, 6));
        return JSON.stringify([assembly.layout, assembly.parts.length, assembly.config, positions]);
      });
    expect(summary(again)).toEqual(summary(assemblies));
  });

  it("flags a closed solid that is thinner than the minimum thickness", () => {
    const slab = new BoxGeometry(1, 1, 0.001);
    const positions = Float64Array.from(slab.getAttribute("position").array);
    const index = Uint32Array.from(slab.getIndex()?.array ?? []);
    expect(checkWatertight(positions, index, { minThickness: 0.0005 }).ok).toBe(true);
    const thin = checkWatertight(positions, index, { minThickness: 0.002 });
    expect(thin.ok).toBe(false);
    expect(thin.thickness).toBeCloseTo(0.001, 9);
  });

  it("keeps every generated Part well above the thickness floor", () => {
    let worstRatio = Number.POSITIVE_INFINITY;
    for (const assembly of assemblies) {
      for (const part of assembly.parts) {
        const { positions, index } = worldGeometry(part);
        const report = checkWatertight(positions, index, { minThickness: 0 });
        worstRatio = Math.min(worstRatio, report.thickness / assembly.extent / assembly.config.microShrink);
      }
    }
    // The design wants walls at least 5 times Micro_Shrink after normalization.
    expect(worstRatio).toBeGreaterThan(5);
  });

  it("rejects a Part that is not closed, so the checker cannot pass vacuously", () => {
    // A box with one triangle removed has an open hole.
    const first = assemblies[0]?.parts[0];
    if (first === undefined) {
      throw new Error("no generated Part to damage");
    }
    const { positions } = worldGeometry(first);
    const index = first.mesh.geometry.getIndex();
    const full = index === null ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) : Uint32Array.from(index.array);
    const damaged = full.slice(0, full.length - 3);
    expect(checkWatertight(positions, damaged, { minThickness: 0 }).ok).toBe(false);

    // Reversed winding has negative volume.
    const reversed = Uint32Array.from(full);
    for (let t = 0; t < reversed.length; t += 3) {
      const second = reversed[t + 1] ?? 0;
      reversed[t + 1] = reversed[t + 2] ?? 0;
      reversed[t + 2] = second;
    }
    const inward = checkWatertight(positions, reversed, { minThickness: 0 });
    expect(inward.ok).toBe(false);
    expect(inward.signedVolume).toBeLessThan(0);
  });
});
