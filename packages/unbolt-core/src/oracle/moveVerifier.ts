import { Box3, Matrix4, Vector3 } from "three";
import type { ExtendedTriangle, HitPointInfo } from "three-mesh-bvh";
import type { ResolvedSolverConfig, SolverConfig } from "../config";
import { validateConfig } from "../config";
import {
  InvalidDirectionError,
  InvalidMoveDistanceError,
  InvalidSolverConfigError,
  InvalidTrajectoryError,
  MovingPartInStaticSetError,
} from "../errors";
import type {
  ClashPart,
  LinearMove,
  MoveVerdict,
  MoveVerification,
  PairVerification,
  StepVerification,
  TrajectoryStep,
  TrajectoryVerification,
  Vec3,
} from "../types";

/**
 * Independent verifier for finite straight moves (spec crossed-bars-false-verified).
 *
 * A move is a Part A, a unit direction d and a distance D, against the Parts still present, all
 * in normalized coordinates. Each static Part B gets one verdict:
 *
 * - **clear** only with a proof that the interiors of A(s) and B never meet for s in [0, D]:
 *   the swept boxes are more than epsilon apart (`separated_boxes`); or the start is shown to be
 *   interior-disjoint and the surface distance stays at least epsilon over the whole move
 *   (`separation_distance`); or the distance proof holds up to a contact and one plane then
 *   separates the Parts with no positive overlap beyond float64 rounding (`contact_plane`).
 * - **blocked** only with a witness: a point more than epsilon inside both closed, outward-wound
 *   solids at some travel (`penetration_witness`).
 * - **unverified** otherwise, with the reason.
 *
 * Epsilon is `clearanceEpsilon` from the config. It is compared against the swept-box gap, the
 * surface distance and the witness depth. It is never an allowed overlap: a contact plane must
 * show an overlap of at most the rounding bound `planeRoundingBound`, which is about 1e-14.
 *
 * This module is the independent check. It imports no Stage 2 or Stage 3 module, no PRNG and not
 * the legacy Clash_Checker, and it recomputes every face normal from triangle winding.
 */

const DIRECTION_TOLERANCE = 1e-6;
/** Each distance step advances by more than epsilon, so this bounds D / epsilon. */
const MAX_ADVANCE_ITERATIONS = 4096;
/** The witness search samples `WITNESS_POSE_INTERVALS + 1` evenly spaced poses after contact. */
const WITNESS_POSE_INTERVALS = 16;
/** Intersecting triangle pairs examined per pose. */
const WITNESS_PAIRS_PER_POSE = 256;
/** Triangle pairs visited per pose, intersecting or not. */
const WITNESS_VISITS_PER_POSE = 65536;
/** Candidate offsets 2·eps·2^j, for j = 0 .. count - 1. */
const WITNESS_RADIUS_COUNT = 12;
/** Nearby face normals taken from each Part as contact-plane candidates. */
const PLANE_NORMALS_PER_PART = 32;
/** A winding number within this of 1 is inside, within this of 0 is outside, else ambiguous. */
const WINDING_TOLERANCE = 0.25;
/** Relative float64 rounding allowance for one projection overlap: 2^-46, about 128 units of the last place. */
const PLANE_ROUNDING_FACTOR = 2 ** -46;
/** Pairs of face normals shorter than this are treated as opposite faces. */
const OPPOSING_NORMAL_LENGTH = 1e-6;

function at(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`index ${index} is outside a list of ${values.length} numbers`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Per-Part solid data
// ---------------------------------------------------------------------------

type SolidStatus = "ok" | "open_mesh" | "invalid_orientation";

interface SolidData {
  readonly status: SolidStatus;
  /** One vertex index per connected shell, used to classify the start. */
  readonly shellVertices: readonly number[];
  /** Largest |x| + |y| + |z| over the vertices, for the plane rounding bound. */
  readonly maxL1: number;
}

const solidCache = new WeakMap<ClashPart, SolidData>();

function findRoot(parent: Int32Array, x: number): number {
  let root = x;
  while (at(parent, root) !== root) {
    root = at(parent, root);
  }
  let node = x;
  while (at(parent, node) !== root) {
    const next = at(parent, node);
    parent[node] = root;
    node = next;
  }
  return root;
}

/**
 * Closed: every directed welded edge of a triangle with three distinct weld clusters appears
 * exactly once, and so does its reverse. Oriented: every connected shell encloses positive
 * signed volume. Triangles whose corners share a weld cluster add nothing and are skipped.
 */
function buildSolidData(part: ClashPart): SolidData {
  const { positions, triangles, weldIds, weldRepresentatives } = part;
  const clusterCount = weldRepresentatives.length;
  const triangleCount = Math.floor(triangles.length / 3);
  let maxL1 = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    maxL1 = Math.max(maxL1, Math.abs(at(positions, i)) + Math.abs(at(positions, i + 1)) + Math.abs(at(positions, i + 2)));
  }
  const directed = new Map<number, number>();
  const parent = new Int32Array(clusterCount);
  for (let c = 0; c < clusterCount; c++) {
    parent[c] = c;
  }
  const used: number[] = [];
  for (let t = 0; t < triangleCount; t++) {
    const w: Vec3 = [at(weldIds, at(triangles, 3 * t)), at(weldIds, at(triangles, 3 * t + 1)), at(weldIds, at(triangles, 3 * t + 2))];
    if (w[0] === w[1] || w[1] === w[2] || w[2] === w[0]) {
      continue;
    }
    used.push(t);
    for (let k = 0; k < 3; k++) {
      const key = at(w, k) * clusterCount + at(w, (k + 1) % 3);
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
    const ra = findRoot(parent, w[0]);
    const rb = findRoot(parent, w[1]);
    const rc = findRoot(parent, w[2]);
    parent[rb] = ra;
    parent[findRoot(parent, rc)] = ra;
  }
  if (used.length === 0) {
    return { status: "open_mesh", shellVertices: [], maxL1 };
  }
  for (const [key, count] of directed) {
    const a = Math.floor(key / clusterCount);
    const b = key - a * clusterCount;
    if (count !== 1 || directed.get(b * clusterCount + a) !== 1) {
      return { status: "open_mesh", shellVertices: [], maxL1 };
    }
  }
  // Signed volume per shell, about the shell's first vertex to limit cancellation.
  const shellOrigin = new Map<number, number>();
  const shellVolume = new Map<number, number>();
  for (const t of used) {
    const root = findRoot(parent, at(weldIds, at(triangles, 3 * t)));
    if (!shellOrigin.has(root)) {
      shellOrigin.set(root, at(weldRepresentatives, root));
    }
    const o = 3 * (shellOrigin.get(root) as number);
    const corner = (k: number): Vec3 => {
      const v = 3 * at(triangles, 3 * t + k);
      return [at(positions, v) - at(positions, o), at(positions, v + 1) - at(positions, o + 1), at(positions, v + 2) - at(positions, o + 2)];
    };
    const a = corner(0);
    const b = corner(1);
    const c = corner(2);
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    shellVolume.set(root, (shellVolume.get(root) ?? 0) + det / 6);
  }
  const shellVertices: number[] = [];
  for (const [root, volume] of [...shellVolume].sort((x, y) => x[0] - y[0])) {
    if (!(volume > 0)) {
      return { status: "invalid_orientation", shellVertices: [], maxL1 };
    }
    shellVertices.push(at(weldRepresentatives, root));
  }
  return { status: "ok", shellVertices, maxL1 };
}

function solidOf(part: ClashPart): SolidData {
  let data = solidCache.get(part);
  if (data === undefined) {
    data = buildSolidData(part);
    solidCache.set(part, data);
  }
  return data;
}

/**
 * Generalized winding number of the closed mesh `part`, translated by `offset`, at `p`: the
 * summed signed solid angle of its triangles over 4π (Van Oosterom and Strackee). It is 1 inside
 * and 0 outside an outward-wound closed solid, away from the surface.
 */
function windingNumber(part: ClashPart, p: Vec3, offset: Vec3): number {
  const { positions, triangles } = part;
  let sum = 0;
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const rel = (k: number): Vec3 => {
      const v = 3 * at(triangles, t + k);
      return [at(positions, v) + offset[0] - p[0], at(positions, v + 1) + offset[1] - p[1], at(positions, v + 2) + offset[2] - p[2]];
    };
    const a = rel(0);
    const b = rel(1);
    const c = rel(2);
    const la = Math.hypot(a[0], a[1], a[2]);
    const lb = Math.hypot(b[0], b[1], b[2]);
    const lc = Math.hypot(c[0], c[1], c[2]);
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    const ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const bc = b[0] * c[0] + b[1] * c[1] + b[2] * c[2];
    const ca = c[0] * a[0] + c[1] * a[1] + c[2] * a[2];
    sum += 2 * Math.atan2(det, la * lb * lc + ab * lc + bc * la + ca * lb);
  }
  return sum / (4 * Math.PI);
}

type PointClass = "inside" | "outside" | "ambiguous";

function classify(part: ClashPart, p: Vec3, offset: Vec3): PointClass {
  const w = windingNumber(part, p, offset);
  if (Math.abs(w - 1) <= WINDING_TOLERANCE) {
    return "inside";
  }
  if (Math.abs(w) <= WINDING_TOLERANCE) {
    return "outside";
  }
  return "ambiguous";
}

function vertexOf(part: ClashPart, index: number): Vec3 {
  return [at(part.positions, 3 * index), at(part.positions, 3 * index + 1), at(part.positions, 3 * index + 2)];
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function scaled(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function unit(a: Vec3): Vec3 | null {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 0 ? [a[0] / length, a[1] / length, a[2] / length] : null;
}
function fromVector(v: Vector3): Vec3 {
  return [v.x, v.y, v.z];
}
function triangleNormal(t: ExtendedTriangle): Vec3 | null {
  const a = fromVector(t.a);
  return unit(cross(sub(fromVector(t.b), a), sub(fromVector(t.c), a)));
}

/**
 * The points where triangle `tri` meets the plane `n·x = c`: crossing edges and vertices on the
 * plane. Returns null when all three vertices lie strictly on one side or all on the plane.
 */
function planeCrossing(tri: readonly Vec3[], n: Vec3, c: number): Vec3[] | null {
  const d = tri.map((v) => dot(n, v) - c);
  const d0 = at(d, 0);
  const d1 = at(d, 1);
  const d2 = at(d, 2);
  if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0) || (d0 === 0 && d1 === 0 && d2 === 0)) {
    return null;
  }
  const points: Vec3[] = [];
  for (let k = 0; k < 3; k++) {
    const p = tri[k] as Vec3;
    const q = tri[(k + 1) % 3] as Vec3;
    const dp = at(d, k);
    const dq = at(d, (k + 1) % 3);
    if (dp === 0) {
      points.push(p);
    }
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      points.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])]);
    }
  }
  return points;
}

/** Midpoint of the intersection segment of two non-coplanar triangles, or null when they do not meet. */
function intersectionMidpoint(p: readonly Vec3[], q: readonly Vec3[]): Vec3 | null {
  const [p0, p1, p2] = p as [Vec3, Vec3, Vec3];
  const [q0, q1, q2] = q as [Vec3, Vec3, Vec3];
  const np = cross(sub(p1, p0), sub(p2, p0));
  const nq = cross(sub(q1, q0), sub(q2, q0));
  const line = cross(np, nq);
  if (!(Math.hypot(line[0], line[1], line[2]) > 0)) {
    return null;
  }
  const onP = planeCrossing(q, np, dot(np, p0));
  const onQ = planeCrossing(p, nq, dot(nq, q0));
  if (onP === null || onQ === null) {
    return null;
  }
  const extent = (points: Vec3[]): { lo: number; hi: number; loPoint: Vec3; hiPoint: Vec3 } => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let loPoint = points[0] as Vec3;
    let hiPoint = loPoint;
    for (const point of points) {
      const t = dot(line, point);
      if (t < lo) {
        lo = t;
        loPoint = point;
      }
      if (t > hi) {
        hi = t;
        hiPoint = point;
      }
    }
    return { lo, hi, loPoint, hiPoint };
  };
  // `onQ` is triangle p's crossing of q's plane; `onP` is q's crossing of p's plane.
  const a = extent(onQ);
  const b = extent(onP);
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  if (lo > hi) {
    return null;
  }
  const mid = (lo + hi) / 2;
  if (a.hi === a.lo) {
    return a.loPoint;
  }
  const f = (mid - a.lo) / (a.hi - a.lo);
  return [a.loPoint[0] + f * (a.hiPoint[0] - a.loPoint[0]), a.loPoint[1] + f * (a.hiPoint[1] - a.loPoint[1]), a.loPoint[2] + f * (a.hiPoint[2] - a.loPoint[2])];
}

// ---------------------------------------------------------------------------
// One pair
// ---------------------------------------------------------------------------

interface PairContext {
  readonly moving: ClashPart;
  readonly fixed: ClashPart;
  readonly dir: Vec3;
  readonly distance: number;
  readonly eps: number;
}

function pair(ctx: PairContext, verdict: MoveVerdict, reason: PairVerification["reason"], evidence: PairVerification["evidence"]): PairVerification {
  return { staticPartId: ctx.fixed.partId, verdict, reason, evidence };
}

function sweptBoxGap(ctx: PairContext): number {
  const { moving, fixed, dir, distance } = ctx;
  let gap = Number.NEGATIVE_INFINITY;
  for (let j = 0; j < 3; j++) {
    const travel = distance * at(dir, j);
    const lo = at(moving.aabb.min, j) + Math.min(0, travel);
    const hi = at(moving.aabb.max, j) + Math.max(0, travel);
    gap = Math.max(gap, at(fixed.aabb.min, j) - hi, lo - at(fixed.aabb.max, j));
  }
  return gap;
}

const scratchMatrix = new Matrix4();

function translationMatrix(dir: Vec3, s: number): Matrix4 {
  return scratchMatrix.makeTranslation(s * dir[0], s * dir[1], s * dir[2]);
}

/** Smallest distance between the surfaces of A translated by `s·dir` and B. */
function surfaceDistance(ctx: PairContext, s: number): number {
  const target1: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const target2: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const hit = ctx.fixed.bvh.closestPointToGeometry(ctx.moving.bvh.geometry, translationMatrix(ctx.dir, s), target1, target2);
  if (hit === null) {
    throw new RangeError(`no closest point between ${ctx.moving.partId} and ${ctx.fixed.partId}`);
  }
  return hit.distance;
}

/** Classifies every shell of each Part against the other at the start. */
function startClass(ctx: PairContext): "disjoint" | "nested" | "ambiguous" {
  const none: Vec3 = [0, 0, 0];
  let result: "disjoint" | "nested" | "ambiguous" = "disjoint";
  const check = (from: ClashPart, against: ClashPart): void => {
    for (const vertex of solidOf(from).shellVertices) {
      const where = classify(against, vertexOf(from, vertex), none);
      if (where === "inside") {
        result = "nested";
      } else if (where === "ambiguous" && result === "disjoint") {
        result = "ambiguous";
      }
    }
  };
  check(ctx.moving, ctx.fixed);
  check(ctx.fixed, ctx.moving);
  return result;
}

/** Face normals of `part` whose triangles meet `box`, in traversal order, deduplicated. */
function nearbyNormals(part: ClashPart, box: Box3, sign: 1 | -1, out: Vec3[], seen: Set<string>): void {
  let taken = 0;
  part.bvh.shapecast({
    intersectsBounds: (bounds: Box3) => bounds.intersectsBox(box),
    intersectsTriangle: (triangle: ExtendedTriangle) => {
      const normal = triangleNormal(triangle);
      if (normal === null) {
        return false;
      }
      const m = scaled(normal, sign);
      const key = m.join(",");
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m);
        taken++;
      }
      return taken >= PLANE_NORMALS_PER_PART;
    },
  });
}

function projectionRange(part: ClashPart, m: Vec3): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const { positions } = part;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const value = m[0] * at(positions, i) + m[1] * at(positions, i + 1) + m[2] * at(positions, i + 2);
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  return [lo, hi];
}

/**
 * Q3: a plane that separates A over [contactAt, D] from B. The overlap of their projections on
 * the plane normal must be at most the float64 rounding bound of that computation. A positive
 * overlap larger than rounding, however small, is not accepted.
 */
function separatingPlane(ctx: PairContext, contactAt: number): { normal: Vec3; overlap: number } | null {
  const { moving, fixed, dir, distance, eps } = ctx;
  const candidates: Vec3[] = [];
  const seen = new Set<string>();
  const reach = 2 * eps;
  const movingBox = new Box3(
    new Vector3(moving.aabb.min[0] + contactAt * dir[0] - reach, moving.aabb.min[1] + contactAt * dir[1] - reach, moving.aabb.min[2] + contactAt * dir[2] - reach),
    new Vector3(moving.aabb.max[0] + contactAt * dir[0] + reach, moving.aabb.max[1] + contactAt * dir[1] + reach, moving.aabb.max[2] + contactAt * dir[2] + reach),
  );
  const fixedBoxInMovingFrame = new Box3(
    new Vector3(fixed.aabb.min[0] - contactAt * dir[0] - reach, fixed.aabb.min[1] - contactAt * dir[1] - reach, fixed.aabb.min[2] - contactAt * dir[2] - reach),
    new Vector3(fixed.aabb.max[0] - contactAt * dir[0] + reach, fixed.aabb.max[1] - contactAt * dir[1] + reach, fixed.aabb.max[2] - contactAt * dir[2] + reach),
  );
  nearbyNormals(fixed, movingBox, 1, candidates, seen);
  nearbyNormals(moving, fixedBoxInMovingFrame, -1, candidates, seen);
  for (const axis of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as Vec3[]) {
    const key = axis.join(",");
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(axis);
    }
  }
  const bound = PLANE_ROUNDING_FACTOR * (solidOf(moving).maxL1 + solidOf(fixed).maxL1 + distance + 1);
  for (const m of candidates) {
    const md = dot(m, dir);
    const [aLo, aHi] = projectionRange(moving, m);
    const [bLo, bHi] = projectionRange(fixed, m);
    const sweptHi = aHi + Math.max(contactAt * md, distance * md);
    const sweptLo = aLo + Math.min(contactAt * md, distance * md);
    const below = sweptHi - bLo;
    if (below <= bound) {
      return { normal: m, overlap: below };
    }
    const above = bHi - sweptLo;
    if (above <= bound) {
      return { normal: scaled(m, -1), overlap: above };
    }
  }
  return null;
}

/** Q4: a point more than epsilon inside both solids at some travel in [contactAt, D]. */
function penetrationWitness(ctx: PairContext, contactAt: number): { travel: number; point: Vec3; depth: number } | null {
  const { moving, fixed, dir, distance, eps } = ctx;
  const intervals = distance > contactAt ? WITNESS_POSE_INTERVALS : 0;
  const query = new Vector3();
  for (let k = 0; k <= intervals; k++) {
    const travel = intervals === 0 ? contactAt : contactAt + ((distance - contactAt) * k) / intervals;
    const offset = scaled(dir, travel);
    let found: { travel: number; point: Vec3; depth: number } | null = null;
    let visits = 0;
    let pairs = 0;
    fixed.bvh.bvhcast(moving.bvh, translationMatrix(dir, travel).clone(), {
      intersectsTriangles: (fixedTriangle: ExtendedTriangle, movingTriangle: ExtendedTriangle) => {
        visits++;
        const f = [fromVector(fixedTriangle.a), fromVector(fixedTriangle.b), fromVector(fixedTriangle.c)];
        const m = [fromVector(movingTriangle.a), fromVector(movingTriangle.b), fromVector(movingTriangle.c)];
        const q = intersectionMidpoint(m, f);
        if (q !== null) {
          pairs++;
          const nf = triangleNormal(fixedTriangle);
          const nm = triangleNormal(movingTriangle);
          const inward = nf === null || nm === null ? null : scaled([nf[0] + nm[0], nf[1] + nm[1], nf[2] + nm[2]], -1);
          const length = inward === null ? 0 : Math.hypot(inward[0], inward[1], inward[2]);
          if (inward !== null && length >= OPPOSING_NORMAL_LENGTH) {
            for (let j = 0; j < WITNESS_RADIUS_COUNT && found === null; j++) {
              const r = 2 * eps * 2 ** j;
              const w: Vec3 = [q[0] + (r * inward[0]) / length, q[1] + (r * inward[1]) / length, q[2] + (r * inward[2]) / length];
              const fixedHit = fixed.bvh.closestPointToPoint(query.set(w[0], w[1], w[2]));
              if (fixedHit === null || !(fixedHit.distance > eps)) {
                continue;
              }
              const movingHit = moving.bvh.closestPointToPoint(query.set(w[0] - offset[0], w[1] - offset[1], w[2] - offset[2]));
              if (movingHit === null || !(movingHit.distance > eps)) {
                continue;
              }
              if (classify(fixed, w, [0, 0, 0]) === "inside" && classify(moving, w, offset) === "inside") {
                found = { travel, point: w, depth: Math.min(fixedHit.distance, movingHit.distance) };
              }
            }
          }
        }
        return found !== null || pairs >= WITNESS_PAIRS_PER_POSE || visits >= WITNESS_VISITS_PER_POSE;
      },
    });
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function verifyPair(ctx: PairContext): PairVerification {
  const movingStatus = solidOf(ctx.moving).status;
  const fixedStatus = solidOf(ctx.fixed).status;
  if (movingStatus === "open_mesh" || fixedStatus === "open_mesh") {
    return pair(ctx, "unverified", "open_mesh", {});
  }
  if (movingStatus === "invalid_orientation" || fixedStatus === "invalid_orientation") {
    return pair(ctx, "unverified", "invalid_orientation", {});
  }

  const boxGap = sweptBoxGap(ctx);
  if (boxGap > ctx.eps) {
    return pair(ctx, "clear", "separated_boxes", { boxGap });
  }

  let s = 0;
  let delta = surfaceDistance(ctx, 0);
  let minDistance = delta;
  let iterations = 1;
  if (delta > 2 * ctx.eps) {
    const start = startClass(ctx);
    if (start === "nested") {
      return pair(ctx, "unverified", "nested_at_start", {});
    }
    if (start === "ambiguous") {
      return pair(ctx, "unverified", "initial_separation_unknown", {});
    }
  }
  // Q2: delta is 1-Lipschitz in s for a unit-speed translation, so delta >= eps on [s, s + delta - eps].
  while (delta > 2 * ctx.eps) {
    if (s >= ctx.distance) {
      return pair(ctx, "clear", "separation_distance", { minDistance, iterations });
    }
    if (iterations >= MAX_ADVANCE_ITERATIONS) {
      return pair(ctx, "unverified", "iteration_cap", { minDistance, iterations });
    }
    s = Math.min(ctx.distance, s + delta - ctx.eps);
    delta = surfaceDistance(ctx, s);
    minDistance = Math.min(minDistance, delta);
    iterations++;
  }

  const plane = separatingPlane(ctx, s);
  if (plane !== null) {
    return pair(ctx, "clear", "contact_plane", { contactAt: s, normal: plane.normal, overlap: plane.overlap });
  }
  const witness = penetrationWitness(ctx, s);
  if (witness !== null) {
    return pair(ctx, "blocked", "penetration_witness", witness);
  }
  return pair(ctx, "unverified", "contact_unresolved", { contactAt: s });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function resolveConfig(config: ResolvedSolverConfig | SolverConfig): ResolvedSolverConfig {
  const validation = validateConfig(config);
  if (!validation.ok) {
    throw new InvalidSolverConfigError(validation.error);
  }
  return validation.config;
}

function checkDirection(dir: readonly number[]): Vec3 {
  if (!Array.isArray(dir) || dir.length !== 3 || !dir.every((c) => typeof c === "number" && Number.isFinite(c))) {
    throw new InvalidDirectionError(dir);
  }
  const length = Math.hypot(at(dir, 0), at(dir, 1), at(dir, 2));
  if (!(Math.abs(length - 1) <= DIRECTION_TOLERANCE)) {
    throw new InvalidDirectionError(dir);
  }
  // `x + 0` turns `-0` into `+0`.
  return [at(dir, 0) + 0, at(dir, 1) + 0, at(dir, 2) + 0];
}

function checkDistance(distance: unknown): number {
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) {
    throw new InvalidMoveDistanceError(typeof distance === "number" ? distance : Number.NaN);
  }
  return distance;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Blocked if any verdict is blocked, otherwise unverified if any is unverified, otherwise clear. */
export function combineVerdicts(verdicts: readonly MoveVerdict[]): MoveVerdict {
  if (verdicts.includes("blocked")) {
    return "blocked";
  }
  return verdicts.includes("unverified") ? "unverified" : "clear";
}

function verifyValidated(moving: ClashPart, dir: Vec3, distance: number, statics: readonly ClashPart[], config: ResolvedSolverConfig): MoveVerification {
  const ordered = statics.slice().sort((a, b) => compareIds(a.partId, b.partId));
  const pairs = ordered.map((fixed) => verifyPair({ moving, fixed, dir, distance, eps: config.clearanceEpsilon }));
  const move: LinearMove = { partId: moving.partId, dir: [dir[0], dir[1], dir[2]], distance, presentPartIds: ordered.map((part) => part.partId) };
  return { move, verdict: combineVerdicts(pairs.map((entry) => entry.verdict)), pairs };
}

/**
 * Verifies the straight move of `moving` by `distance * dir` against every Part in `statics`,
 * which must be exactly the Parts present during the move. Nothing is cached between calls, and
 * the result carries the move it is about.
 *
 * @throws InvalidSolverConfigError, InvalidDirectionError (non-finite or not unit within 1e-6),
 *   InvalidMoveDistanceError (non-finite or negative), MovingPartInStaticSetError, or RangeError
 *   for a repeated static Part_ID. All are thrown before any geometry runs.
 */
export function verifyLinearMove(
  moving: ClashPart,
  dir: Vec3,
  distance: number,
  statics: readonly ClashPart[],
  config: ResolvedSolverConfig | SolverConfig,
): MoveVerification {
  const resolved = resolveConfig(config);
  const unitDir = checkDirection(dir);
  const travel = checkDistance(distance);
  const ids = new Set<string>();
  for (const part of statics) {
    if (part.partId === moving.partId) {
      throw new MovingPartInStaticSetError(moving.partId);
    }
    if (ids.has(part.partId)) {
      throw new RangeError(`static Part ${part.partId} appears twice`);
    }
    ids.add(part.partId);
  }
  return verifyValidated(moving, unitDir, travel, statics, resolved);
}

interface CheckedStep {
  step: TrajectoryStep;
  linear: { dir: Vec3; distance: number } | null;
}

/**
 * Verifies compiled steps in order against an Assembly. Every Part of `parts` starts present, and
 * a Part is removed only after its own step, so a Part without a step stays present to the end.
 * A `linear_slide` step is verified with its own `dir` and `distance`. Any other primitive is
 * Unverified (`unsupported_primitive`) and runs no geometry; it never counts as a blocker.
 *
 * @throws InvalidTrajectoryError for a repeated Part in `parts`, a step that names an unknown
 *   Part, a second step for the same Part, or a `linear_slide` step whose params are not
 *   `{ kind: "linear_slide", dir, distance }`; plus the errors of `verifyLinearMove` for its dir
 *   and distance. All are thrown before any geometry runs.
 */
export function verifyTrajectory(
  parts: readonly ClashPart[],
  steps: readonly TrajectoryStep[],
  config: ResolvedSolverConfig | SolverConfig,
): TrajectoryVerification {
  const resolved = resolveConfig(config);
  const byId = new Map<string, ClashPart>();
  for (const part of parts) {
    if (byId.has(part.partId)) {
      throw new InvalidTrajectoryError("duplicate_part", part.partId, "the Assembly lists this Part twice");
    }
    byId.set(part.partId, part);
  }
  const stepped = new Set<string>();
  const checked: CheckedStep[] = steps.map((step) => {
    if (!byId.has(step.partId)) {
      throw new InvalidTrajectoryError("unknown_part", step.partId, "the step names a Part that is not in the Assembly");
    }
    if (stepped.has(step.partId)) {
      throw new InvalidTrajectoryError("duplicate_step", step.partId, "the Part already has a step");
    }
    stepped.add(step.partId);
    if (step.primitive !== "linear_slide") {
      return { step, linear: null };
    }
    const params = step.params as { kind?: unknown; dir?: unknown; distance?: unknown };
    if (params.kind !== "linear_slide" || !Array.isArray(params.dir)) {
      throw new InvalidTrajectoryError("malformed_params", step.partId, "a linear_slide step needs { kind: 'linear_slide', dir, distance }");
    }
    return { step, linear: { dir: checkDirection(params.dir as number[]), distance: checkDistance(params.distance) } };
  });

  const present = new Set(byId.keys());
  const results: StepVerification[] = [];
  for (const { step, linear } of checked) {
    present.delete(step.partId);
    if (linear === null) {
      results.push({ partId: step.partId, primitive: step.primitive, verdict: "unverified", reason: "unsupported_primitive", move: null, blockerIds: [] });
      continue;
    }
    const moving = byId.get(step.partId) as ClashPart;
    const statics = [...present].map((id) => byId.get(id) as ClashPart);
    const move = verifyValidated(moving, linear.dir, linear.distance, statics, resolved);
    results.push({
      partId: step.partId,
      primitive: step.primitive,
      verdict: move.verdict,
      reason: null,
      move,
      blockerIds: move.pairs.filter((entry) => entry.verdict === "blocked").map((entry) => entry.staticPartId),
    });
  }
  return { verdict: combineVerdicts(results.map((entry) => entry.verdict)), steps: results };
}
