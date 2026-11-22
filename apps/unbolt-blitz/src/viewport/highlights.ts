/**
 * Emissive highlights on part materials: brass hover glow (Req 10.1, 10.3),
 * amber-to-crimson blocker flash (Req 12.3) and the pulsing interlock
 * highlight (Req 14.3).
 *
 * Every part owns its material, so a highlight on one part never leaks to
 * another. Priority per part: interlock, then blocker flash, then hover.
 */
import type { Color, MeshPhysicalMaterial } from "three";
import { ARENA_PALETTE } from "./arenaConfig";

/** Brass glow of the hovered part. */
export const HOVER_EMISSIVE_COLOR = ARENA_PALETTE.brass;
export const HOVER_EMISSIVE_INTENSITY = 0.45;

export const BLOCKER_FLASH_DURATION_MS = 700;
export const BLOCKER_FLASH_PEAK_INTENSITY = 0.9;
/** Held intensity of a blocker highlight under reduced motion. */
export const BLOCKER_STEADY_INTENSITY = 0.6;

export const INTERLOCK_PULSE_PERIOD_MS = 1200;
export const INTERLOCK_MIN_INTENSITY = 0.35;
export const INTERLOCK_MAX_INTENSITY = 0.9;
/** Held intensity of the interlock highlight under reduced motion. */
export const INTERLOCK_STEADY_INTENSITY = 0.7;

/** Linear blend of two 0xRRGGBB colors. `t` is clamped to [0, 1]. */
export function lerpHexColor(from: number, to: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const channel = (shift: number): number => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * k);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export interface HighlightLevel {
  color: number;
  intensity: number;
}

/**
 * Blocker flash after `elapsedMs`: amber to crimson with a fading intensity.
 * Returns null when the flash is over. Under reduced motion the highlight is
 * a steady crimson until the same duration ends.
 */
export function blockerFlashLevel(elapsedMs: number, reduced: boolean): HighlightLevel | null {
  if (elapsedMs >= BLOCKER_FLASH_DURATION_MS) return null;
  if (reduced) {
    return { color: ARENA_PALETTE.crimson, intensity: BLOCKER_STEADY_INTENSITY };
  }
  const t = Math.max(0, elapsedMs) / BLOCKER_FLASH_DURATION_MS;
  return {
    color: lerpHexColor(ARENA_PALETTE.amber, ARENA_PALETTE.crimson, t),
    intensity: BLOCKER_FLASH_PEAK_INTENSITY * (1 - 0.6 * t),
  };
}

/** Pulsing crimson-amber glow of an interlocked part. Steady under reduced motion. */
export function interlockLevel(nowMs: number, reduced: boolean): HighlightLevel {
  if (reduced) {
    return {
      color: lerpHexColor(ARENA_PALETTE.amber, ARENA_PALETTE.crimson, 0.5),
      intensity: INTERLOCK_STEADY_INTENSITY,
    };
  }
  const phase = 0.5 + 0.5 * Math.sin((2 * Math.PI * nowMs) / INTERLOCK_PULSE_PERIOD_MS);
  return {
    color: lerpHexColor(ARENA_PALETTE.amber, ARENA_PALETTE.crimson, phase),
    intensity: INTERLOCK_MIN_INTENSITY + (INTERLOCK_MAX_INTENSITY - INTERLOCK_MIN_INTENSITY) * phase,
  };
}

interface TouchedMaterial {
  material: MeshPhysicalMaterial;
  baseColor: Color;
  baseIntensity: number;
}

/** Resolves a live part's material, or undefined when the part has no mesh any more. */
export type MaterialResolver = (partId: string) => MeshPhysicalMaterial | undefined;

export class HighlightManager {
  private hover: string | null = null;
  private readonly flashes = new Map<string, number>();
  private readonly interlocked = new Set<string>();
  private readonly touched = new Map<string, TouchedMaterial>();

  constructor(
    private readonly resolve: MaterialResolver,
    private reducedMotion = false,
  ) {}

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Brass glow on `partId`, or none for null. Applied by the next `update`. */
  setHover(partId: string | null): void {
    this.hover = partId;
  }

  /** Starts (or restarts) the amber-to-crimson flash on a blocker. */
  flashBlocker(partId: string, nowMs: number): void {
    this.flashes.set(partId, nowMs);
  }

  /** Marks the parts of the deadlock witness for the pulsing highlight. */
  setInterlock(partIds: readonly string[]): void {
    this.interlocked.clear();
    for (const id of partIds) this.interlocked.add(id);
  }

  /** Drops every highlight of a part and restores its material, for example before it flies out. */
  clearPart(partId: string): void {
    if (this.hover === partId) this.hover = null;
    this.flashes.delete(partId);
    this.interlocked.delete(partId);
    this.restore(partId);
  }

  /** Drops every highlight and restores every touched material. Call before meshes are rebuilt. */
  clearAll(): void {
    this.hover = null;
    this.flashes.clear();
    this.interlocked.clear();
    for (const partId of [...this.touched.keys()]) this.restore(partId);
  }

  /** The part currently hovered, for tests and the HUD. */
  get hoveredPartId(): string | null {
    return this.hover;
  }

  /** Applies the highlight of each part for `nowMs`. Call once per frame before rendering. */
  update(nowMs: number): void {
    const ids = new Set<string>();
    if (this.hover !== null) ids.add(this.hover);
    for (const id of this.flashes.keys()) ids.add(id);
    for (const id of this.interlocked) ids.add(id);

    for (const id of ids) {
      const material = this.resolve(id);
      if (material === undefined) {
        this.forget(id);
        continue;
      }
      const level = this.levelFor(id, nowMs);
      if (level === null) continue; // e.g. a finished flash on a part that is not hovered
      this.apply(id, material, level);
    }

    for (const id of [...this.touched.keys()]) {
      if (!ids.has(id) || this.levelFor(id, nowMs) === null) this.restore(id);
    }
  }

  private levelFor(id: string, nowMs: number): HighlightLevel | null {
    if (this.interlocked.has(id)) return interlockLevel(nowMs, this.reducedMotion);
    const startMs = this.flashes.get(id);
    if (startMs !== undefined) {
      const flash = blockerFlashLevel(nowMs - startMs, this.reducedMotion);
      if (flash !== null) return flash;
      this.flashes.delete(id);
    }
    if (this.hover === id) {
      return { color: HOVER_EMISSIVE_COLOR, intensity: HOVER_EMISSIVE_INTENSITY };
    }
    return null;
  }

  private apply(id: string, material: MeshPhysicalMaterial, level: HighlightLevel): void {
    let record = this.touched.get(id);
    if (record === undefined) {
      record = {
        material,
        baseColor: material.emissive.clone(),
        baseIntensity: material.emissiveIntensity,
      };
      this.touched.set(id, record);
    }
    material.emissive.setHex(level.color);
    material.emissiveIntensity = level.intensity;
  }

  private restore(id: string): void {
    const record = this.touched.get(id);
    if (record === undefined) return;
    record.material.emissive.copy(record.baseColor);
    record.material.emissiveIntensity = record.baseIntensity;
    this.touched.delete(id);
  }

  /** Forgets a part whose mesh is gone. Nothing to restore: its material is disposed. */
  private forget(id: string): void {
    if (this.hover === id) this.hover = null;
    this.flashes.delete(id);
    this.interlocked.delete(id);
    this.touched.delete(id);
  }
}
