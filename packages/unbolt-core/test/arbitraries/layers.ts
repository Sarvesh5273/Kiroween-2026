import fc from "fast-check";
import { Quaternion, Vector3 } from "three";
import type { ClashPart, Vec3 } from "../../src/types";
import { makeClashPart } from "../helpers/clashParts";

/**
 * Layered targets for Property 20 (Req 13.5, 13.6, 20.8, 20.9).
 *
 * A moving triangle sits at the origin with its outward normal along the direction of motion.
 * Its rays travel along `+Z` (before a random rotation of the whole scene) through a stack of 1
 * to 4 large triangles, each perpendicular to the axis or tilted from it, one triangle per
 * layer. Every layer is one of
 *  - `coincident`: closer than Clearance_Epsilon to the ray origin, facing the ray head on;
 *  - `grazing`: at least Clearance_Epsilon away with `-tau <= dot(n, dir) < 0`;
 *  - `backfacing`: at least Clearance_Epsilon away with `dot(n, dir) > 0`;
 *  - `opposing`: at least Clearance_Epsilon away with `dot(n, dir) < -tau`.
 * The triangles of the target Part are stored in a random order, so the triangle index of a
 * layer is unrelated to its distance.
 *
 * The moving triangle is only `2e-7` wide, so the four rays it casts (three vertices and the
 * centroid) all meet each layer at distances that differ by at most `4e-7 / |dot|`. Opposing
 * layers keep a margin of `1e-4` above Clearance_Epsilon, and `|dot| >= 0.03`, which is more
 * than that spread. Coincident layers face the ray head on, so all four rays see the same
 * distance. The wide layers are far larger than the moving triangle, so every ray hits every
 * layer, and the layers' own rays pass at least `1e-3` beside the moving triangle.
 */

export type LayerKind = "coincident" | "grazing" | "backfacing" | "opposing";

export const LAYER_KINDS: readonly LayerKind[] = ["coincident", "grazing", "backfacing", "opposing"];

export interface Layer {
  kind: LayerKind;
  /** Distance of the layer's plane from the origin of the ray cast from the first vertex. */
  distance: number;
  /** `dot(n, dir)` of the layer's outward normal. */
  dot: number;
  /** Direction of the tilt around the ray axis, in `[0, 2π)`. */
  azimuth: number;
}

export interface LayerStack {
  microShrink: number;
  clearanceEpsilon: number;
  tau: number;
  /** Ordered from the nearest layer to the farthest. */
  layers: Layer[];
  /** `permutation[j]` is the triangle index of layer `j`. */
  permutation: number[];
  /** Scene rotation as `[x, y, z, w]`. */
  rotation: [number, number, number, number];
}

export interface LayerScene {
  moving: ClashPart;
  target: ClashPart;
  /** Unit direction of motion after the scene rotation. */
  dir: Vec3;
  /** Origin of the ray that the oracle casts from the moving triangle's first vertex. */
  origin: Vec3;
  /** Triangle index of the nearest opposing layer, or `-1` when no layer is opposing. */
  expectedTriangle: number;
  /** True when a discarded layer lies in front of the nearest opposing layer. */
  masksOpposing: boolean;
}

/** Edge of the moving triangle. */
const MOVING_SIZE = 2e-7;
/** Minimum distance between two layers that are not coincident. */
const MIN_LAYER_GAP = 1e-3;
const OPPOSING_MARGIN = 1e-4;

const layerKind = fc.constantFrom(...LAYER_KINDS);

function layerArbitrary(clearanceEpsilon: number, tau: number): fc.Arbitrary<Layer> {
  const azimuth = fc.double({ min: 0, max: 2 * Math.PI, noNaN: true, maxExcluded: true });
  const farDistance = fc.double({ min: clearanceEpsilon + OPPOSING_MARGIN, max: 1, noNaN: true });
  return layerKind.chain((kind): fc.Arbitrary<Layer> => {
    switch (kind) {
      case "coincident":
        return fc.record({
          kind: fc.constant(kind),
          distance: fc.double({ min: 0.05 * clearanceEpsilon, max: 0.95 * clearanceEpsilon, noNaN: true }),
          dot: fc.constant(-1),
          azimuth,
        });
      case "grazing":
        return fc.record({
          kind: fc.constant(kind),
          distance: farDistance,
          dot: fc.double({ min: -tau + 0.005, max: -0.001, noNaN: true }),
          azimuth,
        });
      case "backfacing":
        return fc.record({ kind: fc.constant(kind), distance: farDistance, dot: fc.double({ min: 0.05, max: 1, noNaN: true }), azimuth });
      case "opposing":
        return fc.record({
          kind: fc.constant(kind),
          distance: farDistance,
          dot: fc.oneof(fc.constant(-1), fc.double({ min: -1, max: -(tau + 0.01), noNaN: true })),
          azimuth,
        });
    }
  });
}

const rotationArbitrary: fc.Arbitrary<[number, number, number, number]> = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter(([x, y, z, w]) => Math.hypot(x, y, z, w) >= 0.1)
  .map(([x, y, z, w]) => {
    const norm = Math.hypot(x, y, z, w);
    return [x / norm, y / norm, z / norm, w / norm] as [number, number, number, number];
  });

export const layerStackArbitrary: fc.Arbitrary<LayerStack> = fc
  .record({
    microShrink: fc.double({ min: 1e-5, max: 2e-4, noNaN: true }),
    clearanceFraction: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
    tau: fc.double({ min: 0.02, max: 0.9, noNaN: true }),
  })
  .chain(({ microShrink, clearanceFraction, tau }) => {
    const clearanceEpsilon = microShrink * clearanceFraction;
    return fc
      .record({
        layers: fc.array(layerArbitrary(clearanceEpsilon, tau), { minLength: 1, maxLength: 4 }),
        order: fc.infiniteStream(fc.integer({ min: 0, max: 1_000_000 })),
        rotation: rotationArbitrary,
      })
      .map(({ layers, order, rotation }) => {
        const sorted = layers.slice().sort((a, b) => a.distance - b.distance);
        // Keep every layer that is not coincident at least MIN_LAYER_GAP behind the previous one.
        let previous = -Infinity;
        const spaced = sorted.map((layer) => {
          if (layer.kind === "coincident") {
            return layer;
          }
          const distance = Math.max(layer.distance, previous + MIN_LAYER_GAP);
          previous = distance;
          return { ...layer, distance };
        });
        // Fisher-Yates with draws taken from the fast-check stream, so a failure replays from the seed.
        const permutation = spaced.map((_, index) => index);
        const draws = order[Symbol.iterator]();
        for (let i = permutation.length - 1; i > 0; i--) {
          const draw = draws.next().value as number;
          const j = draw % (i + 1);
          const swap = permutation[i] ?? 0;
          permutation[i] = permutation[j] ?? 0;
          permutation[j] = swap;
        }
        return { microShrink, clearanceEpsilon, tau, layers: spaced, permutation, rotation };
      });
  });

/** Turns a layer stack into a moving triangle, a target Part of one triangle per layer, and the expected answer. */
export function buildLayerScene(stack: LayerStack): LayerScene {
  const rotation = new Quaternion(...stack.rotation);
  const rotate = (x: number, y: number, z: number): Vec3 => {
    const v = new Vector3(x, y, z).applyQuaternion(rotation);
    return [v.x, v.y, v.z];
  };

  // Moving triangle: normal +Z, so the oracle's origins sit `microShrink` behind it.
  const s = MOVING_SIZE;
  const movingPositions = [...rotate(0, 0, 0), ...rotate(s, 0, 0), ...rotate(0, s, 0)];
  const moving = makeClashPart("moving", movingPositions, [0, 1, 2]);
  const dir = rotate(0, 0, 1);
  const origin = rotate(0, 0, -stack.microShrink);

  const positions = new Array<number>(9 * stack.layers.length).fill(0);
  const planeCorners: readonly (readonly [number, number])[] = [
    [-4, -6],
    [8, -6],
    [-4, 6],
  ];
  stack.layers.forEach((layer, j) => {
    const triangle = stack.permutation[j] ?? j;
    const nz = layer.dot;
    const nh = Math.sqrt(Math.max(0, 1 - nz * nz));
    const n = new Vector3(nh * Math.cos(layer.azimuth), nh * Math.sin(layer.azimuth), nz);
    // `u` is horizontal and perpendicular to `n`, and `v = n x u`, so `u x v = n` and the corner order is outward.
    const u = Math.abs(nz) > 1 - 1e-12 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1).cross(n).normalize();
    const v = new Vector3().crossVectors(n, u);
    const center = new Vector3(0, 0, -stack.microShrink + layer.distance);
    planeCorners.forEach(([a, b], k) => {
      const corner = center.clone().addScaledVector(u, a).addScaledVector(v, b);
      positions.splice(9 * triangle + 3 * k, 3, ...rotate(corner.x, corner.y, corner.z));
    });
  });
  const target = makeClashPart(
    "target",
    positions,
    stack.layers.flatMap((_, t) => [3 * t, 3 * t + 1, 3 * t + 2]),
  );

  const opposing = stack.layers.findIndex((layer) => layer.kind === "opposing");
  const expectedTriangle = opposing === -1 ? -1 : (stack.permutation[opposing] ?? -1);
  return { moving, target, dir, origin, expectedTriangle, masksOpposing: opposing > 0 };
}
