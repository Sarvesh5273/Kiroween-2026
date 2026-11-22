/**
 * Arena effects: teal unbolt burst, crimson clash spark, blocked-part shudder
 * and the one-frame flash used under reduced motion (Req 11.4, 11.9, 12.1, 12.2).
 *
 * Randomness comes only from a seeded PRNG evaluated at module load, so every
 * burst has the same shape and runs reproduce.
 */
import type { Vec3 } from "@unboltkit/core";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  type Object3D,
} from "three";
import { ARENA_PALETTE } from "./arenaConfig";
import type { Disposable, ResourceTracker } from "./resourceTracker";

// ---------------------------------------------------------------------------
// Seeded particle directions
// ---------------------------------------------------------------------------

/** Small seeded PRNG (mulberry32). Returns numbers in [0, 1). */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` unit vectors, uniform on the sphere, flattened as x, y, z. Same seed gives the same vectors. */
export function seededUnitDirections(seed: number, count: number): Float32Array {
  const next = seededRandom(seed);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = next() * 2 - 1;
    const phi = next() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    out[i * 3] = r * Math.cos(phi);
    out[i * 3 + 1] = r * Math.sin(phi);
    out[i * 3 + 2] = z;
  }
  return out;
}

export interface ParticleSpec {
  count: number;
  durationMs: number;
  /** Travel distance of a particle at the end, normalized units. */
  radius: number;
  size: number;
  color: number;
  seed: number;
}

/** Teal unbolt burst: 28 particles, 450 ms fade. */
export const BURST_SPEC: ParticleSpec = Object.freeze({
  count: 28,
  durationMs: 450,
  radius: 0.14,
  size: 0.022,
  color: ARENA_PALETTE.teal,
  seed: 0x7ea1b0,
});

/** Crimson clash spark: a short, tight burst. */
export const SPARK_SPEC: ParticleSpec = Object.freeze({
  count: 16,
  durationMs: 320,
  radius: 0.1,
  size: 0.018,
  color: ARENA_PALETTE.crimson,
  seed: 0x0c1a54,
});

const BURST_DIRECTIONS = seededUnitDirections(BURST_SPEC.seed, BURST_SPEC.count);
const SPARK_DIRECTIONS = seededUnitDirections(SPARK_SPEC.seed, SPARK_SPEC.count);

// ---------------------------------------------------------------------------
// Pure envelopes
// ---------------------------------------------------------------------------

/** `1 - (1 - t)^3` on [0, 1]. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/** Opacity of a fading particle: 1 at the start, 0 at `durationMs` and later. */
export function fadeEnvelope(elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  return 1 - Math.min(1, Math.max(0, elapsedMs / durationMs));
}

export const SHUDDER_DURATION_MS = 280;
/** Peak offset in normalized units. */
export const SHUDDER_AMPLITUDE = 0.015;
export const SHUDDER_CYCLES = 4;
export const SHUDDER_DECAY = 4;
/** Fixed lateral axis of the shudder. */
export const SHUDDER_AXIS: Vec3 = [1, 0, 0];

/**
 * Damped sine offset along `SHUDDER_AXIS`. It is 0 at the start and at
 * `SHUDDER_DURATION_MS` and later, and its magnitude never exceeds
 * `SHUDDER_AMPLITUDE`.
 */
export function shudderOffset(elapsedMs: number): number {
  if (!(elapsedMs > 0) || elapsedMs >= SHUDDER_DURATION_MS) return 0;
  const u = elapsedMs / SHUDDER_DURATION_MS;
  return SHUDDER_AMPLITUDE * Math.exp(-SHUDDER_DECAY * u) * Math.sin(2 * Math.PI * SHUDDER_CYCLES * u);
}

// ---------------------------------------------------------------------------
// Effects system
// ---------------------------------------------------------------------------

interface ParticleEffect {
  points: Points;
  geometry: BufferGeometry;
  material: PointsMaterial;
  directions: Float32Array;
  spec: ParticleSpec;
  startMs: number;
}

interface FlashEffect {
  mesh: Mesh;
  geometry: SphereGeometry;
  material: MeshBasicMaterial;
  /** Number of `update` calls seen. The flash is removed on the second one. */
  updates: number;
}

interface ShudderEffect {
  mesh: Mesh;
  startMs: number;
  previousMatrixAutoUpdate: boolean;
}

const FLASH_RADIUS = 0.07;

/**
 * Owns every transient effect object. Effects add and remove their own scene
 * objects. Call `update(nowMs)` once per frame before rendering.
 */
export class EffectsSystem {
  private readonly particles = new Set<ParticleEffect>();
  private readonly flashes = new Set<FlashEffect>();
  private readonly shudders = new Map<string, ShudderEffect>();

  constructor(
    private readonly scene: Object3D,
    private readonly tracker?: ResourceTracker,
    private reducedMotion = false,
  ) {}

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Number of running particle, flash and shudder effects. */
  get activeCount(): number {
    return this.particles.size + this.flashes.size + this.shudders.size;
  }

  /** Teal burst at `center`, or a one-frame teal flash under reduced motion (Req 11.4, 11.9). */
  unboltBurst(center: Vec3, nowMs: number): void {
    if (this.reducedMotion) {
      this.addFlash(center, ARENA_PALETTE.teal);
    } else {
      this.addParticles(center, BURST_SPEC, BURST_DIRECTIONS, nowMs);
    }
  }

  /** Crimson clash spark at `center`, or a one-frame crimson flash under reduced motion (Req 12.2). */
  clashSpark(center: Vec3, nowMs: number): void {
    if (this.reducedMotion) {
      this.addFlash(center, ARENA_PALETTE.crimson);
    } else {
      this.addParticles(center, SPARK_SPEC, SPARK_DIRECTIONS, nowMs);
    }
  }

  /**
   * Starts a crimson shudder on a part mesh (Req 12.1). It takes over the mesh
   * matrix, so call `cancelShudder` before an exit animation starts on the
   * same mesh. Under reduced motion it does nothing. Returns whether it started.
   */
  startShudder(partId: string, mesh: Mesh, nowMs: number): boolean {
    if (this.reducedMotion) return false;
    const existing = this.shudders.get(partId);
    if (existing !== undefined) {
      existing.startMs = nowMs;
      return true;
    }
    this.shudders.set(partId, {
      mesh,
      startMs: nowMs,
      previousMatrixAutoUpdate: mesh.matrixAutoUpdate,
    });
    return true;
  }

  /** Stops a shudder and returns the mesh to its rest matrix. */
  cancelShudder(partId: string): void {
    const shudder = this.shudders.get(partId);
    if (shudder === undefined) return;
    this.restoreShudder(shudder);
    this.shudders.delete(partId);
  }

  update(nowMs: number): void {
    for (const effect of [...this.particles]) {
      const elapsed = Math.max(0, nowMs - effect.startMs);
      if (elapsed >= effect.spec.durationMs) {
        this.removeParticles(effect);
        continue;
      }
      const travel = effect.spec.radius * easeOutCubic(elapsed / effect.spec.durationMs);
      const attribute = effect.geometry.getAttribute("position") as BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let i = 0; i < effect.spec.count * 3; i++) {
        array[i] = (effect.directions[i] as number) * travel;
      }
      attribute.needsUpdate = true;
      effect.material.opacity = fadeEnvelope(elapsed, effect.spec.durationMs);
    }

    for (const flash of [...this.flashes]) {
      flash.updates += 1;
      if (flash.updates > 1) this.removeFlash(flash);
    }

    for (const [partId, shudder] of [...this.shudders]) {
      const elapsed = nowMs - shudder.startMs;
      if (elapsed >= SHUDDER_DURATION_MS) {
        this.restoreShudder(shudder);
        this.shudders.delete(partId);
        continue;
      }
      const offset = shudderOffset(elapsed);
      shudder.mesh.matrixAutoUpdate = false;
      shudder.mesh.matrix.makeTranslation(
        SHUDDER_AXIS[0] * offset,
        SHUDDER_AXIS[1] * offset,
        SHUDDER_AXIS[2] * offset,
      );
      shudder.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  /** Removes every effect and releases its resources. */
  dispose(): void {
    for (const effect of [...this.particles]) this.removeParticles(effect);
    for (const flash of [...this.flashes]) this.removeFlash(flash);
    for (const shudder of this.shudders.values()) this.restoreShudder(shudder);
    this.shudders.clear();
  }

  private addParticles(center: Vec3, spec: ParticleSpec, directions: Float32Array, nowMs: number): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(spec.count * 3), 3));
    const material = new PointsMaterial({
      color: spec.color,
      size: spec.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const points = new Points(geometry, material);
    points.position.set(center[0], center[1], center[2]);
    // Positions are rewritten every frame, so the initial bounding sphere is useless.
    points.frustumCulled = false;
    this.track(geometry);
    this.track(material);
    this.scene.add(points);
    this.particles.add({ points, geometry, material, directions, spec, startMs: nowMs });
  }

  private addFlash(center: Vec3, color: number): void {
    const geometry = new SphereGeometry(FLASH_RADIUS, 12, 8);
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(center[0], center[1], center[2]);
    mesh.raycast = () => undefined; // a flash must never be picked
    this.track(geometry);
    this.track(material);
    this.scene.add(mesh);
    this.flashes.add({ mesh, geometry, material, updates: 0 });
  }

  private removeParticles(effect: ParticleEffect): void {
    this.scene.remove(effect.points);
    this.release(effect.geometry);
    this.release(effect.material);
    this.particles.delete(effect);
  }

  private removeFlash(flash: FlashEffect): void {
    this.scene.remove(flash.mesh);
    this.release(flash.geometry);
    this.release(flash.material);
    this.flashes.delete(flash);
  }

  private restoreShudder(shudder: ShudderEffect): void {
    shudder.mesh.matrix.identity();
    shudder.mesh.matrixAutoUpdate = shudder.previousMatrixAutoUpdate;
    shudder.mesh.matrixWorldNeedsUpdate = true;
  }

  private track(item: Disposable): void {
    this.tracker?.track(item);
  }

  /** Disposes through the tracker when there is one (once only), else directly. */
  private release(item: Disposable): void {
    if (this.tracker !== undefined) this.tracker.release(item);
    else item.dispose();
  }
}
