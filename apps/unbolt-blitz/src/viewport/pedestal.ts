import type { Vec3 } from "@unboltkit/core";
import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
} from "three";
import type { ResourceTracker } from "./resourceTracker";

/**
 * Machined-slate turntable with a brushed-brass bevel ring (Req 9.4). The top is lighter than the
 * blackened-steel and graphite hardware, so every housing silhouette reads against it.
 */
export const PEDESTAL_COLOR = 0x2a3040;
export const PEDESTAL_METALNESS = 0.65;
export const PEDESTAL_ROUGHNESS = 0.42;
export const PEDESTAL_BEVEL_COLOR = 0xb88635;
export const PEDESTAL_BEVEL_METALNESS = 0.85;
export const PEDESTAL_BEVEL_ROUGHNESS = 0.28;

/** Sizes in normalized units. The assembly has `maxExtent = 1.0`. */
export const PEDESTAL_RADIUS = 0.85;
export const PEDESTAL_HEIGHT = 0.09;
export const PEDESTAL_BEVEL_TUBE = 0.012;
/** Gap between the lowest assembly point and the pedestal top. */
export const PEDESTAL_TOP_GAP = 0.01;

export interface PedestalLayout {
  /** World Y of the turntable top face. */
  topY: number;
  /** World Y of the cylinder center. */
  centerY: number;
}

/** Lowest Y of a set of AABBs (normalized +Y is up). Throws `RangeError` for no boxes. */
export function lowestAabbY(boxes: readonly { min: Vec3 }[]): number {
  if (boxes.length === 0) {
    throw new RangeError("lowestAabbY needs at least one box.");
  }
  let lowest = Infinity;
  for (const box of boxes) {
    const y = box.min[1] as number;
    if (y < lowest) lowest = y;
  }
  return lowest;
}

/** Places the turntable top just below the lowest assembly point. */
export function pedestalLayout(lowestY: number): PedestalLayout {
  const topY = lowestY - PEDESTAL_TOP_GAP;
  return { topY, centerY: topY - PEDESTAL_HEIGHT / 2 };
}

/**
 * A metallic turntable: a cylinder with a thin bevel ring on the top edge. Its
 * top face sits just below `lowestY`. Geometries and materials are registered
 * with `tracker` when one is given.
 */
export function createPedestal(lowestY: number, tracker?: ResourceTracker): Group {
  const { topY, centerY } = pedestalLayout(lowestY);
  const group = new Group();
  group.name = "pedestal";

  const baseGeometry = new CylinderGeometry(PEDESTAL_RADIUS, PEDESTAL_RADIUS, PEDESTAL_HEIGHT, 96, 1);
  const baseMaterial = new MeshStandardMaterial({
    color: PEDESTAL_COLOR,
    metalness: PEDESTAL_METALNESS,
    roughness: PEDESTAL_ROUGHNESS,
  });
  const base = new Mesh(baseGeometry, baseMaterial);
  base.name = "pedestal-base";
  base.position.y = centerY;

  const ringGeometry = new TorusGeometry(PEDESTAL_RADIUS - PEDESTAL_BEVEL_TUBE, PEDESTAL_BEVEL_TUBE, 12, 96);
  const ringMaterial = new MeshStandardMaterial({
    color: PEDESTAL_BEVEL_COLOR,
    metalness: PEDESTAL_BEVEL_METALNESS,
    roughness: PEDESTAL_BEVEL_ROUGHNESS,
  });
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.name = "pedestal-bevel";
  ring.rotation.x = Math.PI / 2;
  ring.position.y = topY - PEDESTAL_BEVEL_TUBE;

  group.add(base, ring);

  if (tracker !== undefined) {
    tracker.track(baseGeometry);
    tracker.track(baseMaterial);
    tracker.track(ringGeometry);
    tracker.track(ringMaterial);
  }
  return group;
}
