import { afterEach, describe, expect, it, vi } from "vitest";
import { Box3, CanvasTexture, MeshStandardMaterial, SRGBColorSpace, Vector3 } from "three";
import type { BufferGeometry, Group, Mesh } from "three";
import {
  PEDESTAL_DIAL_EMISSIVE,
  PEDESTAL_HEIGHT,
  PEDESTAL_RADIUS,
  PEDESTAL_RING_OVERHANG,
  PEDESTAL_RING_RISE,
  PEDESTAL_TOP_GAP,
  createBrushedBrassTexture,
  createDialTexture,
  createPedestal,
  releasePedestal,
} from "../../src/viewport/pedestal";
import { ResourceTracker } from "../../src/viewport/resourceTracker";
import { mulberry32 } from "../helpers/prng";
import { installFakeCanvasDocument } from "../helpers/fakeCanvas";

afterEach(() => {
  vi.unstubAllGlobals();
});

function child(group: Group, name: string): Mesh {
  const found = group.getObjectByName(name) as Mesh | undefined;
  if (found === undefined) throw new Error(`pedestal has no "${name}" child`);
  return found;
}

function worldBox(mesh: Mesh): Box3 {
  mesh.updateMatrixWorld(true);
  mesh.geometry.computeBoundingBox();
  return new Box3().copy(mesh.geometry.boundingBox as Box3).applyMatrix4(mesh.matrixWorld);
}

/** Number of non-degenerate triangles whose winding normal points the same way as their vertex normals. */
function countFacing(geometry: BufferGeometry): { facing: number; flipped: number } {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  if (index === null) throw new Error("expected an indexed geometry");
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const edge1 = new Vector3();
  const edge2 = new Vector3();
  const winding = new Vector3();
  const vertexNormal = new Vector3();
  const sum = new Vector3();
  let facing = 0;
  let flipped = 0;
  for (let i = 0; i < index.count; i += 3) {
    const ia = index.getX(i);
    const ib = index.getX(i + 1);
    const ic = index.getX(i + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    winding.crossVectors(edge1.subVectors(b, a), edge2.subVectors(c, a));
    if (winding.length() < 1e-9) continue;
    sum.set(0, 0, 0);
    for (const vertex of [ia, ib, ic]) sum.add(vertexNormal.fromBufferAttribute(normal, vertex));
    if (winding.dot(sum) > 0) facing++;
    else flipped++;
  }
  return { facing, flipped };
}

describe("createPedestal in a headless run", () => {
  it("has no document, so the dial and brushed-brass textures are skipped", () => {
    expect(typeof document).toBe("undefined");
    expect(createDialTexture()).toBeNull();
    expect(createBrushedBrassTexture()).toBeNull();
  });

  it("builds a plinth, a slate platter and a brass ring with the specified metal", () => {
    const pedestal = createPedestal(-0.4);
    expect(pedestal.name).toBe("pedestal");
    expect(pedestal.children.map((object) => object.name)).toEqual([
      "pedestal-foot",
      "pedestal-base",
      "pedestal-bevel",
    ]);

    const platter = child(pedestal, "pedestal-base");
    const materials = platter.material as MeshStandardMaterial[];
    // CylinderGeometry groups: side, top cap, bottom cap.
    expect(materials).toHaveLength(3);
    for (const material of materials) {
      expect(material.color.getHex()).toBe(0x262c3c);
      expect(material.metalness).toBe(0.55);
      expect(material.roughness).toBe(0.42);
      expect(material.emissiveMap).toBeNull();
    }

    const ring = child(pedestal, "pedestal-bevel").material as MeshStandardMaterial;
    expect(ring.color.getHex()).toBe(0xdda547);
    expect(ring.metalness).toBe(0.9);
    expect(ring.roughness).toBe(0.22);
    expect(ring.roughnessMap).toBeNull();
  });

  it("receives the assembly's shadows on the platter and casts the ring's own", () => {
    const pedestal = createPedestal(0);
    expect(child(pedestal, "pedestal-base").receiveShadow).toBe(true);
    expect(child(pedestal, "pedestal-bevel").castShadow).toBe(true);
    expect(child(pedestal, "pedestal-foot").castShadow).toBe(false);
  });

  it("seats the platter top a fixed gap under the lowest assembly point, whatever that height is", () => {
    const random = mulberry32(0x7ab1e);
    for (let run = 0; run < 25; run++) {
      const lowestY = random() * 4 - 2;
      const pedestal = createPedestal(lowestY);
      const platter = worldBox(child(pedestal, "pedestal-base"));
      // Vertex positions are Float32, so heights agree to about 1e-7.
      expect(platter.max.y).toBeCloseTo(lowestY - PEDESTAL_TOP_GAP, 6);
      expect(platter.max.y - platter.min.y).toBeCloseTo(PEDESTAL_HEIGHT, 6);
      expect(platter.max.x).toBeCloseTo(PEDESTAL_RADIUS, 6);
      // The plinth is a lower, wider tier.
      const foot = worldBox(child(pedestal, "pedestal-foot"));
      expect(foot.max.y).toBeLessThanOrEqual(platter.min.y + 0.0025);
      expect(foot.max.x).toBeGreaterThan(platter.max.x);
    }
  });

  it("raises the brass ring above the platter top and wraps the rim", () => {
    const random = mulberry32(0xb2a55);
    for (let run = 0; run < 25; run++) {
      const lowestY = random() * 4 - 2;
      const pedestal = createPedestal(lowestY);
      const platter = worldBox(child(pedestal, "pedestal-base"));
      const ring = worldBox(child(pedestal, "pedestal-bevel"));
      expect(ring.max.y).toBeCloseTo(platter.max.y + PEDESTAL_RING_RISE, 6);
      expect(ring.max.y).toBeGreaterThan(platter.max.y);
      expect(ring.max.x).toBeCloseTo(PEDESTAL_RADIUS + PEDESTAL_RING_OVERHANG, 6);
      expect(ring.min.y).toBeLessThan(platter.max.y);
    }
  });

  it("builds the ring with every facet facing out of the metal", () => {
    const ring = child(createPedestal(0), "pedestal-bevel").geometry;
    const { facing, flipped } = countFacing(ring);
    expect(facing).toBeGreaterThan(1000);
    expect(flipped).toBe(0);
  });

  it("releases every geometry and material, including the platter's material array", () => {
    const tracker = new ResourceTracker();
    const pedestal = createPedestal(0, tracker);
    // Three geometries, and four materials: plinth, platter side (reused for the bottom), platter top, ring.
    expect(tracker.size).toBe(7);
    releasePedestal(pedestal, tracker);
    expect(tracker.size).toBe(0);
  });
});

describe("createPedestal with a canvas", () => {
  it("engraves the dial on the platter top only and brushes the ring", () => {
    installFakeCanvasDocument();
    const tracker = new ResourceTracker();
    const pedestal = createPedestal(0, tracker);

    const [side, top, bottom] = child(pedestal, "pedestal-base").material as MeshStandardMaterial[];
    expect(top?.emissiveMap).toBeInstanceOf(CanvasTexture);
    expect(top?.emissiveMap?.colorSpace).toBe(SRGBColorSpace);
    expect(top?.emissive.getHex()).toBe(0xffffff);
    expect(top?.emissiveIntensity).toBe(PEDESTAL_DIAL_EMISSIVE);
    expect(side?.emissiveMap).toBeNull();
    expect(bottom).toBe(side);

    const ring = child(pedestal, "pedestal-bevel").material as MeshStandardMaterial;
    expect(ring.roughnessMap).toBeInstanceOf(CanvasTexture);

    // Seven GPU-side items from the headless run plus the two textures.
    expect(tracker.size).toBe(9);
    releasePedestal(pedestal, tracker);
    expect(tracker.size).toBe(0);
  });
});
