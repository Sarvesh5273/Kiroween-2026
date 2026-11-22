import { Color, MeshPhysicalMaterial, MeshStandardMaterial } from "three";

/**
 * Untextured PBR finishes (Req 22.5, R8). Each call to {@link createMaterial} returns a new
 * material instance, so every mesh owns exactly one material and every kit call gets a fresh
 * palette. No texture map is ever set; all colour and surface detail comes from scalar PBR
 * parameters. The colours are sRGB hex values (three converts them to linear working space),
 * chosen to read well under a neutral studio environment.
 */

interface StandardFinish {
  readonly kind: "standard";
  readonly color: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly emissive?: number;
  readonly emissiveIntensity?: number;
  /** Faceted shading for crisp, machined-looking edges on low-poly Parts. */
  readonly flatShading?: boolean;
}

interface PhysicalFinish {
  readonly kind: "physical";
  readonly color: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly clearcoat?: number;
  readonly clearcoatRoughness?: number;
  readonly transmission?: number;
  readonly thickness?: number;
  readonly ior?: number;
  readonly attenuationColor?: number;
  readonly attenuationDistance?: number;
  readonly sheen?: number;
  readonly sheenColor?: number;
  readonly sheenRoughness?: number;
  readonly iridescence?: number;
  readonly iridescenceIOR?: number;
  readonly specularIntensity?: number;
  readonly specularColor?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly flatShading?: boolean;
}

type Finish = StandardFinish | PhysicalFinish;

const FINISHES = {
  // Haunted Clockwork Lockbox
  /** Aged clock brass: warm, slightly hazy, with a faint clearcoat of old lacquer. */
  antiqueBrass: {
    kind: "physical",
    color: 0xb5893a,
    metalness: 1,
    roughness: 0.32,
    clearcoat: 0.35,
    clearcoatRoughness: 0.45,
    specularIntensity: 1,
    specularColor: 0xffe2a8,
  },
  /** Darker, more worn brass for the larger wheels so the train reads as two alloys. */
  agedBronze: {
    kind: "physical",
    color: 0x8c6230,
    metalness: 1,
    roughness: 0.4,
    clearcoat: 0.2,
    clearcoatRoughness: 0.6,
  },
  /** Gunmetal blackened steel for the box shell and spindles, with a subtle oily sheen. */
  blackenedSteel: {
    kind: "physical",
    color: 0x2a2c30,
    metalness: 0.9,
    roughness: 0.38,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
    iridescence: 0.15,
    iridescenceIOR: 1.6,
  },
  /** Satin dark steel for the lid: a touch lighter than the body so the seam reads. */
  smokedSteel: {
    kind: "physical",
    color: 0x3b3e44,
    metalness: 0.85,
    roughness: 0.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  },
  /** Polished pivot steel for the gear spindles. */
  pivotSteel: {
    kind: "standard",
    color: 0x9aa0a8,
    metalness: 1,
    roughness: 0.18,
  },
  /** Brushed copper for the latch and the lid fasteners. */
  brushedCopper: {
    kind: "physical",
    color: 0xc46a3c,
    metalness: 1,
    roughness: 0.36,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
    specularColor: 0xffc8a8,
  },
  /** Darkened copper-bronze for the screw standoffs. */
  oxidisedCopper: {
    kind: "standard",
    color: 0x7a4a32,
    metalness: 0.95,
    roughness: 0.5,
  },

  // Deadlock_Cage A: dumbbell and captive ring
  /** Satin titanium, cool grey with a faint champagne cast. */
  satinTitanium: {
    kind: "physical",
    color: 0xb8b4ae,
    metalness: 1,
    roughness: 0.28,
    specularIntensity: 1,
    specularColor: 0xf2ece4,
    clearcoat: 0.15,
    clearcoatRoughness: 0.4,
  },
  /** Anodized crimson ring with a thin gold-tinted interference sheen. */
  anodizedCrimson: {
    kind: "physical",
    color: 0x9e1020,
    metalness: 0.8,
    roughness: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    iridescence: 0.35,
    iridescenceIOR: 1.8,
    sheen: 0.4,
    sheenColor: 0xffc04a,
    sheenRoughness: 0.35,
  },

  // Deadlock_Cage B: ship in a bottle
  /** Clear, clearcoated bottle glass with a faint green body tint. */
  bottleGlass: {
    kind: "physical",
    color: 0xf4fff8,
    metalness: 0,
    roughness: 0.04,
    transmission: 1,
    thickness: 2.5,
    ior: 1.52,
    attenuationColor: 0xcfeedd,
    attenuationDistance: 120,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    specularIntensity: 1,
  },
  /** Mirror-polished chrome for the trapped balls, so they glint through the glass. */
  polishedChrome: {
    kind: "standard",
    color: 0xe8ecf2,
    metalness: 1,
    roughness: 0.06,
  },
  /** Polished gold for alternating trapped balls. */
  polishedGold: {
    kind: "physical",
    color: 0xffc35a,
    metalness: 1,
    roughness: 0.1,
    clearcoat: 0.6,
    clearcoatRoughness: 0.05,
  },
  // 65% Mechanical Keyboard
  /** Bead-blasted anodized aluminium in deep slate for the bottom case, with a soft satin sheen. */
  anodizedSlate: {
    kind: "physical",
    color: 0x3a4250,
    metalness: 0.85,
    roughness: 0.42,
    clearcoat: 0.3,
    clearcoatRoughness: 0.5,
    sheen: 0.25,
    sheenColor: 0x8aa0c0,
    sheenRoughness: 0.6,
  },
  /** Navy anodized aluminium for the top frame, a shade brighter than the case so the seam reads. */
  anodizedNavy: {
    kind: "physical",
    color: 0x1f3a6b,
    metalness: 0.88,
    roughness: 0.34,
    clearcoat: 0.45,
    clearcoatRoughness: 0.3,
    specularIntensity: 1,
    specularColor: 0xc8d8ff,
  },
  /** Brushed brass switch plate: warm, fairly rough, no lacquer. */
  brushedBrass: {
    kind: "physical",
    color: 0xc9a13b,
    metalness: 1,
    roughness: 0.38,
    specularIntensity: 1,
    specularColor: 0xfff0c0,
  },
  /** Deep emerald solder mask over copper: glossy dielectric with a clear lacquer coat. */
  emeraldSolderMask: {
    kind: "physical",
    color: 0x0b5d3b,
    metalness: 0.05,
    roughness: 0.3,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
  },
  /** Crisp, faceted smoke-grey nylon switch housing with a crimson-tinted top. */
  switchHousing: {
    kind: "standard",
    color: 0x2b2d33,
    metalness: 0.02,
    roughness: 0.48,
    emissive: 0x3a0a10,
    emissiveIntensity: 0.25,
    flatShading: true,
  },
  /** Matte PBT keycap, charcoal. */
  pbtCharcoal: {
    kind: "physical",
    color: 0x2e3036,
    metalness: 0,
    roughness: 0.78,
    sheen: 0.3,
    sheenColor: 0x6a6e78,
    sheenRoughness: 0.8,
  },
  /** Matte PBT keycap, warm ivory for the alphas. */
  pbtIvory: {
    kind: "physical",
    color: 0xe9e2cf,
    metalness: 0,
    roughness: 0.74,
    sheen: 0.35,
    sheenColor: 0xfff6dc,
    sheenRoughness: 0.75,
  },
  /** Matte PBT accent keycap, burnt coral (Esc, Enter, arrows). */
  pbtAccent: {
    kind: "physical",
    color: 0xd9573a,
    metalness: 0,
    roughness: 0.72,
    sheen: 0.4,
    sheenColor: 0xffb090,
    sheenRoughness: 0.7,
  },
  /** Black-oxide steel case screws. */
  blackOxideSteel: {
    kind: "standard",
    color: 0x1c1d20,
    metalness: 0.9,
    roughness: 0.35,
  },

  // 3-Stage Planetary Gearbox
  /** Stage 1 gears: bright ground carbon steel. */
  groundSteel: {
    kind: "physical",
    color: 0xb9bec6,
    metalness: 1,
    roughness: 0.22,
    specularIntensity: 1,
    specularColor: 0xffffff,
  },
  /** Stage 2 gears: titanium-nitride coated steel, golden. */
  titaniumNitride: {
    kind: "physical",
    color: 0xd8a948,
    metalness: 1,
    roughness: 0.26,
    clearcoat: 0.2,
    clearcoatRoughness: 0.3,
  },
  /** Stage 3 gears: heat-blued steel with a thin interference sheen. */
  heatBluedSteel: {
    kind: "physical",
    color: 0x3a5a9a,
    metalness: 0.95,
    roughness: 0.3,
    iridescence: 0.45,
    iridescenceIOR: 1.7,
  },
  /** Ring gears: dark nitrided steel, matte. */
  nitridedSteel: {
    kind: "standard",
    color: 0x4a4d52,
    metalness: 0.9,
    roughness: 0.46,
  },
  /** Planet carriers: copper-toned bronze bushings. */
  phosphorBronze: {
    kind: "physical",
    color: 0xa86a3c,
    metalness: 1,
    roughness: 0.34,
    clearcoat: 0.2,
    clearcoatRoughness: 0.4,
  },
  /** Housing wall: machined cast aluminium, satin. */
  machinedAluminium: {
    kind: "physical",
    color: 0xc4c8cc,
    metalness: 0.95,
    roughness: 0.4,
    clearcoat: 0.15,
    clearcoatRoughness: 0.6,
  },
  /** Housing base and cover: hard-anodized graphite aluminium. */
  hardAnodizedGraphite: {
    kind: "physical",
    color: 0x34373c,
    metalness: 0.8,
    roughness: 0.5,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
  },
  /** Housing fasteners: zinc-plated steel with a faint yellow passivation. */
  zincPlated: {
    kind: "physical",
    color: 0xd6d2b8,
    metalness: 1,
    roughness: 0.28,
    iridescence: 0.2,
    iridescenceIOR: 1.5,
  },

  /** Pale ghost glow for small accents. */
  ghostGlow: {
    kind: "standard",
    color: 0x9ad8c8,
    metalness: 0.2,
    roughness: 0.4,
    emissive: 0x2a8f78,
    emissiveIntensity: 0.6,
  },
} as const satisfies Record<string, Finish>;

export type FinishName = keyof typeof FINISHES;

/** A new, untextured material for one mesh. */
export function createMaterial(finish: FinishName): MeshStandardMaterial | MeshPhysicalMaterial {
  const spec: Finish = FINISHES[finish];
  if (spec.kind === "standard") {
    const material = new MeshStandardMaterial({
      color: new Color(spec.color),
      metalness: spec.metalness,
      roughness: spec.roughness,
    });
    if (spec.emissive !== undefined) {
      material.emissive = new Color(spec.emissive);
      material.emissiveIntensity = spec.emissiveIntensity ?? 1;
    }
    if (spec.flatShading !== undefined) material.flatShading = spec.flatShading;
    material.name = finish;
    return material;
  }
  const material = new MeshPhysicalMaterial({
    color: new Color(spec.color),
    metalness: spec.metalness,
    roughness: spec.roughness,
  });
  if (spec.clearcoat !== undefined) material.clearcoat = spec.clearcoat;
  if (spec.clearcoatRoughness !== undefined) material.clearcoatRoughness = spec.clearcoatRoughness;
  if (spec.transmission !== undefined) material.transmission = spec.transmission;
  if (spec.thickness !== undefined) material.thickness = spec.thickness;
  if (spec.ior !== undefined) material.ior = spec.ior;
  if (spec.attenuationColor !== undefined) material.attenuationColor = new Color(spec.attenuationColor);
  if (spec.attenuationDistance !== undefined) material.attenuationDistance = spec.attenuationDistance;
  if (spec.sheen !== undefined) material.sheen = spec.sheen;
  if (spec.sheenColor !== undefined) material.sheenColor = new Color(spec.sheenColor);
  if (spec.sheenRoughness !== undefined) material.sheenRoughness = spec.sheenRoughness;
  if (spec.iridescence !== undefined) material.iridescence = spec.iridescence;
  if (spec.iridescenceIOR !== undefined) material.iridescenceIOR = spec.iridescenceIOR;
  if (spec.specularIntensity !== undefined) material.specularIntensity = spec.specularIntensity;
  if (spec.specularColor !== undefined) material.specularColor = new Color(spec.specularColor);
  if (spec.transparent !== undefined) material.transparent = spec.transparent;
  if (spec.opacity !== undefined) material.opacity = spec.opacity;
  if (spec.flatShading !== undefined) material.flatShading = spec.flatShading;
  material.name = finish;
  return material;
}
