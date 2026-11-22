import { describe, expect, it } from "vitest";
import type { MaterialDescriptor, PartRenderData } from "../../src/protocol";
import { buildPartMeshes, castsShadow } from "../../src/viewport/partMeshes";
import { requireSolveResult, solvedLockbox } from "../helpers/solved";

const OPAQUE: MaterialDescriptor = {
  baseColor: 0x8a8f99,
  metalness: 0.9,
  roughness: 0.3,
  transmission: 0,
  opacity: 1,
  emissive: 0,
};

function trianglePart(partId: string, material: MaterialDescriptor): PartRenderData {
  return {
    partId,
    displayName: partId,
    nodeName: partId,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    material,
    obb: { center: [0.3, 0.3, 0], halfExtents: [0.5, 0.5, 0.01] },
    aabb: { min: [0, 0, 0], max: [1, 1, 0] },
    isFastener: false,
    principalAxis: [0, 0, 1],
    candidateAxes: [],
  };
}

describe("which parts cast shadows", () => {
  it("lets opaque, non-transmissive parts cast and keeps glass and see-through parts out of the shadow map", () => {
    expect(castsShadow(OPAQUE)).toBe(true);
    expect(castsShadow({ ...OPAQUE, transmission: 1 })).toBe(false);
    expect(castsShadow({ ...OPAQUE, transmission: 0.2 })).toBe(false);
    expect(castsShadow({ ...OPAQUE, opacity: 0.5 })).toBe(false);
  });

  it("sets castShadow on each built mesh from its own material", () => {
    const parts = [
      trianglePart("a-brass", OPAQUE),
      trianglePart("b-glass", { ...OPAQUE, transmission: 1, roughness: 0.05 }),
      trianglePart("c-steel", { ...OPAQUE, baseColor: 0x333840 }),
    ];
    const set = buildPartMeshes(parts);
    expect(set.meshes.map((mesh) => [mesh.name, mesh.castShadow])).toEqual([
      ["a-brass", true],
      ["b-glass", false],
      ["c-steel", true],
    ]);
  });

  it("follows the real Lockbox: every transmissive part is out, every other part casts", () => {
    const parts = requireSolveResult(solvedLockbox(2)).parts;
    const set = buildPartMeshes(parts);
    expect(set.meshes.length).toBe(parts.length);
    const casters = set.meshes.filter((mesh) => mesh.castShadow);
    expect(casters.length).toBeGreaterThan(0);
    for (const part of parts) {
      const mesh = set.byPartId.get(part.partId);
      const seeThrough = part.material.transmission > 0 || part.material.opacity < 1;
      expect(mesh?.castShadow, `${part.partId} (transmission ${part.material.transmission}, opacity ${part.material.opacity})`).toBe(
        !seeThrough,
      );
    }
  });
});
