import fc from "fast-check";
import {
  BoxGeometry,
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Path,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
} from "three";
import type { SolverConfig } from "../../src/config";
import { se3Arbitrary, type Se3Transform } from "./se3";

/**
 * Watertight assembly generator (Req 11.7, design "Watertight assembly generator").
 *
 * Every Part is a Watertight_Solid_Part under the run's Micro_Shrink. Parts are built only from
 *  - closed `BoxGeometry` boxes,
 *  - `ExtrudeGeometry` of jittered star-shaped outlines with inset holes and no bevel,
 *  - `LatheGeometry` of profiles that start and end on the axis, wound bottom to top.
 * Collapsed triangles are dropped, and winding is flipped if the signed volume is negative.
 *
 * Scale rules. Every wall, depth, radius and gap is at least 0.03 layout units, and the largest
 * layout has an extent below 15 units. The smallest feature is therefore above `2e-3` of the
 * Assembly extent, which is at least 10 times the largest Micro_Shrink (`2e-4`). Part-to-Part
 * gaps are at least 0.03 and use bounding spheres, so Parts never touch.
 *
 * Randomness: fast-check draws the config, layout, Part count, one detail seed and the group
 * SE3. The detail seed feeds a small seeded PRNG, so a failure replays from the fast-check seed.
 */

export type AssemblyLayout = "free" | "stacked" | "peg-in-hole" | "sleeve-on-rod";
export type PartKind = "box" | "extrude" | "lathe";

export const ASSEMBLY_LAYOUTS: readonly AssemblyLayout[] = ["free", "stacked", "peg-in-hole", "sleeve-on-rod"];

export interface GeneratedPart {
  name: string;
  kind: PartKind;
  mesh: Mesh;
}

export interface GeneratedAssembly {
  layout: AssemblyLayout;
  /** The Solver_Config fields the generator draws: `clearanceEpsilon < microShrink`. */
  config: { microShrink: number; clearanceEpsilon: number } & SolverConfig;
  parts: GeneratedPart[];
  /** Root group. Its transform is the drawn group SE3, and every Part is a direct child. */
  root: Group;
  /** Largest side of the world-space AABB of every Part. Micro_Shrink is `config.microShrink * extent` in world units. */
  extent: number;
  se3: Se3Transform;
}

export interface AssemblyOptions {
  /** At least 2. Default 2. */
  minParts?: number;
  /** At most 8. Default 8. */
  maxParts?: number;
}

export function assemblyArbitrary(options: AssemblyOptions = {}): fc.Arbitrary<GeneratedAssembly> {
  const minParts = Math.max(2, options.minParts ?? 2);
  const maxParts = Math.min(8, Math.max(minParts, options.maxParts ?? 8));
  return fc
    .record({
      // The Solver_Config is drawn first.
      microShrink: fc.double({ min: 1e-5, max: 2e-4, noNaN: true }),
      clearanceFraction: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
      layout: fc.constantFrom(...ASSEMBLY_LAYOUTS),
      partCount: fc.integer({ min: minParts, max: maxParts }),
      detailSeed: fc.integer({ min: 0, max: 0xffffffff }),
      se3: se3Arbitrary,
    })
    .map((draw) => buildAssembly(draw));
}

/** World-space triangles of a generated Part, in double precision. */
export function worldGeometry(part: GeneratedPart): { positions: Float64Array; index: Uint32Array | null } {
  part.mesh.updateWorldMatrix(true, false);
  const attribute = part.mesh.geometry.getAttribute("position");
  const positions = new Float64Array(3 * attribute.count);
  const v = new Vector3();
  for (let i = 0; i < attribute.count; i++) {
    v.fromBufferAttribute(attribute, i).applyMatrix4(part.mesh.matrixWorld);
    positions[3 * i] = v.x;
    positions[3 * i + 1] = v.y;
    positions[3 * i + 2] = v.z;
  }
  const index = part.mesh.geometry.getIndex();
  return { positions, index: index === null ? null : Uint32Array.from(index.array) };
}

// ---------------------------------------------------------------------------
// Seeded PRNG for the detail draws (mulberry32)
// ---------------------------------------------------------------------------

interface Rng {
  next(): number;
  range(lo: number, hi: number): number;
  int(lo: number, hi: number): number;
}

function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
  };
}

function randomQuaternion(rng: Rng): Quaternion {
  for (let attempt = 0; attempt < 64; attempt++) {
    const x = rng.range(-1, 1);
    const y = rng.range(-1, 1);
    const z = rng.range(-1, 1);
    const w = rng.range(-1, 1);
    const norm = Math.hypot(x, y, z, w);
    if (norm >= 0.1) {
      return new Quaternion(x / norm, y / norm, z / norm, w / norm);
    }
  }
  return new Quaternion(0, 0, 0, 1);
}

// ---------------------------------------------------------------------------
// Part shapes
// ---------------------------------------------------------------------------

/** A closed solid centered at its AABB center, with the axis it is built and stacked along. */
interface PartShape {
  kind: PartKind;
  geometry: BufferGeometry;
  /** Radius of a sphere around the origin that contains every vertex. */
  radius: number;
  /** Size along the natural build axis. */
  height: number;
  /** `"y"` for box and lathe, `"z"` for extrude. */
  axis: "y" | "z";
}

const MIN_FEATURE = 0.05;
const MIN_TRIANGLE_AREA = 1e-9;
/** Rotation that maps +z onto +y. */
const Z_TO_Y = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
/** Rotation that maps +y onto +z. */
const Y_TO_Z = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

function boxShape(rng: Rng): PartShape {
  const geometry = new BoxGeometry(rng.range(0.08, 0.9), rng.range(0.08, 0.9), rng.range(0.08, 0.9));
  return finishShape("box", geometry, "y");
}

/** Corners of a star-shaped outline: increasing angles with radial and angular jitter. */
function jitteredOutline(rng: Rng, n: number, radius: number, radialJitter: number, angularJitter: number): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * (i + angularJitter * rng.range(-1, 1))) / n;
    const r = radius * (1 + radialJitter * rng.range(-1, 1));
    points.push(new Vector2(r * Math.cos(angle), r * Math.sin(angle)));
  }
  return points;
}

/** Distance from the origin that a star outline with these parameters is guaranteed to contain. */
function guaranteedInradius(n: number, radius: number, radialJitter: number, angularJitter: number): number {
  const widestGap = ((2 * Math.PI) / n) * (1 + 2 * angularJitter);
  return radius * (1 - radialJitter) * Math.cos(widestGap / 2);
}

function holePath(rng: Rng, m: number, radius: number, radialJitter: number): Path {
  const path = new Path();
  const phase = rng.range(0, 2 * Math.PI);
  for (let i = 0; i < m; i++) {
    const angle = phase + (2 * Math.PI * i) / m;
    const r = radius * (1 + radialJitter * rng.range(-1, 1));
    if (i === 0) {
      path.moveTo(r * Math.cos(angle), r * Math.sin(angle));
    } else {
      path.lineTo(r * Math.cos(angle), r * Math.sin(angle));
    }
  }
  path.closePath();
  return path;
}

function extrudeShape(rng: Rng): PartShape {
  const n = rng.int(7, 12);
  const radius = rng.range(0.2, 0.5);
  const radialJitter = 0.2;
  const angularJitter = 0.2;
  const shape = new Shape(jitteredOutline(rng, n, radius, radialJitter, angularJitter));
  if (radius >= 0.3 && rng.next() < 0.6) {
    const wall = rng.range(MIN_FEATURE, 0.1);
    const holeJitter = 0.1;
    const usable = (guaranteedInradius(n, radius, radialJitter, angularJitter) - wall) / (1 + holeJitter);
    shape.holes.push(holePath(rng, rng.int(6, 10), rng.range(MIN_FEATURE, usable), holeJitter));
  }
  const geometry = new ExtrudeGeometry(shape, { depth: rng.range(0.06, 0.5), bevelEnabled: false, steps: 1 });
  return finishShape("extrude", geometry, "z");
}

/** Lathe profiles that start and end on the axis, listed bottom to top so faces point outward. */
function latheShape(rng: Rng): PartShape {
  const style = rng.int(0, 2);
  let profile: Vector2[];
  if (style === 0) {
    const r = rng.range(0.06, 0.4);
    const h = rng.range(0.1, 0.8);
    profile = [new Vector2(0, 0), new Vector2(r, 0), new Vector2(r, h), new Vector2(0, h)];
  } else if (style === 1) {
    const r1 = rng.range(0.06, 0.35);
    const r2 = rng.range(0.06, 0.35);
    const h1 = rng.range(0.06, 0.4);
    const h2 = rng.range(0.06, 0.4);
    profile = [
      new Vector2(0, 0),
      new Vector2(r1, 0),
      new Vector2(r1, h1),
      new Vector2(r2, h1),
      new Vector2(r2, h1 + h2),
      new Vector2(0, h1 + h2),
    ];
  } else {
    const r1 = rng.range(0.1, 0.4);
    const r2 = rng.range(0.06, 0.4);
    const h = rng.range(0.1, 0.8);
    profile = [new Vector2(0, 0), new Vector2(r1, 0), new Vector2(r2, h), new Vector2(0, h)];
  }
  return finishShape("lathe", new LatheGeometry(profile, rng.int(10, 20)), "y");
}

/** A plain cylinder along its natural y axis, used for pegs and rods. */
function cylinderShape(rng: Rng, radius: number, height: number): PartShape {
  const profile = [new Vector2(0, 0), new Vector2(radius, 0), new Vector2(radius, height), new Vector2(0, height)];
  return finishShape("lathe", new LatheGeometry(profile, rng.int(10, 20)), "y");
}

/**
 * A plate or sleeve: an extruded star outline around a regular-polygon hole of circumradius
 * `holeRadius`. The outline is large enough that every wall is at least `wall` thick.
 */
function holedExtrudeShape(rng: Rng, holeRadius: number, wall: number, depth: number): PartShape {
  const n = rng.int(8, 12);
  const jitter = 0.1;
  const outlineRadius = ((holeRadius + wall) / guaranteedInradius(n, 1, jitter, jitter)) * rng.range(1, 1.15);
  const shape = new Shape(jitteredOutline(rng, n, outlineRadius, jitter, jitter));
  shape.holes.push(holePath(rng, rng.int(8, 12), holeRadius, 0));
  return finishShape("extrude", new ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 }), "z");
}

/**
 * Drops collapsed triangles, fixes winding to a positive signed volume, centers the geometry
 * on its AABB center and rebuilds normals. Indexed input stays indexed.
 */
function finishShape(kind: PartKind, source: BufferGeometry, axis: "y" | "z"): PartShape {
  const position = source.getAttribute("position");
  const sourceIndex = source.getIndex();
  const cornerCount = sourceIndex === null ? position.count : sourceIndex.count;
  const vertex = (v: number): [number, number, number] => [position.getX(v), position.getY(v), position.getZ(v)];

  let kept: number[] = [];
  for (let t = 0; t < cornerCount / 3; t++) {
    const corners = [0, 1, 2].map((k) => (sourceIndex === null ? 3 * t + k : sourceIndex.getX(3 * t + k)));
    const [a, b, c] = corners.map(vertex) as [[number, number, number], [number, number, number], [number, number, number]];
    if (area(a, b, c) > MIN_TRIANGLE_AREA) {
      kept = kept.concat(corners);
    }
  }

  let volume = 0;
  for (let t = 0; t < kept.length; t += 3) {
    volume += triple(vertex(kept[t] ?? 0), vertex(kept[t + 1] ?? 0), vertex(kept[t + 2] ?? 0)) / 6;
  }
  if (volume < 0) {
    for (let t = 0; t < kept.length; t += 3) {
      const second = kept[t + 1] ?? 0;
      kept[t + 1] = kept[t + 2] ?? 0;
      kept[t + 2] = second;
    }
  }

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const v of kept) {
    const p = vertex(v);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k] ?? Infinity, p[k] ?? 0);
      hi[k] = Math.max(hi[k] ?? -Infinity, p[k] ?? 0);
    }
  }
  const center = [0, 1, 2].map((k) => ((lo[k] ?? 0) + (hi[k] ?? 0)) / 2);
  const centered = (v: number): [number, number, number] => {
    const p = vertex(v);
    return [p[0] - (center[0] ?? 0), p[1] - (center[1] ?? 0), p[2] - (center[2] ?? 0)];
  };

  const geometry = new BufferGeometry();
  let radius = 0;
  for (const v of kept) {
    radius = Math.max(radius, Math.hypot(...centered(v)));
  }
  if (sourceIndex === null) {
    const flat: number[] = [];
    for (const v of kept) {
      flat.push(...centered(v));
    }
    geometry.setAttribute("position", new Float32BufferAttribute(flat, 3));
  } else {
    const flat: number[] = [];
    for (let v = 0; v < position.count; v++) {
      flat.push(...centered(v));
    }
    geometry.setAttribute("position", new Float32BufferAttribute(flat, 3));
    geometry.setIndex(kept);
  }
  geometry.computeVertexNormals();

  const size = axis === "y" ? (hi[1] ?? 0) - (lo[1] ?? 0) : (hi[2] ?? 0) - (lo[2] ?? 0);
  return { kind, geometry, radius: radius + 1e-6, height: size, axis };
}

function area(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  const ux = (b[0] ?? 0) - (a[0] ?? 0);
  const uy = (b[1] ?? 0) - (a[1] ?? 0);
  const uz = (b[2] ?? 0) - (a[2] ?? 0);
  const vx = (c[0] ?? 0) - (a[0] ?? 0);
  const vy = (c[1] ?? 0) - (a[1] ?? 0);
  const vz = (c[2] ?? 0) - (a[2] ?? 0);
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

function triple(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  return (
    (a[0] ?? 0) * ((b[1] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[1] ?? 0)) -
    (a[1] ?? 0) * ((b[0] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[0] ?? 0)) +
    (a[2] ?? 0) * ((b[0] ?? 0) * (c[1] ?? 0) - (b[1] ?? 0) * (c[0] ?? 0))
  );
}

function randomShape(rng: Rng): PartShape {
  const choice = rng.int(0, 2);
  if (choice === 0) {
    return boxShape(rng);
  }
  return choice === 1 ? extrudeShape(rng) : latheShape(rng);
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

interface Placement {
  shape: PartShape;
  position: Vector3;
  quaternion: Quaternion;
}

const MIN_GAP = 0.03;
const MAX_GAP = 0.2;

/** Parts on a line along x. Each spins freely inside its own bounding sphere. */
function freePlacements(rng: Rng, shapes: readonly PartShape[], startX: number): Placement[] {
  const placements: Placement[] = [];
  let cursor = startX;
  for (const shape of shapes) {
    const x = cursor + shape.radius;
    placements.push({
      shape,
      position: new Vector3(x, rng.range(-0.1, 0.1), rng.range(-0.1, 0.1)),
      quaternion: randomQuaternion(rng),
    });
    cursor = x + shape.radius + rng.range(MIN_GAP, MAX_GAP);
  }
  return placements;
}

/** Parts stacked along y with a gap. Each spins about y only, so its y extent is unchanged. */
function stackedPlacements(rng: Rng, shapes: readonly PartShape[]): Placement[] {
  const placements: Placement[] = [];
  let cursor = 0;
  for (const shape of shapes) {
    const y = cursor + shape.height / 2;
    const spin = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rng.range(0, 2 * Math.PI));
    const align = shape.axis === "z" ? Z_TO_Y : new Quaternion();
    placements.push({
      shape,
      position: new Vector3(rng.range(-0.05, 0.05), y, rng.range(-0.05, 0.05)),
      quaternion: spin.multiply(align),
    });
    cursor = y + shape.height / 2 + rng.range(MIN_GAP, MAX_GAP);
  }
  return placements;
}

/**
 * A holed plate or sleeve with a cylinder inside its hole along the same axis (z), with a
 * radial gap of at least 0.03. Returns the two placements and the radius of a sphere around the
 * origin that contains both.
 */
function nestedPlacements(
  rng: Rng,
  mode: "peg-in-hole" | "sleeve-on-rod",
): { placements: Placement[]; radius: number } {
  const peg = mode === "peg-in-hole";
  const holeRadius = rng.range(0.15, peg ? 0.4 : 0.3);
  const wall = rng.range(MIN_FEATURE, peg ? 0.2 : 0.1);
  const depth = peg ? rng.range(0.06, 0.15) : rng.range(0.15, 0.5);
  const outer = holedExtrudeShape(rng, holeRadius, wall, depth);

  // The hole has between 8 and 12 sides, so its inscribed circle is at least `cos(pi / 8)`.
  const inscribed = holeRadius * Math.cos(Math.PI / 8);
  const innerRadius = inscribed - rng.range(MIN_GAP, 0.08);
  const innerHeight = peg ? rng.range(0.2, 0.6) : rng.range(0.6, 1.2);
  const inner = cylinderShape(rng, innerRadius, innerHeight);

  const axialOffset = rng.range(-0.3, 0.3);
  const spin = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rng.range(0, 2 * Math.PI));
  return {
    placements: [
      { shape: outer, position: new Vector3(0, 0, 0), quaternion: new Quaternion() },
      { shape: inner, position: new Vector3(0, 0, axialOffset), quaternion: spin.multiply(Y_TO_Z) },
    ],
    radius: Math.max(outer.radius, inner.radius + Math.abs(axialOffset)),
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

interface Draw {
  microShrink: number;
  clearanceFraction: number;
  layout: AssemblyLayout;
  partCount: number;
  detailSeed: number;
  se3: Se3Transform;
}

const MATERIAL = new MeshStandardMaterial({ color: 0x8899aa, metalness: 0.6, roughness: 0.4 });

function buildAssembly(draw: Draw): GeneratedAssembly {
  const rng = createRng(draw.detailSeed);
  let placements: Placement[];
  if (draw.layout === "free") {
    placements = freePlacements(
      rng,
      Array.from({ length: draw.partCount }, () => randomShape(rng)),
      0,
    );
  } else if (draw.layout === "stacked") {
    placements = stackedPlacements(
      rng,
      Array.from({ length: draw.partCount }, () => randomShape(rng)),
    );
  } else {
    const nest = nestedPlacements(rng, draw.layout);
    const extras = freePlacements(
      rng,
      Array.from({ length: draw.partCount - 2 }, () => randomShape(rng)),
      nest.radius + rng.range(MIN_GAP, MAX_GAP),
    );
    placements = [...nest.placements, ...extras];
  }

  const root = new Group();
  const [qx, qy, qz, qw] = draw.se3.quaternion;
  root.quaternion.set(qx, qy, qz, qw);
  root.position.set(...draw.se3.translation);

  const parts: GeneratedPart[] = placements.map((placement, i) => {
    const mesh = new Mesh(placement.shape.geometry, MATERIAL);
    mesh.name = `part-${i}`;
    mesh.position.copy(placement.position);
    mesh.quaternion.copy(placement.quaternion);
    root.add(mesh);
    return { name: mesh.name, kind: placement.shape.kind, mesh };
  });
  root.updateMatrixWorld(true);

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const { positions } = worldGeometry(part);
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k] ?? Infinity, positions[i + k] ?? 0);
        hi[k] = Math.max(hi[k] ?? -Infinity, positions[i + k] ?? 0);
      }
    }
  }
  const extent = Math.max((hi[0] ?? 0) - (lo[0] ?? 0), (hi[1] ?? 0) - (lo[1] ?? 0), (hi[2] ?? 0) - (lo[2] ?? 0));

  return {
    layout: draw.layout,
    config: { microShrink: draw.microShrink, clearanceEpsilon: draw.microShrink * draw.clearanceFraction },
    parts,
    root,
    extent,
    se3: draw.se3,
  };
}
