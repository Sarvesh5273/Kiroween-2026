/**
 * Ghost extraction preview: a translucent holographic teal copy of a part, pushed out along its exit
 * direction, with an arrow from the part toward the ghost.
 *
 * It lives for `GHOST_HINT_DURATION_MS`. Under reduced motion it holds steady opacity and the arrow
 * does not move. Every geometry and material it creates is registered with the Arena's tracker and
 * released by `clear()`, so a level change, an unbolt or `dispose()` leaves nothing behind.
 */
import type { Vec3 } from "@unboltkit/core";
import {
  AdditiveBlending,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { BufferGeometry, Scene } from "three";
import { ARENA_PALETTE } from "./arenaConfig";
import type { ResourceTracker } from "./resourceTracker";

export const GHOST_HINT_DURATION_MS = 2500;
export const GHOST_PULSE_PERIOD_MS = 900;
export const GHOST_MIN_OPACITY = 0.18;
export const GHOST_MAX_OPACITY = 0.5;
export const GHOST_STEADY_OPACITY = 0.38;
/** The ghost travels at least this far (normalized units), so a free part still shows a visible gap. */
export const GHOST_MIN_TRAVEL = 0.12;
/** The ghost never travels farther than this, so it stays inside the framed view. */
export const GHOST_MAX_TRAVEL = 0.6;
const ARROW_OVERSHOOT = 0.1;
const ARROW_BOB = 0.025;
const ARROW_BOB_PERIOD_MS = 700;

/** Ghost travel for an escape distance: clamped to [GHOST_MIN_TRAVEL, GHOST_MAX_TRAVEL]. */
export function ghostTravel(distance: number): number {
  const safe = Number.isFinite(distance) ? distance : GHOST_MAX_TRAVEL;
  return Math.min(GHOST_MAX_TRAVEL, Math.max(GHOST_MIN_TRAVEL, safe));
}

/** Opacity of the ghost fill `elapsedMs` after it appeared. Steady when `reduced`. */
export function ghostOpacity(elapsedMs: number, reduced: boolean): number {
  if (reduced) return GHOST_STEADY_OPACITY;
  const phase = 0.5 + 0.5 * Math.sin((2 * Math.PI * elapsedMs) / GHOST_PULSE_PERIOD_MS);
  return GHOST_MIN_OPACITY + (GHOST_MAX_OPACITY - GHOST_MIN_OPACITY) * phase;
}

const Y_AXIS = new Vector3(0, 1, 0);

export class GhostPreview {
  private group: Group | null = null;
  private fill: MeshBasicMaterial | null = null;
  private arrow: Group | null = null;
  private arrowBase = new Vector3();
  private arrowDir = new Vector3();
  private startedAt = 0;
  private reduced: boolean;

  constructor(
    private readonly scene: Scene,
    private readonly tracker: ResourceTracker,
    reduced: boolean,
  ) {
    this.reduced = reduced;
  }

  get active(): boolean {
    return this.group !== null;
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
  }

  /**
   * Shows the ghost of `source` moved by `travel` along `dir`, and an arrow from `origin`.
   * `source` is cloned, so releasing the part's own geometry later never affects the ghost.
   * Replaces a ghost that is already shown.
   */
  show(source: BufferGeometry, origin: Vec3, dir: Vec3, distance: number, nowMs: number): void {
    this.clear();
    const direction = new Vector3(dir[0], dir[1], dir[2]);
    if (!(direction.lengthSq() > 0)) throw new RangeError("Ghost hint needs a non-zero direction.");
    direction.normalize();
    const travel = ghostTravel(distance);

    const group = new Group();
    group.name = "ghost-hint";

    const geometry = this.tracker.track(source.clone());
    const fill = this.tracker.track(
      new MeshBasicMaterial({
        color: ARENA_PALETTE.teal,
        transparent: true,
        opacity: this.reduced ? GHOST_STEADY_OPACITY : GHOST_MAX_OPACITY,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    );
    const ghost = new Mesh(geometry, fill);
    ghost.position.copy(direction).multiplyScalar(travel);
    ghost.renderOrder = 20;
    group.add(ghost);

    const edgeGeometry = this.tracker.track(new EdgesGeometry(geometry, 30));
    const edges = this.tracker.track(
      new LineBasicMaterial({ color: ARENA_PALETTE.teal, transparent: true, opacity: 0.85, depthTest: false }),
    );
    const outline = new LineSegments(edgeGeometry, edges);
    outline.position.copy(ghost.position);
    outline.renderOrder = 21;
    group.add(outline);

    group.add(this.buildArrow(origin, direction, travel));

    this.scene.add(group);
    this.group = group;
    this.fill = fill;
    this.startedAt = nowMs;
  }

  private buildArrow(origin: Vec3, direction: Vector3, travel: number): Group {
    const length = travel + ARROW_OVERSHOOT;
    const headLength = 0.07;
    const shaftLength = Math.max(0.02, length - headLength);
    const material = this.tracker.track(
      new MeshBasicMaterial({ color: ARENA_PALETTE.teal, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    const shaftGeometry = this.tracker.track(new CylinderGeometry(0.006, 0.006, shaftLength, 10));
    const headGeometry = this.tracker.track(new ConeGeometry(0.022, headLength, 14));
    const markerGeometry = this.tracker.track(new SphereGeometry(0.02, 12, 8));

    const shaft = new Mesh(shaftGeometry, material);
    shaft.position.y = shaftLength / 2;
    const head = new Mesh(headGeometry, material);
    head.position.y = shaftLength + headLength / 2;
    const marker = new Mesh(markerGeometry, material);

    const arrow = new Group();
    arrow.add(shaft, head, marker);
    for (const part of arrow.children) part.renderOrder = 22;
    arrow.quaternion.copy(new Quaternion().setFromUnitVectors(Y_AXIS, direction));
    arrow.position.set(origin[0], origin[1], origin[2]);
    this.arrow = arrow;
    this.arrowBase.copy(arrow.position);
    this.arrowDir.copy(direction);
    return arrow;
  }

  /** Pulses the ghost and expires it after `GHOST_HINT_DURATION_MS`. */
  update(nowMs: number): void {
    if (this.group === null) return;
    const elapsed = nowMs - this.startedAt;
    if (elapsed >= GHOST_HINT_DURATION_MS) {
      this.clear();
      return;
    }
    if (this.fill !== null) this.fill.opacity = ghostOpacity(elapsed, this.reduced);
    if (this.arrow !== null && !this.reduced) {
      const bob = ARROW_BOB * (0.5 + 0.5 * Math.sin((2 * Math.PI * elapsed) / ARROW_BOB_PERIOD_MS));
      this.arrow.position.copy(this.arrowBase).addScaledVector(this.arrowDir, bob);
    }
  }

  /** Removes the ghost from the scene and releases its geometry and materials. Safe to call twice. */
  clear(): void {
    const group = this.group;
    if (group === null) return;
    this.scene.remove(group);
    group.traverse((object) => {
      const renderable = object as Mesh | LineSegments;
      if (renderable.geometry === undefined) return;
      this.tracker.release(renderable.geometry);
      const material = renderable.material;
      if (!Array.isArray(material)) this.tracker.release(material);
    });
    this.group = null;
    this.fill = null;
    this.arrow = null;
  }
}
