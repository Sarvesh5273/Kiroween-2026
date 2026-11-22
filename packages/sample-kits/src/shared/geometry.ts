import { BufferAttribute, BufferGeometry, ExtrudeGeometry, LatheGeometry, Path, Shape, Vector2 } from "three";

/**
 * Geometry helpers shared by every Kit_Builder (design R1 to R4, R6, R11).
 *
 * Everything here is deterministic: no randomness, no clock, no I/O, and only `three` is
 * imported. Every Part leaves these helpers as one indexed, finite, closed, outward-wound
 * surface: lathe profiles start and end on the axis (or close on themselves), extrude shapes are
 * simple polygons without bevels, and triangles whose corners collapse onto one position are
 * removed so that every remaining edge joins two distinct welded vertices.
 */

export type Point2 = readonly [number, number];

// ---------------------------------------------------------------------------
// Buffer hygiene
// ---------------------------------------------------------------------------

/** Adds an identity index to a non-indexed geometry (for example `ExtrudeGeometry`). */
export function ensureIndexed(geometry: BufferGeometry): BufferGeometry {
  if (geometry.index !== null) {
    return geometry;
  }
  const position = geometry.getAttribute("position");
  const index = new Uint32Array(position.count);
  for (let i = 0; i < index.length; i++) {
    index[i] = i;
  }
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

/**
 * Removes every triangle with two corners at exactly the same position: the pole fans of a
 * `LatheGeometry`, the zero-length segments used for crisp lathe corners, and zero-length
 * extrude side walls. Geometry groups are dropped, because every kit mesh has one material.
 */
export function dropCollapsedTriangles(geometry: BufferGeometry): BufferGeometry {
  const index = geometry.index;
  if (index === null) {
    throw new RangeError("dropCollapsedTriangles needs an indexed geometry; call ensureIndexed first");
  }
  const position = geometry.getAttribute("position");
  const same = (a: number, b: number): boolean =>
    position.getX(a) === position.getX(b) && position.getY(a) === position.getY(b) && position.getZ(a) === position.getZ(b);
  const kept: number[] = [];
  for (let t = 0; t + 2 < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    if (same(a, b) || same(b, c) || same(c, a)) {
      continue;
    }
    kept.push(a, b, c);
  }
  geometry.setIndex(new BufferAttribute(Uint32Array.from(kept), 1));
  geometry.clearGroups();
  return geometry;
}

/**
 * Reorders the triangles of an indexed geometry by the height (y) of their centroids, ties kept
 * in their original order. The surface is unchanged. The DBG_Builder stratifies its samples by
 * cumulative area in triangle order, so with this order every band of height on a lathe Part
 * (for example the stretch of a screw shaft inside a plate) receives its share of the samples,
 * where the lathe's own meridian-by-meridian order would scatter that band over every meridian.
 */
export function sortTrianglesByHeight(geometry: BufferGeometry): BufferGeometry {
  const index = geometry.index;
  if (index === null) {
    throw new RangeError("sortTrianglesByHeight needs an indexed geometry");
  }
  const position = geometry.getAttribute("position");
  const count = index.count / 3;
  const keys = Array.from({ length: count }, (_, t) => {
    let y = 0;
    for (let k = 0; k < 3; k++) y += position.getY(index.getX(3 * t + k));
    return { t, y };
  });
  keys.sort((a, b) => a.y - b.y || a.t - b.t);
  const sorted = new Uint32Array(index.count);
  keys.forEach(({ t }, i) => {
    for (let k = 0; k < 3; k++) sorted[3 * i + k] = index.getX(3 * t + k);
  });
  geometry.setIndex(new BufferAttribute(sorted, 1));
  return geometry;
}

/**
 * Throws unless the geometry has an index, a position and a normal attribute, at least one
 * triangle, in-range indices, and only finite position and normal components (Req 22.2).
 */
export function assertFiniteGeometry(geometry: BufferGeometry, label: string): void {
  const index = geometry.index;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (index === null || position === undefined || normal === undefined) {
    throw new RangeError(`${label}: geometry needs an index, a position and a normal attribute`);
  }
  if (index.count < 3 || index.count % 3 !== 0) {
    throw new RangeError(`${label}: geometry has ${index.count} indices, not a positive multiple of 3`);
  }
  for (let i = 0; i < index.count; i++) {
    const v = index.getX(i);
    if (!Number.isInteger(v) || v < 0 || v >= position.count) {
      throw new RangeError(`${label}: index ${i} points at vertex ${v}, outside 0..${position.count - 1}`);
    }
  }
  if (normal.count !== position.count) {
    throw new RangeError(`${label}: normal count ${normal.count} differs from position count ${position.count}`);
  }
  for (const [name, attribute] of [
    ["position", position],
    ["normal", normal],
  ] as const) {
    const values = attribute.array;
    for (let i = 0; i < values.length; i++) {
      if (!Number.isFinite(values[i])) {
        throw new RangeError(`${label}: ${name} component ${i} is not finite`);
      }
    }
  }
}

/** Translates the geometry in place by exact additions (no matrix rounding). */
export function translateExact(geometry: BufferGeometry, dx: number, dy: number, dz: number): BufferGeometry {
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(i, position.getX(i) + dx, position.getY(i) + dy, position.getZ(i) + dz);
  }
  position.needsUpdate = true;
  return geometry;
}

/**
 * Scales X and Z in place. A positive non-uniform scale keeps the surface closed and outward
 * wound. Normals are rescaled by the inverse transpose and renormalized.
 */
export function scaleXZ(geometry: BufferGeometry, sx: number, sz: number): BufferGeometry {
  if (!(sx > 0 && sz > 0)) {
    throw new RangeError("scaleXZ needs positive scale factors");
  }
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(i, position.getX(i) * sx, position.getY(i), position.getZ(i) * sz);
    const nx = normal.getX(i) / sx;
    const ny = normal.getY(i);
    const nz = normal.getZ(i) / sz;
    const length = Math.hypot(nx, ny, nz);
    normal.setXYZ(i, nx / length, ny / length, nz / length);
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  return geometry;
}

// ---------------------------------------------------------------------------
// Outline helpers (2D, counter-clockwise, no repeated closing point)
// ---------------------------------------------------------------------------

/** `n` points of a circle, counter-clockwise, starting at `startAngle`. */
export function circlePoints(cx: number, cy: number, r: number, n: number, startAngle = 0): Point2[] {
  const points: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const a = startAngle + (2 * Math.PI * i) / n;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return points;
}

/** `n` points of an axis-aligned ellipse, counter-clockwise, starting on +X. */
export function ellipsePoints(cx: number, cy: number, rx: number, ry: number, n: number): Point2[] {
  const points: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    points.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return points;
}

/** Points of a circular arc from `a0` to `a1` (radians), both ends included. */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Point2[] {
  const points: Point2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return points;
}

/**
 * A rectangle with rounded corners, counter-clockwise. `cornerSegments` points per corner arc.
 * Every corner radius must be at most half of the shorter side.
 */
export function roundedRectPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  cornerSegments: number,
): Point2[] {
  const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2);
  const corners: [number, number, number][] = [
    [x1 - r, y0 + r, -Math.PI / 2],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, Math.PI / 2],
    [x0 + r, y0 + r, Math.PI],
  ];
  const points: Point2[] = [];
  for (const [cx, cy, start] of corners) {
    points.push(...arcPoints(cx, cy, r, start, start + Math.PI / 2, cornerSegments));
  }
  return points;
}

/** Clamps every outline point with `x > limit` to `x = limit` (a straight flat on +X). */
export function clampOutlineX(points: readonly Point2[], limit: number): Point2[] {
  const result: Point2[] = [];
  for (const [x, y] of points) {
    const p: Point2 = [Math.min(x, limit), y];
    const last = result[result.length - 1];
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) {
      result.push(p);
    }
  }
  return result;
}

/** Signed area (positive for counter-clockwise). */
export function signedArea(points: readonly Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) {
      continue;
    }
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/** A `THREE.Shape` from an outline and hole outlines. Winding is normalized by three. */
export function polygonShape(outline: readonly Point2[], holes: readonly (readonly Point2[])[] = []): Shape {
  const shape = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
  for (const hole of holes) {
    shape.holes.push(new Path(hole.map(([x, y]) => new Vector2(x, y))));
  }
  return shape;
}

// ---------------------------------------------------------------------------
// Extrusion
// ---------------------------------------------------------------------------

function extrudeRaw(shape: Shape, depth: number, steps = 1): BufferGeometry {
  if (!(depth > 0)) {
    throw new RangeError("extrusion depth must be positive");
  }
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps, curveSegments: 1 });
  ensureIndexed(geometry);
  dropCollapsedTriangles(geometry);
  return geometry;
}

/**
 * Extrudes `shape` along +Y from `y0` to `y0 + depth`. The shape's 2D `(u, v)` maps to world
 * `(x, z) = (u, -v)`. The axis swap is exact (no trigonometry), so cap vertices stay exactly
 * coplanar and the two caps are exact mirror images about the mid-plane. `steps > 1` adds evenly
 * spaced intermediate rings of side-wall vertices. Construction_Axis: +Y.
 */
export function extrudeAlongY(shape: Shape, depth: number, y0: number, steps = 1): BufferGeometry {
  const geometry = extrudeRaw(shape, depth, steps);
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    position.setXYZ(i, x, z + y0, -y);
    normal.setXYZ(i, normal.getX(i), normal.getZ(i), -normal.getY(i));
  }
  return geometry;
}

/** Extrudes `shape` along +Z from `z0` to `z0 + depth`; `(u, v)` maps to `(x, y)`. Construction_Axis: +Z. */
export function extrudeAlongZ(shape: Shape, depth: number, z0: number): BufferGeometry {
  return translateExact(extrudeRaw(shape, depth), 0, 0, z0);
}

// ---------------------------------------------------------------------------
// Lathe
// ---------------------------------------------------------------------------

/**
 * Keyed-lathe features (design "Keyed screw recipe", R6, R11). All features move vertices only
 * in X or Z, so axial coordinates never change.
 *
 * - `flats`: in rings with `yMin <= y <= yMax`, clamp `|z| > rho - depth` to `±(rho - depth)`,
 *   where `rho` is the ring's profile radius. Several bands may be given; the first band that
 *   contains a ring applies to it. Two mirrored flats separate the in-plane variances
 *   without adding skew or axis cross-covariance.
 * - `index`: in rings within the range, clamp `x > rho - depth` to `rho - depth`. One flat on +X
 *   gives the skew that fixes the sign of the in-plane axis.
 * - `balance`: in rings within the range, the +X meridian vertex is pushed inward by the amount
 *   that makes the vertex cross-moment `Σ Δx (y − ȳ)` exactly zero. The index flat and its
 *   counterweight then add no X–Y covariance, so they do not tilt the principal axes off the
 *   lathe axis (PCA tilt bound, Req 23.12).
 */
export interface LatheKeying {
  /** `minRadius` limits a feature to rings at least that large (for example to spare a bore). */
  flats?: readonly { yMin: number; yMax: number; depth: number; minRadius?: number }[];
  index?: { yMin: number; yMax: number; depth: number; minRadius?: number };
  balance?: { yMin: number; yMax: number; minRadius?: number };
}

export interface LatheOptions {
  /** Lathe segments. A multiple of 4 so that meridians exist at +X, -X, +Z and -Z. */
  segments: number;
  /** Interior profile corners sharper than this (degrees) are duplicated for crisp shading. */
  creaseAngleDeg?: number;
  keying?: LatheKeying;
}

/**
 * A lathe about +Y from a profile of `[radius, y]` points. The profile must start and end on the
 * axis (radius 0), or be a closed loop whose last point equals its first, and must run
 * counter-clockwise in the (radius, y) half-plane (bottom, then outside, then top) so normals
 * face outward. The seam column is made bitwise equal to the first column, and collapsed pole
 * triangles are dropped. Construction_Axis: +Y.
 */
export function buildLathe(profile: readonly Point2[], options: LatheOptions): BufferGeometry {
  const { segments } = options;
  if (!Number.isInteger(segments) || segments < 8 || segments % 4 !== 0) {
    throw new RangeError("lathe segments must be an integer multiple of 4, at least 8");
  }
  if (profile.length < 3) {
    throw new RangeError("a lathe profile needs at least 3 points");
  }
  for (const [r, y] of profile) {
    if (!(r >= 0) || !Number.isFinite(r) || !Number.isFinite(y)) {
      throw new RangeError("lathe profile radii must be finite and non-negative");
    }
  }
  const crease = ((options.creaseAngleDeg ?? 35) * Math.PI) / 180;
  const points: Vector2[] = [];
  for (let j = 0; j < profile.length; j++) {
    const p = profile[j] as Point2;
    const point = new Vector2(p[0], p[1]);
    points.push(point);
    const prev = profile[j - 1];
    const next = profile[j + 1];
    if (prev === undefined || next === undefined || p[0] === 0) {
      continue;
    }
    const a = Math.atan2(p[1] - prev[1], p[0] - prev[0]);
    const b = Math.atan2(next[1] - p[1], next[0] - p[0]);
    let turn = Math.abs(b - a);
    if (turn > Math.PI) {
      turn = 2 * Math.PI - turn;
    }
    if (turn > crease) {
      points.push(new Vector2(p[0], p[1]));
    }
  }

  const geometry = new LatheGeometry(points, segments);
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const columns = points.length;
  // Exact seam: copy the first column into the last one, and fold -0 into 0 on the axis.
  for (let j = 0; j < columns; j++) {
    const first = j;
    const last = segments * columns + j;
    position.setXYZ(last, position.getX(first), position.getY(first), position.getZ(first));
    normal.setXYZ(last, normal.getX(first), normal.getY(first), normal.getZ(first));
  }
  for (let v = 0; v < position.count; v++) {
    position.setXYZ(v, position.getX(v) + 0, position.getY(v) + 0, position.getZ(v) + 0);
  }
  const radiusOf = (v: number): number => (points[v % columns] as Vector2).x;
  // Exact meridian coordinates: three uses sin/cos, which leaves 1e-16 residues on the axes.
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j < columns; j++) {
      const v = i * columns + j;
      const r = radiusOf(v);
      const q = i % segments;
      if (q === 0) position.setXYZ(v, 0, position.getY(v), r);
      else if (q === segments / 4) position.setXYZ(v, r, position.getY(v), 0);
      else if (q === segments / 2) position.setXYZ(v, 0, position.getY(v), -r);
      else if (q === (3 * segments) / 4) position.setXYZ(v, -r, position.getY(v), 0);
    }
  }

  if (options.keying !== undefined) {
    applyKeying(geometry, radiusOf, segments, columns, options.keying);
  }
  ensureIndexed(geometry);
  dropCollapsedTriangles(geometry);
  return geometry;
}

/**
 * Positions are stored as float32, so range ends are widened by a few float32 ulps to keep a
 * profile point given in float64 inside the range it was declared in.
 */
function inRange(y: number, range: { yMin: number; yMax: number }, rho = Number.POSITIVE_INFINITY, minRadius = 0): boolean {
  const slack = (bound: number): number => 1e-6 * (Math.abs(bound) + 1);
  return y >= range.yMin - slack(range.yMin) && y <= range.yMax + slack(range.yMax) && rho >= minRadius;
}

function applyKeying(
  geometry: BufferGeometry,
  radiusOf: (v: number) => number,
  segments: number,
  columns: number,
  keying: LatheKeying,
): void {
  const position = geometry.getAttribute("position");
  const { flats, index, balance } = keying;
  const originalX = new Float64Array(position.count);
  for (let v = 0; v < position.count; v++) {
    originalX[v] = position.getX(v);
  }
  for (let v = 0; v < position.count; v++) {
    const rho = radiusOf(v);
    const y = position.getY(v);
    if (rho === 0) {
      continue;
    }
    const flat = flats?.find((band) => inRange(y, band, rho, band.minRadius));
    if (flat !== undefined) {
      const limit = rho - flat.depth;
      if (!(limit > 0)) {
        throw new RangeError(`flat depth ${flat.depth} cuts through a ring of radius ${rho}`);
      }
      const z = position.getZ(v);
      if (Math.abs(z) > limit) {
        position.setZ(v, Math.sign(z) * limit);
      }
    }
    if (index !== undefined && inRange(y, index, rho, index.minRadius)) {
      const limit = rho - index.depth;
      if (!(limit > 0)) {
        throw new RangeError(`index depth ${index.depth} cuts through a ring of radius ${rho}`);
      }
      if (position.getX(v) > limit) {
        position.setX(v, limit);
      }
    }
  }
  if (balance === undefined) {
    return;
  }
  // Cross-moment over the unique vertex set, which is what the Axis_Generator sees.
  const unique = uniqueVertexIndices(position);
  let meanY = 0;
  for (const v of unique) meanY += position.getY(v);
  meanY /= unique.length;
  let moment = 0;
  for (const v of unique) {
    moment += (position.getX(v) - (originalX[v] ?? 0)) * (position.getY(v) - meanY);
  }
  const isCounter = (v: number): boolean =>
    Math.floor(v / columns) % segments === segments / 4 &&
    radiusOf(v) > 0 &&
    inRange(position.getY(v), balance, radiusOf(v), balance.minRadius);
  // Every copy (crisp-corner duplicates) moves; the lever counts each position once.
  const counter: number[] = [];
  for (let v = 0; v < position.count; v++) {
    if (isCounter(v)) counter.push(v);
  }
  let lever = 0;
  for (const v of unique) {
    if (isCounter(v)) lever += position.getY(v) - meanY;
  }
  if (moment === 0) {
    return;
  }
  if (counter.length === 0 || lever === 0) {
    throw new RangeError("the balance range selects no +X meridian vertices");
  }
  const shift = moment / lever; // Moving each counter vertex by -shift cancels the moment.
  if (!(shift > 0)) {
    throw new RangeError("the balance range must lie on the opposite side of the vertex centroid from the index flat");
  }
  for (const v of counter) {
    const rho = radiusOf(v);
    if (!(shift < 0.5 * rho)) {
      throw new RangeError(`balance shift ${shift} is too deep for a ring of radius ${rho}`);
    }
  }
  // Seam copies are never on the +X meridian, so moving `counter` keeps every position welded.
  for (const v of counter) {
    position.setX(v, position.getX(v) - shift);
  }
}

/** Indices of the first vertex at each distinct position, in index order. */
export function uniqueVertexIndices(position: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }): number[] {
  const seen = new Set<string>();
  const result: number[] = [];
  for (let v = 0; v < position.count; v++) {
    const key = `${position.getX(v) + 0},${position.getY(v) + 0},${position.getZ(v) + 0}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(v);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Gears
// ---------------------------------------------------------------------------

export interface GearToothSpec {
  teeth: number;
  /** Module in kit units (pitch diameter = module × teeth). */
  module: number;
  /** Pressure angle in degrees (20 is standard). */
  pressureAngleDeg?: number;
  /** Arc thinning of each tooth at the pitch circle, in kit units (half per flank). */
  backlash: number;
  /** Points per involute flank. */
  flankPoints?: number;
  /** Rotation of tooth 0's centre line, in radians. */
  phase: number;
}

/** Pitch, base, tip and root radii of a standard involute gear (addendum m, dedendum 1.25 m). */
export function gearRadii(spec: Pick<GearToothSpec, "teeth" | "module" | "pressureAngleDeg">): {
  pitch: number;
  base: number;
  tip: number;
  root: number;
} {
  const pitch = (spec.module * spec.teeth) / 2;
  const alpha = ((spec.pressureAngleDeg ?? 20) * Math.PI) / 180;
  return { pitch, base: pitch * Math.cos(alpha), tip: pitch + spec.module, root: pitch - 1.25 * spec.module };
}

/**
 * Counter-clockwise involute gear outline. Each flank follows the true involute of the base
 * circle from max(root, base) to the tip, with a tip land, a radial run down to the root where
 * the root lies inside the base circle, and a short root arc between teeth.
 */
export function gearOutline(spec: GearToothSpec): Point2[] {
  const { teeth, backlash, phase } = spec;
  const { pitch, base, tip, root } = gearRadii(spec);
  const flankPoints = spec.flankPoints ?? 5;
  const inv = (r: number): number => {
    const a = Math.acos(Math.min(1, base / r));
    return Math.tan(a) - a;
  };
  // Half the tooth's angular thickness at the pitch circle, minus half the backlash.
  const halfPitchAngle = (Math.PI / teeth - backlash / pitch) / 2;
  const halfAngle = (r: number): number => halfPitchAngle + inv(pitch) - inv(r);
  if (!(halfAngle(tip) > 0.02 / teeth)) {
    throw new RangeError(`gear with ${teeth} teeth has pointed teeth; use more teeth or a smaller pressure angle`);
  }
  const start = Math.max(root, base);
  const flankRadii: number[] = [];
  for (let k = 0; k < flankPoints; k++) {
    // Denser near the base, where the involute bends most.
    const s = k / (flankPoints - 1);
    flankRadii.push(start + (tip - start) * (1 - (1 - s) * (1 - s)));
  }
  const toothPitch = (2 * Math.PI) / teeth;
  const points: Point2[] = [];
  const polar = (r: number, a: number): Point2 => [r * Math.cos(a), r * Math.sin(a)];
  for (let t = 0; t < teeth; t++) {
    const c = phase + t * toothPitch;
    const rootHalf = halfAngle(start);
    // Root arc centred on the gap before this tooth.
    const gapStart = c - toothPitch + rootHalf;
    const gapEnd = c - rootHalf;
    if (root < start) {
      points.push(polar(root, gapStart + (gapEnd - gapStart) * 0.18));
      points.push(polar(root, gapStart + (gapEnd - gapStart) * 0.5));
      points.push(polar(root, gapStart + (gapEnd - gapStart) * 0.82));
    } else {
      points.push(polar(root, gapStart + (gapEnd - gapStart) * 0.5));
    }
    // Leading flank (lower angle), root to tip.
    for (const r of flankRadii) {
      points.push(polar(r, c - halfAngle(r)));
    }
    // Trailing flank, tip to root.
    for (let k = flankRadii.length - 1; k >= 0; k--) {
      const r = flankRadii[k] as number;
      points.push(polar(r, c + halfAngle(r)));
    }
  }
  return points;
}

/**
 * Meshing phase for gear B placed at angle `beta` (radians) from gear A's centre, so that a tooth
 * of A at the pitch point faces a gap of B (rolling contact relation).
 */
export function meshingPhase(phaseA: number, teethA: number, pitchA: number, teethB: number, pitchB: number, beta: number): number {
  const toothPitchA = (2 * Math.PI) / teethA;
  let delta = (beta - phaseA) % toothPitchA;
  if (delta > toothPitchA / 2) delta -= toothPitchA;
  if (delta < -toothPitchA / 2) delta += toothPitchA;
  const gapCentre = beta + Math.PI + (delta * pitchA) / pitchB;
  return gapCentre + Math.PI / teethB;
}

/** A keyed bore: a circle of radius `r` with a rectangular keyway notch toward `keyAngle`. */
export function keyedBorePoints(r: number, keyWidth: number, keyDepth: number, keyAngle: number, n: number): Point2[] {
  const half = Math.asin(Math.min(0.9, keyWidth / 2 / r));
  const arc = arcPoints(0, 0, r, keyAngle + half, keyAngle + 2 * Math.PI - half, n);
  const cos = Math.cos(keyAngle);
  const sin = Math.sin(keyAngle);
  const local = (u: number, v: number): Point2 => [u * cos - v * sin, u * sin + v * cos];
  const outer = r + keyDepth;
  // The arc already ends on both sides of the keyway. Repeating those two points would add
  // vertices that weld away in 3D but still count in a 2D moment balance.
  return [...arc, local(outer, -r * Math.sin(half)), local(outer, r * Math.sin(half))];
}

/**
 * Rotates the hole outlines of a gear about the gear centre so that the in-plane principal axes
 * of the whole vertex set (outline plus holes) line up with the shape's u and v axes.
 *
 * A tooth outline with Z-fold symmetry (Z >= 3) has isotropic second moments, so the principal
 * axes come only from the holes and rotate rigidly with them: one rotation by the measured angle
 * aligns them. With the axes on u and v, the gear's PCA Candidate_Axes coincide with Canonical
 * Directions, so no oblique sweep direction can graze a neighbour.
 */
export function alignHolesToPrincipalAxes(outline: readonly Point2[], holes: readonly (readonly Point2[])[]): Point2[][] {
  const all = [...outline, ...holes.flat()];
  let mu = 0;
  let mv = 0;
  for (const [u, v] of all) {
    mu += u;
    mv += v;
  }
  mu /= all.length;
  mv /= all.length;
  let cuu = 0;
  let cvv = 0;
  let cuv = 0;
  for (const [u, v] of all) {
    cuu += (u - mu) * (u - mu);
    cvv += (v - mv) * (v - mv);
    cuv += (u - mu) * (v - mv);
  }
  // Angle of the major axis; rotating the holes by its negative puts the major axis on u.
  const angle = 0.5 * Math.atan2(2 * cuv, cuu - cvv);
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  return holes.map((hole) => hole.map(([u, v]) => [u * c - v * s, u * s + v * c] as Point2));
}

/** An annular-sector window (a "kidney" cut-out between spokes), counter-clockwise. */
export function windowPoints(r0: number, r1: number, a0: number, a1: number, arcSegments: number): Point2[] {
  const outer = arcPoints(0, 0, r1, a0, a1, arcSegments);
  const inner = arcPoints(0, 0, r0, a1, a0, Math.max(2, Math.round((arcSegments * r0) / r1)));
  return [...outer, ...inner];
}

// ---------------------------------------------------------------------------
// Principal-axis balancing (R6, R11)
// ---------------------------------------------------------------------------

/** Mean-centred cross-moment `mean((u - ū)(v - v̄))` of a 2D point set. */
export function crossMoment2(points: readonly Point2[]): number {
  let mu = 0;
  let mv = 0;
  for (const [u, v] of points) {
    mu += u;
    mv += v;
  }
  mu /= points.length;
  mv /= points.length;
  let c = 0;
  for (const [u, v] of points) c += (u - mu) * (v - mv);
  return c / points.length;
}

/**
 * Finds the root of `f` in `[lo, hi]` by 80 bisection steps. `f(lo)` and `f(hi)` must have
 * opposite signs, otherwise the feature cannot balance the Part and `label` is reported.
 */
export function bisectRoot(f: (t: number) => number, lo: number, hi: number, label: string): number {
  const fLo = f(lo);
  const signLo = Math.sign(fLo);
  if (signLo === 0) return lo;
  const fHi = f(hi);
  if (signLo === Math.sign(fHi)) {
    throw new RangeError(`${label}: the balancing feature cannot cancel the cross-moment in [${lo}, ${hi}] (${fLo} to ${fHi})`);
  }
  let a = lo;
  let b = hi;
  for (let i = 0; i < 80; i++) {
    const mid = (a + b) / 2;
    if (Math.sign(f(mid)) === signLo) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/** World (x, z) outline to the shape plane of {@link extrudeAlongY}, where `(u, v) = (x, -z)`. */
export function toShapeXZ(points: readonly Point2[]): Point2[] {
  return points.map(([x, z]) => [x, -z] as Point2);
}

/** A corner of {@link cornerOutline}: a circular arc of radius `r` or a straight chamfer of leg `c`. */
export type CornerSpec = { readonly kind: "arc"; readonly r: number; readonly segments?: number } | { readonly kind: "chamfer"; readonly c: number };

/**
 * Rectangle `[x0, x1] × [z0, z1]` in the (x, z) plane with one spec per corner, listed in the
 * order (x1, z0), (x1, z1), (x0, z1), (x0, z0). The outline runs counter-clockwise in (x, z).
 */
export function cornerOutline(x0: number, x1: number, z0: number, z1: number, corners: readonly [CornerSpec, CornerSpec, CornerSpec, CornerSpec]): Point2[] {
  const centres: [number, number, number, number, number][] = [
    // corner x, corner z, inward x sign, inward z sign, start angle of the arc
    [x1, z0, -1, 1, -Math.PI / 2],
    [x1, z1, -1, -1, 0],
    [x0, z1, 1, -1, Math.PI / 2],
    [x0, z0, 1, 1, Math.PI],
  ];
  const points: Point2[] = [];
  centres.forEach(([cx, cz, sx, sz, start], k) => {
    const spec = corners[k] as CornerSpec;
    if (spec.kind === "chamfer") {
      // Entering along the previous edge, then leaving along the next one.
      const enter: Point2 = k % 2 === 0 ? [cx + sx * spec.c, cz] : [cx, cz + sz * spec.c];
      const leave: Point2 = k % 2 === 0 ? [cx, cz + sz * spec.c] : [cx + sx * spec.c, cz];
      points.push(enter, leave);
    } else {
      points.push(...arcPoints(cx + sx * spec.r, cz + sz * spec.r, spec.r, start, start + Math.PI / 2, spec.segments ?? 3));
    }
  });
  return points;
}

/** One ring of {@link buildSquareColumn}: half-extents, height, and a centre offset in (x, z). */
export interface ColumnRing {
  readonly hx: number;
  readonly hz: number;
  readonly y: number;
  readonly cx?: number;
  readonly cz?: number;
  /**
   * Explicit (x, z) corners in the order (+x, +z), (+x, -z), (-x, -z), (-x, +z), replacing the
   * rectangle. The quadrilateral must be convex and contain the rings it steps to.
   */
  readonly quad?: readonly [Point2, Point2, Point2, Point2];
}

/**
 * A keyed quadrilateral of half-extents `hx` × `hz` for {@link buildSquareColumn}: the (+x, +z)
 * corner is cut inward along the diagonal by `cut`, and the (+x, -z) corner is pulled in along x
 * by the amount that makes the centred X–Z cross-moment of the 4 corners exactly zero. The corners
 * are then shifted to a zero mean. Both changes sit on the +x side, so the corners keep a skew
 * along x and along z, while the ring adds no cross-moment and no first moment.
 */
export function keyedQuad(hx: number, hz: number, cut: number): [Point2, Point2, Point2, Point2] {
  const raw = (pull: number): Point2[] => [
    [hx - cut, hz - cut],
    [hx - pull, -hz],
    [-hx, -hz],
    [-hx, hz],
  ];
  const pull = bisectRoot((p) => crossMoment2(raw(p)), 0, hx, "keyed quad");
  const points = raw(pull);
  const mx = points.reduce((s, p) => s + p[0], 0) / 4;
  const mz = points.reduce((s, p) => s + p[1], 0) / 4;
  const [a, b, c, d] = points.map(([x, z]) => [x - mx, z - mz] as Point2) as [Point2, Point2, Point2, Point2];
  return [a, b, c, d];
}

/**
 * A stepped square column: a 4-segment `LatheGeometry` about +Y whose four meridians are moved
 * onto the corners `(cx ± hx, cz ± hz)` of each ring, which is a 45° rotation plus a positive
 * scale and keeps the winding outward. `rings` run bottom to top in the lathe profile order
 * (bottom, outside, top). A ring with `hx = hz = 0` is a pole: its copies collapse onto
 * `(cx, y, cz)` and the pole fans are dropped. Normals are recomputed. Construction_Axis: +Y.
 */
export function buildSquareColumn(rings: readonly ColumnRing[]): BufferGeometry {
  if (rings.length < 3) {
    throw new RangeError("a square column needs at least 3 rings");
  }
  const points = rings.map((ring) => new Vector2(Math.max(ring.hx, ring.hz), ring.y));
  const geometry = new LatheGeometry(points, 4);
  const position = geometry.getAttribute("position");
  // Meridian i of the lathe lies at +Z, +X, -Z, -X, +Z (seam); rotated 45° they become these corners.
  const corner: readonly (readonly [number, number])[] = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
    [1, 1],
  ];
  for (let i = 0; i <= 4; i++) {
    const [sx, sz] = corner[i] as readonly [number, number];
    rings.forEach((ring, j) => {
      const q = ring.quad?.[i % 4];
      const x = q !== undefined ? q[0] : sx * ring.hx;
      const z = q !== undefined ? q[1] : sz * ring.hz;
      position.setXYZ(i * rings.length + j, (ring.cx ?? 0) + x + 0, ring.y + 0, (ring.cz ?? 0) + z + 0);
    });
  }
  position.needsUpdate = true;
  ensureIndexed(geometry);
  dropCollapsedTriangles(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Keyed lathe screw (design "Keyed screw recipe")
// ---------------------------------------------------------------------------

export interface KeyedScrewSpec {
  headRadius: number;
  headHeight: number;
  shaftRadius: number;
  shaftLength: number;
  /** Hex-socket-style round recess in the head (radius, depth). */
  socket?: { radius: number; depth: number };
  segments?: number;
  /** Two clamped flats, as a fraction of the head diameter (default 3.5%). */
  flatFraction?: number;
  /** Single index flat, as a fraction of the head diameter (about 1.3%). */
  indexFraction?: number;
  /**
   * Flats on the shaft, as a fraction of the shaft diameter (default 12%). They sit inside the
   * head's footprint, so they deepen the in-plane variance gap without changing the OBB.
   */
  shaftFlatFraction?: number;
}

/**
 * A pan-head screw about +Y: the underside of the head is at `y = 0`, the head rises to
 * `headHeight`, and the shaft runs down to `-shaftLength` with a chamfered tip. Two mirrored
 * flats are clamped on head and shaft, one index flat on the head, and a balancing index cut on
 * the tip so the principal axis stays on the shaft axis. Construction_Axis: +Y.
 */
export function buildKeyedScrew(spec: KeyedScrewSpec): BufferGeometry {
  const { headRadius: rh, headHeight: hh, shaftRadius: rs, shaftLength: L } = spec;
  const chamfer = Math.min(0.35 * rs, 0.4);
  const profile: Point2[] = [
    [0, -L],
    [rs - chamfer, -L],
    [rs, -L + chamfer],
    [rs, 0],
    [rh, 0],
    [rh, 0.5 * hh],
    [0.94 * rh, 0.78 * hh],
    [0.8 * rh, 0.94 * hh],
    [0.62 * rh, hh],
  ];
  if (spec.socket !== undefined) {
    profile.push([spec.socket.radius, hh], [spec.socket.radius, hh - spec.socket.depth], [0, hh - spec.socket.depth]);
  } else {
    profile.push([0, hh]);
  }
  const diameter = 2 * rh;
  return buildLathe(profile, {
    segments: spec.segments ?? 32,
    keying: {
      flats: [
        { yMin: -L, yMax: -1e-9, depth: (spec.shaftFlatFraction ?? 0.12) * 2 * rs },
        { yMin: -L, yMax: hh, depth: (spec.flatFraction ?? 0.035) * diameter },
      ],
      index: { yMin: 0, yMax: hh, depth: (spec.indexFraction ?? 0.013) * diameter },
      balance: { yMin: -L, yMax: -L + chamfer },
    },
  });
}
