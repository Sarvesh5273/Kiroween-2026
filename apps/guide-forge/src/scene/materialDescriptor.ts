/**
 * Conversion between Three materials and the plain-data `MaterialDescriptor`.
 *
 * This module uses `three` only. It touches no DOM, no texture and no image, so it runs on the
 * Main_Thread, in the Solver_Worker and in Node tests. A descriptor holds no texture data
 * (Requirement 7.6), and the material built from it has no map of any kind.
 */
import { Color, Material, MeshPhysicalMaterial, SRGBColorSpace } from "three";
import type { MaterialDescriptor } from "../protocol";

/** Neutral grey dielectric. Used when a mesh has no material or an unreadable one. */
export const DEFAULT_MATERIAL_DESCRIPTOR: Readonly<MaterialDescriptor> = Object.freeze({
  baseColor: 0xb8bcc4,
  metalness: 0,
  roughness: 0.6,
  transmission: 0,
  opacity: 1,
  emissive: 0x000000,
});

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function toHex(color: unknown, fallback: number): number {
  if (color instanceof Color) return color.getHex(SRGBColorSpace);
  return fallback;
}

function sanitizeHex(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) & 0xffffff : 0;
}

/**
 * Reads the surface properties of a material into plain data.
 *
 * `MeshStandardMaterial` and `MeshPhysicalMaterial` (and any subclass) supply every field.
 * Other material types supply what they have (`color`, `emissive`, `opacity`) and take the
 * defaults for the rest. A material array contributes its first entry. `null`, `undefined`
 * and an empty array give the default descriptor.
 */
export function materialToDescriptor(
  material: Material | readonly Material[] | null | undefined,
): MaterialDescriptor {
  const source: Material | undefined = Array.isArray(material)
    ? (material as readonly Material[])[0]
    : (material as Material | null | undefined) ?? undefined;
  if (source === undefined) return { ...DEFAULT_MATERIAL_DESCRIPTOR };

  // Read through a loose view so each property is checked at run time, not assumed by type.
  const loose = source as unknown as Record<string, unknown>;
  const d = DEFAULT_MATERIAL_DESCRIPTOR;
  return {
    baseColor: toHex(loose["color"], d.baseColor),
    metalness: clamp01(loose["metalness"], d.metalness),
    roughness: clamp01(loose["roughness"], d.roughness),
    transmission: clamp01(loose["transmission"], d.transmission),
    opacity: clamp01(source.opacity, d.opacity),
    emissive: toHex(loose["emissive"], d.emissive),
  };
}

/**
 * Builds a new `MeshPhysicalMaterial` from a descriptor (Requirement 3.5).
 *
 * `transparent` is `true` exactly when `opacity < 1`. Scalars are clamped to [0, 1] and colours
 * are masked to 24 bits, so a malformed descriptor cannot produce an invalid material.
 */
export function descriptorToMaterial(descriptor: MaterialDescriptor): MeshPhysicalMaterial {
  const opacity = clamp01(descriptor.opacity, 1);
  return new MeshPhysicalMaterial({
    color: new Color().setHex(sanitizeHex(descriptor.baseColor), SRGBColorSpace),
    metalness: clamp01(descriptor.metalness, 0),
    roughness: clamp01(descriptor.roughness, 1),
    transmission: clamp01(descriptor.transmission, 0),
    opacity,
    transparent: opacity < 1,
    emissive: new Color().setHex(sanitizeHex(descriptor.emissive), SRGBColorSpace),
  });
}
