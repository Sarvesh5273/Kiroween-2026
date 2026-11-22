import { Color, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import type { Material } from "three";
import type { MaterialDescriptor } from "../protocol";

/** Used when a mesh has no material or a material without PBR fields. */
export const DEFAULT_MATERIAL_DESCRIPTOR: MaterialDescriptor = Object.freeze({
  baseColor: 0x8a8f99,
  metalness: 0.2,
  roughness: 0.6,
  transmission: 0,
  opacity: 1,
  emissive: 0x000000,
});

interface PbrLike {
  color?: Color;
  metalness?: number;
  roughness?: number;
  transmission?: number;
  opacity?: number;
  emissive?: Color;
  emissiveIntensity?: number;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Emissive color scaled by `emissiveIntensity` (clamped per channel), since the descriptor has no intensity field. */
function emissiveHex(pbr: PbrLike): number {
  if (pbr.emissive === undefined) return 0;
  const intensity = Math.max(0, finiteOr(pbr.emissiveIntensity, 1));
  const scaled = new Color(
    clamp01(pbr.emissive.r * intensity),
    clamp01(pbr.emissive.g * intensity),
    clamp01(pbr.emissive.b * intensity),
  );
  return scaled.getHex();
}

/** Plain-data copy of the PBR fields of a material. Arrays use the first entry. */
export function materialToDescriptor(
  material: Material | Material[] | null | undefined,
): MaterialDescriptor {
  const source = Array.isArray(material) ? material[0] : material;
  if (source === undefined || source === null) return { ...DEFAULT_MATERIAL_DESCRIPTOR };
  const pbr = source as unknown as PbrLike;
  return {
    baseColor: pbr.color !== undefined ? pbr.color.getHex() : DEFAULT_MATERIAL_DESCRIPTOR.baseColor,
    metalness: clamp01(finiteOr(pbr.metalness, DEFAULT_MATERIAL_DESCRIPTOR.metalness)),
    roughness: clamp01(finiteOr(pbr.roughness, DEFAULT_MATERIAL_DESCRIPTOR.roughness)),
    transmission: clamp01(finiteOr(pbr.transmission, 0)),
    opacity: clamp01(finiteOr(source.opacity, 1)),
    emissive: emissiveHex(pbr),
  };
}

/** A new material for one mesh. Transmissive descriptors become `MeshPhysicalMaterial`. */
export function descriptorToMaterial(descriptor: MaterialDescriptor): Material {
  const params = {
    color: new Color(descriptor.baseColor),
    metalness: descriptor.metalness,
    roughness: descriptor.roughness,
    emissive: new Color(descriptor.emissive),
    opacity: descriptor.opacity,
    transparent: descriptor.opacity < 1,
  };
  if (descriptor.transmission > 0) {
    return new MeshPhysicalMaterial({ ...params, transmission: descriptor.transmission });
  }
  return new MeshStandardMaterial(params);
}
