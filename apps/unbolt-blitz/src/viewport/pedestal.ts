import type { Vec3 } from "@unboltkit/core";
import type { Aabb } from "../game/blitzEngine";
import {
  CanvasTexture,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector2,
} from "three";
import type { Material, Texture } from "three";
import { createCanvas2d, createSeededRandom } from "./proceduralCanvas";
import type { ResourceTracker } from "./resourceTracker";

/**
 * Watchmaker's turntable (Req 9.4): a dark-slate platter with an engraved brass degree dial, a raised
 * brushed-brass bevel ring around its rim, and a darker plinth under it. The platter top is lighter
 * than the blackened-steel and graphite hardware, so every housing silhouette reads against it.
 */
export const PEDESTAL_COLOR = 0x262c3c;
export const PEDESTAL_METALNESS = 0.55;
export const PEDESTAL_ROUGHNESS = 0.42;
export const PEDESTAL_BEVEL_COLOR = 0xdda547;
export const PEDESTAL_BEVEL_METALNESS = 0.9;
export const PEDESTAL_BEVEL_ROUGHNESS = 0.22;

/** Plinth under the platter: a second, slightly wider tier in darker charcoal metal. */
export const PEDESTAL_FOOT_COLOR = 0x1b202b;
export const PEDESTAL_FOOT_METALNESS = 0.7;
export const PEDESTAL_FOOT_ROUGHNESS = 0.5;

/** Sizes in normalized units. The assembly has `maxExtent = 1.0`. */
export const PEDESTAL_RADIUS = 0.85;
export const PEDESTAL_HEIGHT = 0.09;
export const PEDESTAL_FOOT_RADIUS = 0.93;
export const PEDESTAL_FOOT_HEIGHT = 0.045;
/** Gap between the lowest assembly point and the pedestal top. */
export const PEDESTAL_TOP_GAP = 0.01;

/**
 * Brass bevel ring. It stands `PEDESTAL_RING_RISE` above the platter top, wraps the rim as a collar
 * that reaches `PEDESTAL_RING_DROP` down the platter wall, and has 45 degree chamfers on both top
 * edges. The outer chamfer faces the front-left brass key light, which is what lights the rim.
 */
export const PEDESTAL_RING_OVERHANG = 0.008;
export const PEDESTAL_RING_WIDTH = 0.072;
export const PEDESTAL_RING_RISE = 0.022;
export const PEDESTAL_RING_DROP = 0.032;
export const PEDESTAL_RING_CHAMFER = 0.014;

/** Emissive strength of the engraved dial lines. Low, so the dial stays a quiet detail. */
export const PEDESTAL_DIAL_EMISSIVE = 0.42;
const DIAL_TEXTURE_SIZE = 1024;
const BRUSH_TEXTURE_WIDTH = 16;
const BRUSH_TEXTURE_HEIGHT = 512;
const BRUSH_SEED = 0xb2a55;
const BRASS_RGB = "221, 165, 71";

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

/** A sphere in world space: where the key light's shadow frustum must reach. */
export interface ShadowFocus {
  center: [number, number, number];
  radius: number;
}

/**
 * Smallest sphere around the assembly bounds and the platter top disc, which is where every shadow
 * is cast and received. The disc is centered on the world Y axis at `topY` (see `createPedestal`).
 * Its farthest point from the bounds center is one platter radius beyond the horizontal offset.
 */
export function pedestalShadowFocus(bounds: Aabb, topY: number): ShadowFocus {
  const center: [number, number, number] = [
    ((bounds.min[0] as number) + (bounds.max[0] as number)) / 2,
    ((bounds.min[1] as number) + (bounds.max[1] as number)) / 2,
    ((bounds.min[2] as number) + (bounds.max[2] as number)) / 2,
  ];
  const boundsRadius =
    Math.hypot(
      (bounds.max[0] as number) - (bounds.min[0] as number),
      (bounds.max[1] as number) - (bounds.min[1] as number),
      (bounds.max[2] as number) - (bounds.min[2] as number),
    ) / 2;
  const platterReach = Math.hypot(Math.hypot(center[0], center[2]) + PEDESTAL_RADIUS, center[1] - topY);
  return { center, radius: Math.max(boundsRadius, platterReach) };
}

/**
 * Closed (radius, height) profile of the bevel ring for `LatheGeometry`, counter-clockwise so the
 * face normals point out of the metal: up the outer wall, along the top, down the inner wall and
 * back along the underside. Every corner is listed twice, which gives each facet its own normal and
 * keeps the chamfers crisp instead of smoothing them into a rounded bead.
 */
export function bevelRingProfile(topY: number): Vector2[] {
  const outer = PEDESTAL_RADIUS + PEDESTAL_RING_OVERHANG;
  const inner = outer - PEDESTAL_RING_WIDTH;
  const rise = PEDESTAL_RING_RISE;
  const chamfer = PEDESTAL_RING_CHAMFER;
  const bottom = -PEDESTAL_RING_DROP;
  const at = (radius: number, height: number): Vector2 => new Vector2(radius, topY + height);
  return [
    at(outer, bottom),
    at(outer, rise - chamfer),
    at(outer, rise - chamfer),
    at(outer - chamfer, rise),
    at(outer - chamfer, rise),
    at(inner + chamfer, rise),
    at(inner + chamfer, rise),
    at(inner, rise - chamfer),
    at(inner, rise - chamfer),
    at(inner, bottom),
    at(inner, bottom),
    at(outer, bottom),
  ];
}

/**
 * Engraved degree dial for the platter top, as an in-memory `CanvasTexture`: brass tick marks every
 * degree (longer at 5 and 10), numerals every 30 degrees and a few faint concentric rings, on black.
 * It is used as the emissive map, so black adds nothing and the brass lines glow softly. The disc is
 * inscribed in the square canvas, which is how `CylinderGeometry` maps its top cap. Zero degrees is at
 * the front of the turntable. Returns null when there is no `document` (headless Node tests).
 */
export function createDialTexture(): CanvasTexture | null {
  const surface = createCanvas2d(DIAL_TEXTURE_SIZE, DIAL_TEXTURE_SIZE);
  if (surface === null) return null;
  const { canvas, ctx } = surface;
  const radius = DIAL_TEXTURE_SIZE / 2;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, DIAL_TEXTURE_SIZE, DIAL_TEXTURE_SIZE);
  ctx.translate(radius, radius);
  ctx.lineCap = "butt";

  const brass = (alpha: number): string => `rgba(${BRASS_RGB}, ${alpha})`;

  // Concentric rings. They run under the assembly and show between its parts.
  for (const [fraction, alpha, width] of [
    [0.3, 0.16, 1.5],
    [0.46, 0.2, 1.5],
    [0.62, 0.26, 2],
    [0.7, 0.3, 1.5],
  ] as const) {
    ctx.beginPath();
    ctx.arc(0, 0, radius * fraction, 0, Math.PI * 2);
    ctx.strokeStyle = brass(alpha);
    ctx.lineWidth = width;
    ctx.stroke();
  }

  // Scale track.
  const trackOuter = radius * 0.905;
  const trackInner = radius * 0.8;
  for (const [edge, alpha] of [
    [trackOuter, 0.85],
    [trackInner, 0.5],
  ] as const) {
    ctx.beginPath();
    ctx.arc(0, 0, edge, 0, Math.PI * 2);
    ctx.strokeStyle = brass(alpha);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Ticks: angles run clockwise from the front, because canvas rotation is clockwise.
  for (let degree = 0; degree < 360; degree++) {
    const major = degree % 10 === 0;
    const medium = !major && degree % 5 === 0;
    const length = major ? radius * 0.075 : medium ? radius * 0.045 : radius * 0.022;
    ctx.save();
    ctx.rotate((degree * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(trackOuter, 0);
    ctx.lineTo(trackOuter - length, 0);
    ctx.strokeStyle = brass(major ? 0.9 : medium ? 0.65 : 0.38);
    ctx.lineWidth = major ? 2.5 : 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // Numerals every 30 degrees, top of the glyph toward the center, so the near side reads upright.
  ctx.font = '600 26px Georgia, "Times New Roman", serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = brass(0.8);
  for (let degree = 0; degree < 360; degree += 30) {
    ctx.save();
    ctx.rotate((degree * Math.PI) / 180);
    ctx.translate(radius * 0.745, 0);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(String(degree), 0, 0);
    ctx.restore();
  }

  const texture = new CanvasTexture(canvas);
  texture.name = "turntable-dial";
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Roughness map for the brass ring: fine concentric rows of slightly different roughness, so the
 * polished brass reads as brushed. Rows run along `u` (around the ring), values stay in 0.8 to 1.0 of
 * the material roughness. Seeded, so every load looks the same. Null without a `document`.
 */
export function createBrushedBrassTexture(): CanvasTexture | null {
  const surface = createCanvas2d(BRUSH_TEXTURE_WIDTH, BRUSH_TEXTURE_HEIGHT);
  if (surface === null) return null;
  const { canvas, ctx } = surface;
  const random = createSeededRandom(BRUSH_SEED);
  let previous = 0.5;
  for (let row = 0; row < BRUSH_TEXTURE_HEIGHT; row++) {
    previous = previous * 0.35 + random() * 0.65;
    const level = Math.round(255 * (0.8 + 0.2 * previous));
    ctx.fillStyle = `rgb(${level}, ${level}, ${level})`;
    ctx.fillRect(0, row, BRUSH_TEXTURE_WIDTH, 1);
  }
  const texture = new CanvasTexture(canvas);
  texture.name = "brushed-brass-roughness";
  texture.anisotropy = 8;
  return texture;
}

function slateMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: PEDESTAL_COLOR,
    metalness: PEDESTAL_METALNESS,
    roughness: PEDESTAL_ROUGHNESS,
  });
}

/**
 * A multi-tier metallic turntable. Its top face sits just below `lowestY`.
 *
 * - `pedestal-foot`: a wider, darker plinth under the platter.
 * - `pedestal-base`: the dark-slate platter. It receives the soft shadows of the assembly and carries
 *   the engraved dial on its top face when a canvas is available.
 * - `pedestal-bevel`: the raised brushed-brass ring around the rim. It casts a shadow onto the platter.
 *
 * Geometries, materials and textures are registered with `tracker` when one is given. Release them
 * with `releasePedestal`.
 */
export function createPedestal(lowestY: number, tracker?: ResourceTracker): Group {
  const { topY, centerY } = pedestalLayout(lowestY);
  const group = new Group();
  group.name = "pedestal";

  const dial = createDialTexture();
  const brush = createBrushedBrassTexture();

  // Plinth.
  const footGeometry = new CylinderGeometry(PEDESTAL_FOOT_RADIUS, PEDESTAL_FOOT_RADIUS + 0.02, PEDESTAL_FOOT_HEIGHT, 128, 1);
  const footMaterial = new MeshStandardMaterial({
    color: PEDESTAL_FOOT_COLOR,
    metalness: PEDESTAL_FOOT_METALNESS,
    roughness: PEDESTAL_FOOT_ROUGHNESS,
  });
  const foot = new Mesh(footGeometry, footMaterial);
  foot.name = "pedestal-foot";
  foot.position.y = topY - PEDESTAL_HEIGHT - PEDESTAL_FOOT_HEIGHT / 2 + 0.002;

  // Platter. CylinderGeometry groups are [side, top cap, bottom cap], so only the top gets the dial.
  const baseGeometry = new CylinderGeometry(PEDESTAL_RADIUS, PEDESTAL_RADIUS, PEDESTAL_HEIGHT, 128, 1);
  const sideMaterial = slateMaterial();
  const topMaterial = slateMaterial();
  if (dial !== null) {
    topMaterial.emissive.set(0xffffff);
    topMaterial.emissiveMap = dial;
    topMaterial.emissiveIntensity = PEDESTAL_DIAL_EMISSIVE;
  }
  const base = new Mesh(baseGeometry, [sideMaterial, topMaterial, sideMaterial]);
  base.name = "pedestal-base";
  base.position.y = centerY;
  base.receiveShadow = true;

  // Brass ring.
  const ringGeometry = new LatheGeometry(bevelRingProfile(topY), 192);
  const ringMaterial = new MeshStandardMaterial({
    color: PEDESTAL_BEVEL_COLOR,
    metalness: PEDESTAL_BEVEL_METALNESS,
    roughness: PEDESTAL_BEVEL_ROUGHNESS,
  });
  if (brush !== null) ringMaterial.roughnessMap = brush;
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.name = "pedestal-bevel";
  ring.castShadow = true;

  group.add(foot, base, ring);

  if (tracker !== undefined) {
    for (const item of [footGeometry, footMaterial, baseGeometry, sideMaterial, topMaterial, ringGeometry, ringMaterial]) {
      tracker.track(item);
    }
    if (dial !== null) tracker.track(dial);
    if (brush !== null) tracker.track(brush);
  }
  return group;
}

/**
 * Disposes every geometry, material and texture of a pedestal made by `createPedestal` that is
 * tracked by `tracker`. Material arrays and texture maps are covered, which a plain
 * `release(mesh.material)` would miss.
 */
export function releasePedestal(pedestal: Group, tracker: ResourceTracker): void {
  pedestal.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    tracker.release(mesh.geometry);
    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      tracker.release(material);
      const maps: (Texture | null)[] = [
        (material as MeshStandardMaterial).emissiveMap,
        (material as MeshStandardMaterial).roughnessMap,
      ];
      for (const map of maps) {
        if (map !== null) tracker.release(map);
      }
    }
  });
}
