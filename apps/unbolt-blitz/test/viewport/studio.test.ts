import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasTexture, DirectionalLight, PCFSoftShadowMap, SRGBColorSpace, Vector3 } from "three";
import type { Aabb } from "../../src/game/blitzEngine";
import {
  ARENA_CONFIG,
  BRASS_KEY_LIGHT_POSITION,
  KEY_SHADOW_FRUSTUM_MARGIN,
  STUDIO_BACKDROP,
} from "../../src/viewport/arenaConfig";
import { createStudioBackdrop, createStudioLights, fitKeyShadow, keyShadowFit } from "../../src/viewport/environment";
import { PEDESTAL_RADIUS, pedestalLayout, pedestalShadowFocus } from "../../src/viewport/pedestal";
import { APP_ROOT } from "../helpers/sourceScan";
import { installFakeCanvasDocument } from "../helpers/fakeCanvas";
import { mulberry32 } from "../helpers/prng";
import type { Rng } from "../helpers/prng";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A uniformly distributed direction on the unit sphere. */
function randomDirection(random: Rng): Vector3 {
  for (;;) {
    const v = new Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
    const length = v.length();
    if (length > 1e-3 && length <= 1) return v.divideScalar(length);
  }
}

describe("studio backdrop", () => {
  it("is skipped without a document, and the Arena keeps the flat obsidian color", () => {
    expect(typeof document).toBe("undefined");
    expect(createStudioBackdrop()).toBeNull();
    expect(ARENA_CONFIG.backgroundColor).toBe(0x0d0f14);
  });

  it("draws an sRGB CanvasTexture and dithers by at most one level, the same way every time", () => {
    const env = installFakeCanvasDocument(100);
    const first = createStudioBackdrop();
    const second = createStudioBackdrop();
    expect(first).toBeInstanceOf(CanvasTexture);
    expect(first?.colorSpace).toBe(SRGBColorSpace);

    const [a, b] = env.contexts.map((context) => context.putPixels);
    expect(a).not.toBeNull();
    expect(a?.length).toBe(STUDIO_BACKDROP.size * STUDIO_BACKDROP.size * 4);
    let min = 255;
    let max = 0;
    let identical = true;
    for (let i = 0; i < (a?.length ?? 0); i++) {
      const value = a?.[i] as number;
      if (i % 4 !== 3) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      if (value !== b?.[i]) identical = false;
    }
    expect([min, max]).toEqual([99, 101]);
    expect(identical).toBe(true);
    expect(second).toBeInstanceOf(CanvasTexture);
  });
});

describe("studio lights and soft shadows", () => {
  it("lets only the brass key light cast a 2048 shadow", () => {
    const lights = createStudioLights();
    expect(lights.all.filter((light) => light.castShadow).map((light) => light.name)).toEqual(["brass-key-light"]);
    expect(lights.key.shadow.mapSize.x).toBe(2048);
    expect(lights.key.shadow.mapSize.y).toBe(2048);
  });

  it("asks the renderer for PCF soft shadows", () => {
    expect(ARENA_CONFIG.shadowsEnabled).toBe(true);
    expect(ARENA_CONFIG.shadowMapType).toBe(PCFSoftShadowMap);
  });

  it("wires those settings into the WebGL renderer in Arena.ts", () => {
    // A WebGLRenderer needs a GL context, which a headless run does not have, so this reads the source.
    const source = readFileSync(join(APP_ROOT, "src", "viewport", "Arena.ts"), "utf8");
    expect(source).toMatch(/renderer\.shadowMap\.enabled\s*=\s*ARENA_CONFIG\.shadowsEnabled/);
    expect(source).toMatch(/renderer\.shadowMap\.type\s*=\s*ARENA_CONFIG\.shadowMapType/);
    expect(source).toMatch(/fitKeyShadow\(/);
  });

  it("rejects a radius that is not positive and finite", () => {
    for (const radius of [0, -1, Number.NaN, Infinity]) {
      expect(() => keyShadowFit([0, 0, 0], radius)).toThrow(RangeError);
    }
  });

  it("covers the whole bounding sphere in the shadow camera, wherever the level sits", () => {
    const random = mulberry32(0x5ad0f);
    for (let run = 0; run < 20; run++) {
      const center: [number, number, number] = [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1];
      const radius = 0.3 + random() * 1.5;
      const key = createStudioLights().key;
      fitKeyShadow(key, center, radius);
      key.shadow.updateMatrices(key);
      const camera = key.shadow.camera;

      const point = new Vector3();
      for (let sample = 0; sample < 150; sample++) {
        point.copy(randomDirection(random)).multiplyScalar(radius).add(new Vector3(...center));
        point.applyMatrix4(camera.matrixWorldInverse);
        expect(point.x).toBeGreaterThanOrEqual(camera.left);
        expect(point.x).toBeLessThanOrEqual(camera.right);
        expect(point.y).toBeGreaterThanOrEqual(camera.bottom);
        expect(point.y).toBeLessThanOrEqual(camera.top);
        expect(-point.z).toBeGreaterThanOrEqual(camera.near);
        expect(-point.z).toBeLessThanOrEqual(camera.far);
      }
      expect(camera.right).toBeCloseTo(radius * KEY_SHADOW_FRUSTUM_MARGIN, 9);
    }
  });

  it("keeps the key light's direction and distance for every level", () => {
    const random = mulberry32(0x11ce);
    const [kx, ky, kz] = BRASS_KEY_LIGHT_POSITION;
    for (let run = 0; run < 10; run++) {
      const center: [number, number, number] = [random() - 0.5, random() - 0.5, random() - 0.5];
      const key = new DirectionalLight();
      fitKeyShadow(key, center, 0.5 + random());
      const offset = key.position.clone().sub(key.target.position);
      expect(offset.x).toBeCloseTo(kx, 9);
      expect(offset.y).toBeCloseTo(ky, 9);
      expect(offset.z).toBeCloseTo(kz, 9);
      expect(key.target.position.toArray()).toEqual(center);
    }
  });
});

describe("pedestalShadowFocus", () => {
  it("contains the assembly bounds and every point of the platter top edge", () => {
    const random = mulberry32(0xf0c05);
    for (let run = 0; run < 30; run++) {
      const min: [number, number, number] = [-random() * 0.6, -random() * 0.6, -random() * 0.6];
      const max: [number, number, number] = [random() * 0.6, random() * 0.6, random() * 0.6];
      const bounds: Aabb = { min, max };
      const { topY } = pedestalLayout(min[1]);
      const focus = pedestalShadowFocus(bounds, topY);
      const center = new Vector3(...focus.center);

      for (const x of [min[0], max[0]]) {
        for (const y of [min[1], max[1]]) {
          for (const z of [min[2], max[2]]) {
            expect(center.distanceTo(new Vector3(x, y, z))).toBeLessThanOrEqual(focus.radius + 1e-9);
          }
        }
      }
      for (let step = 0; step < 72; step++) {
        const angle = (step / 72) * Math.PI * 2;
        const rim = new Vector3(Math.cos(angle) * PEDESTAL_RADIUS, topY, Math.sin(angle) * PEDESTAL_RADIUS);
        expect(center.distanceTo(rim)).toBeLessThanOrEqual(focus.radius + 1e-9);
      }
    }
  });
});
