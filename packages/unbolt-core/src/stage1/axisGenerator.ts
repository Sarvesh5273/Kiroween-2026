import { Stage1FailureError } from "../errors";
import { jacobiEigen3 } from "../math/eigen3";
import { orthonormalBasis } from "../math/onb";
import { cross, dot, length, normalize, scale, sub } from "../math/vec3";
import { at } from "../stage0/arrayAccess";
import type { FrameAxisName, FrameDecision, FrameRule, Part, PartFrame, Vec3 } from "../types";

// ---------------------------------------------------------------------------
// Tolerances (design, Stage 1c)
// ---------------------------------------------------------------------------

/** Absolute length, in normalized units, at or below which a projection counts as zero (Req 9.5, 9.6). */
const GEOMETRIC_EPS = 1e-9;
/** Relative tolerance for eigenvalue ties, candidate sets and area ties (Req 9.5). */
const TIE_RELATIVE = 1e-9;
/** A comparison this close to equal is a tie that rounding cannot flip (1000× below the tolerance). */
const TIE_SAFE_RELATIVE = 1e-12;
/** Minimum relative margin of every decided comparison in a Frame_Unique_Part. */
const UNIQUE_RELATIVE = 1e-6;

const AXIS_NAMES: readonly FrameAxisName[] = ["PCA1", "PCA2", "PCA3"];

/**
 * Tracks the margin of every comparison the Intrinsic_Frame_Rule makes. A comparison with
 * relative difference `g` is safe when it is an exact tie (`g <= 1e-12`) or clearly ordered
 * (`g >= 1e-6`). Anything in between could flip under rounding, so the Part is not
 * Frame_Unique. `min` is the smallest ordered margin seen, capped at 1 when there is none.
 */
class MarginTracker {
  min = 1;
  unsafe = false;

  note(relativeDifference: number): void {
    if (relativeDifference <= TIE_SAFE_RELATIVE) {
      return;
    }
    if (relativeDifference < UNIQUE_RELATIVE) {
      this.unsafe = true;
    }
    if (relativeDifference < this.min) {
      this.min = relativeDifference;
    }
  }
}

/** An orthonormal set of vectors that spans a subspace of R³. */
type Basis = readonly Vec3[];

/**
 * Spanning set used only for a Part whose vertices all coincide. Its subspace is all of R³, so
 * projecting onto it returns the input and no world direction influences a result.
 */
const FULL_SPACE: Basis = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

interface FrameContext {
  part: Part;
  /** Other Parts in ascending Part_ID order, for fallback F2. */
  others: readonly Part[];
  centroid: Vec3;
  /** `v - centroid` for each weld-cluster representative, in cluster order. */
  rel: readonly Vec3[];
  /** Sum of the areas of the triangles that touch each weld cluster. */
  clusterArea: Float64Array;
  tracker: MarginTracker;
  decisions: FrameDecision[];
  ambiguous: boolean;
  farthestOverFullSpace: { computed: boolean; value: Vec3 | null };
}

/**
 * Computes the frame of one Part: PCA axes, signs, OBB and the record of which rule decided
 * each step (Req 9.3 to 9.9, 10.5, 10.7).
 *
 * `allParts` is every Part of the Assembly in normalized coordinates, including `part`. The
 * fallbacks F2 and F3 read the other Parts.
 *
 * The result depends only on the vertex positions and triangles of the Assembly. It never
 * depends on vertex index order for a decision, and it uses no fixed world direction except in
 * fallback F3 for an All_Collinear_Assembly (Req 9.7).
 *
 * Throws `Stage1FailureError { partId, component: 'Axis_Generator' }` when a result is not
 * finite or when F3 is reached outside an All_Collinear_Assembly. Other failures are rethrown
 * with the original error as `cause`.
 */
export function computePartFrame(part: Part, allParts: readonly Part[]): PartFrame {
  try {
    return computeFrame(part, allParts);
  } catch (error) {
    if (error instanceof Stage1FailureError) {
      throw error;
    }
    throw new Stage1FailureError(part.partId, "Axis_Generator", error);
  }
}

function computeFrame(part: Part, allParts: readonly Part[]): PartFrame {
  const others = allParts
    .filter((other) => other.partId !== part.partId)
    .sort((a, b) => (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0));

  // Vertex set: weld-cluster representatives, so indexed and duplicated-corner meshes agree.
  const points: Vec3[] = [];
  for (const representative of part.weldRepresentatives) {
    points.push(vertexAt(part, representative));
  }
  if (points.length === 0) {
    throw new RangeError("the Part has no vertices");
  }

  const centroid = meanOf(points);
  const rel = points.map((p) => sub(p, centroid));
  const rmax = maxOf(rel.map((r) => length(r)));
  const coincident = rmax <= GEOMETRIC_EPS;

  const ctx: FrameContext = {
    part,
    others,
    centroid,
    rel,
    clusterArea: computeClusterAreas(part, points.length),
    tracker: new MarginTracker(),
    decisions: [],
    ambiguous: false,
    farthestOverFullSpace: { computed: false, value: null },
  };

  // Eigen-decomposition of the covariance. A coincident Part has none: every eigenvalue is 0.
  let values: Vec3 = [0, 0, 0];
  let vectors: [Vec3, Vec3, Vec3] = [FULL_SPACE[0] ?? [1, 0, 0], FULL_SPACE[1] ?? [0, 1, 0], FULL_SPACE[2] ?? [0, 0, 1]];
  if (!coincident) {
    const eigen = jacobiEigen3(covarianceOf(rel));
    values = [Math.max(0, eigen.values[0]), Math.max(0, eigen.values[1]), Math.max(0, eigen.values[2])];
    vectors = eigen.vectors;
  }

  // Tie groups: every pair in a group differs by at most 1e-9 × λ1.
  const lambda1 = values[0];
  const tieTolerance = TIE_RELATIVE * lambda1;
  const groups: number[][] = [];
  for (let i = 0; i < 3; i++) {
    const current = groups[groups.length - 1];
    const first = current?.[0];
    if (current !== undefined && first !== undefined && at(values, first) - at(values, i) <= tieTolerance) {
      current.push(i);
    } else {
      groups.push([i]);
    }
  }
  for (let i = 0; i < 2; i++) {
    ctx.tracker.note(lambda1 > 0 ? (at(values, i) - at(values, i + 1)) / lambda1 : 0);
  }

  // Unsigned axes, in order. A tied group is resolved by the Intrinsic_Frame_Rule.
  const unsigned: Vec3[] = [];
  let f3Direction: Vec3 | null = null;
  for (const group of groups) {
    if (group.length === 1) {
      unsigned.push(at2(vectors, group[0] ?? 0));
      ctx.decisions.push({ axis: axisName(unsigned.length - 1), subject: "axis", rule: "eigen" });
      continue;
    }
    let basis: Basis = coincident ? FULL_SPACE : group.map((index) => at2(vectors, index));
    while (basis.length >= 2) {
      const resolved = resolveDirection(ctx, basis);
      if (resolved === null) {
        // F1 and F2 both failed. Only an All_Collinear_Assembly may continue, with F3.
        const [b0, b1] = basis;
        if (basis.length !== 2 || unsigned.length !== 1 || b0 === undefined || b1 === undefined) {
          throw new RangeError("the frame cannot be completed: fallbacks F1 and F2 found no direction");
        }
        f3Direction = normalize(cross(b0, b1));
        break;
      }
      unsigned.push(resolved.direction);
      ctx.decisions.push({ axis: axisName(unsigned.length - 1), subject: "axis", rule: resolved.rule });
      if (resolved.rule === "F1" || resolved.rule === "F2") {
        ctx.ambiguous = true;
      }
      basis = complementOf(basis, resolved.direction);
    }
    if (f3Direction !== null) {
      break;
    }
    const last = basis[0];
    if (last === undefined) {
      throw new RangeError("the tied subspace has no remaining axis");
    }
    unsigned.push(last);
  }

  // Signs of PCA1 and PCA2, then PCA3 = PCA1 × PCA2.
  const first = unsigned[0];
  if (first === undefined) {
    throw new RangeError("no first axis was resolved");
  }
  const a1 = scale(first, chooseSign(ctx, first, "PCA1"));
  let a2: Vec3;
  let a3: Vec3;
  if (f3Direction !== null) {
    ctx.ambiguous = true;
    assertAllCollinearAssembly([part, ...others], centroid, a1, part.partId);
    const [b1, b2] = completeFrameF3(a1);
    ctx.decisions.push({ axis: "PCA2", subject: "axis", rule: "F3" });
    ctx.decisions.push({ axis: "PCA3", subject: "axis", rule: "F3" });
    a2 = b1;
    a3 = b2;
  } else {
    const second = unsigned[1];
    if (second === undefined) {
      throw new RangeError("no second axis was resolved");
    }
    const signed2 = scale(second, chooseSign(ctx, second, "PCA2"));
    // Remove rounding drift so the pair is orthonormal to the last bit that matters.
    a2 = normalize(sub(signed2, scale(a1, dot(signed2, a1))));
    a3 = normalize(cross(a1, a2));
  }
  const axes: [Vec3, Vec3, Vec3] = [a1, a2, a3];

  // OBB from exact min and max projections of every Part vertex, with no padding.
  const lo: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const hi: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < part.positions.length / 3; i++) {
    const r = sub(vertexAt(part, i), centroid);
    for (let k = 0; k < 3; k++) {
      const projection = dot(r, at2(axes, k));
      lo[k] = Math.min(at(lo, k), projection);
      hi[k] = Math.max(at(hi, k), projection);
    }
  }
  const halfExtents: Vec3 = [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2];
  const middle: Vec3 = [(hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2];
  const center: Vec3 = [
    centroid[0] + middle[0] * a1[0] + middle[1] * a2[0] + middle[2] * a3[0],
    centroid[1] + middle[0] * a1[1] + middle[1] * a2[1] + middle[2] * a3[1],
    centroid[2] + middle[0] * a1[2] + middle[1] * a2[2] + middle[2] * a3[2],
  ];

  const everything = [...a1, ...a2, ...a3, ...center, ...halfExtents, ...centroid];
  if (!everything.every((component) => Number.isFinite(component))) {
    throw new Stage1FailureError(part.partId, "Axis_Generator", new RangeError("a frame component is not finite"));
  }

  return {
    axes,
    variances: values,
    centroid,
    obb: { center, halfExtents },
    frameUnique: !ctx.tracker.unsafe && !ctx.ambiguous,
    minRelativeMargin: ctx.tracker.min,
    decisions: ctx.decisions,
  };
}

// ---------------------------------------------------------------------------
// Direction resolution inside a tied subspace (Req 9.5)
// ---------------------------------------------------------------------------

interface ResolvedDirection {
  direction: Vec3;
  rule: Extract<FrameRule, "farthest" | "largest-face" | "F1" | "F2">;
}

/** Farthest vertex, then largest face, then fallback F1, then F2. `null` means all four failed. */
function resolveDirection(ctx: FrameContext, basis: Basis): ResolvedDirection | null {
  const farthest = farthestDirection(ctx, basis);
  if (farthest !== null) {
    return { direction: farthest, rule: "farthest" };
  }
  const face = largestFaceDirection(ctx, basis);
  if (face !== null) {
    return { direction: face, rule: "largest-face" };
  }
  return fallbackDirection(ctx, basis);
}

/**
 * Step 4.1. Candidates are the vertices whose distance from the centroid, measured inside the
 * subspace, is within `1e-9 × rmax` of the largest. Candidates are scored by the area of the
 * triangles that touch them, and those within `1e-9` (relative) of the best score are summed.
 * The sum does not depend on the order of the candidates, so vertex index order never decides.
 * Returns `null` when `rmax <= 1e-9` or `|sum| <= 1e-9 × rmax`.
 */
function farthestDirection(ctx: FrameContext, basis: Basis): Vec3 | null {
  const projected = ctx.rel.map((r) => projectOnto(basis, r));
  const radii = projected.map((p) => length(p));
  const rmax = maxOf(radii);
  if (!(rmax > GEOMETRIC_EPS)) {
    return null;
  }

  const candidates: number[] = [];
  for (let i = 0; i < radii.length; i++) {
    const shortfall = (rmax - at(radii, i)) / rmax;
    ctx.tracker.note(shortfall);
    if (shortfall <= TIE_RELATIVE) {
      candidates.push(i);
    }
  }

  let best = 0;
  for (const i of candidates) {
    best = Math.max(best, at(ctx.clusterArea, i));
  }
  const kept: number[] = [];
  for (const i of candidates) {
    const score = at(ctx.clusterArea, i);
    if (best - score <= TIE_RELATIVE * best) {
      kept.push(i);
    }
    ctx.tracker.note(best > 0 ? (best - score) / best : 0);
  }

  let sum: Vec3 = [0, 0, 0];
  for (const i of kept) {
    const p = at2(projected, i);
    sum = [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]];
  }
  const sumLength = length(sum);
  ctx.tracker.note(sumLength / rmax);
  if (sumLength <= TIE_RELATIVE * rmax) {
    return null;
  }
  return scale(sum, 1 / sumLength);
}

/**
 * Step 4.2. Sums the unit outward normals of every triangle whose area is within `1e-9`
 * (relative) of the largest, and projects the sum into the subspace. Returns `null` when no
 * triangle has positive area or the projection is at most `1e-9` long.
 */
function largestFaceDirection(ctx: FrameContext, basis: Basis): Vec3 | null {
  const { triangleAreas, faceNormals } = ctx.part;
  let largest = 0;
  for (const area of triangleAreas) {
    largest = Math.max(largest, area);
  }
  if (!(largest > 0)) {
    return null;
  }
  let sum: Vec3 = [0, 0, 0];
  for (let t = 0; t < triangleAreas.length; t++) {
    const area = at(triangleAreas, t);
    ctx.tracker.note((largest - area) / largest);
    if (largest - area <= TIE_RELATIVE * largest) {
      sum = [sum[0] + at(faceNormals, 3 * t), sum[1] + at(faceNormals, 3 * t + 1), sum[2] + at(faceNormals, 3 * t + 2)];
    }
  }
  const projected = projectOnto(basis, sum);
  const projectedLength = length(projected);
  ctx.tracker.note(projectedLength);
  if (projectedLength <= GEOMETRIC_EPS) {
    return null;
  }
  return scale(projected, 1 / projectedLength);
}

/**
 * Fallbacks F1 then F2: the first vector with a projection longer than `1e-9` inside the
 * subspace. F1 walks the Part's own vertices in triangle order. F2 walks the other Parts in
 * ascending Part_ID order, then in triangle order. Both are measured from this Part's centroid.
 */
function fallbackDirection(ctx: FrameContext, basis: Basis): ResolvedDirection | null {
  const own = firstVectorWhere(ctx, [ctx.part], (w) => length(projectOnto(basis, w)) > GEOMETRIC_EPS);
  if (own !== null) {
    return { direction: normalize(projectOnto(basis, own)), rule: "F1" };
  }
  const other = firstVectorWhere(ctx, ctx.others, (w) => length(projectOnto(basis, w)) > GEOMETRIC_EPS);
  if (other !== null) {
    return { direction: normalize(projectOnto(basis, other)), rule: "F2" };
  }
  return null;
}

/** First `vertex - centroid` in triangle order over `parts` that satisfies `accept`. */
function firstVectorWhere(ctx: FrameContext, parts: readonly Part[], accept: (w: Vec3) => boolean): Vec3 | null {
  for (const part of parts) {
    for (const corner of part.triangles) {
      const w = sub(vertexAt(part, corner), ctx.centroid);
      if (accept(w)) {
        return w;
      }
    }
  }
  return null;
}

/** The part of the subspace orthogonal to the unit vector `u`, which must lie in the subspace. */
function complementOf(basis: Basis, u: Vec3): Basis {
  if (basis.length === 2) {
    const [b0, b1] = basis;
    if (b0 === undefined || b1 === undefined) {
      throw new RangeError("a 2-dimensional basis needs 2 vectors");
    }
    const normal = normalize(cross(b0, b1));
    return [normalize(cross(normal, u))];
  }
  // Dimension 3: keep the basis vector with the largest component orthogonal to u.
  let best: Vec3 | null = null;
  let bestLength = -1;
  for (const b of basis) {
    const w = sub(b, scale(u, dot(b, u)));
    const wLength = length(w);
    if (wLength > bestLength) {
      best = w;
      bestLength = wLength;
    }
  }
  if (best === null) {
    throw new RangeError("the subspace has no basis vectors");
  }
  const b1 = normalize(best);
  return [b1, normalize(cross(u, b1))];
}

// ---------------------------------------------------------------------------
// Signs (Req 9.6)
// ---------------------------------------------------------------------------

/**
 * Sign of one axis: +1 or -1. Order: positive third central moment, then positive dot product
 * with the farthest-vertex direction over the full space, then the first F1 or F2 vector with a
 * dot product above `1e-9`. When even those fail, the eigen-solver sign is kept and the Part is
 * marked Frame_Ambiguous.
 */
function chooseSign(ctx: FrameContext, axis: Vec3, name: FrameAxisName): 1 | -1 {
  let m2 = 0;
  let m3 = 0;
  for (const r of ctx.rel) {
    const p = dot(r, axis);
    m2 += p * p;
    m3 += p * p * p;
  }
  m2 /= ctx.rel.length;
  m3 /= ctx.rel.length;
  const sigma = Math.sqrt(m2);
  // Below 1e-9 the spread is rounding noise, so the skew carries no information.
  if (sigma > GEOMETRIC_EPS) {
    const cubed = sigma * sigma * sigma;
    ctx.tracker.note(Math.abs(m3) / cubed);
    if (Math.abs(m3) > TIE_RELATIVE * cubed) {
      ctx.decisions.push({ axis: name, subject: "sign", rule: "skew" });
      return m3 > 0 ? 1 : -1;
    }
  }

  const u0 = farthestOverFullSpace(ctx);
  if (u0 !== null) {
    const d = dot(axis, u0);
    if (Math.abs(d) > GEOMETRIC_EPS) {
      ctx.tracker.note(Math.abs(d));
      ctx.decisions.push({ axis: name, subject: "sign", rule: "farthest-sign" });
      return d > 0 ? 1 : -1;
    }
  }

  ctx.ambiguous = true;
  const own = firstVectorWhere(ctx, [ctx.part], (w) => Math.abs(dot(axis, w)) > GEOMETRIC_EPS);
  if (own !== null) {
    ctx.decisions.push({ axis: name, subject: "sign", rule: "F1" });
    return dot(axis, own) > 0 ? 1 : -1;
  }
  const other = firstVectorWhere(ctx, ctx.others, (w) => Math.abs(dot(axis, w)) > GEOMETRIC_EPS);
  if (other !== null) {
    ctx.decisions.push({ axis: name, subject: "sign", rule: "F2" });
    return dot(axis, other) > 0 ? 1 : -1;
  }
  ctx.decisions.push({ axis: name, subject: "sign", rule: "eigen" });
  return 1;
}

function farthestOverFullSpace(ctx: FrameContext): Vec3 | null {
  if (!ctx.farthestOverFullSpace.computed) {
    ctx.farthestOverFullSpace = { computed: true, value: farthestDirection(ctx, FULL_SPACE) };
  }
  return ctx.farthestOverFullSpace.value;
}

// ---------------------------------------------------------------------------
// Fallback F3: the only place a world-frame component may matter (Req 9.7)
// ---------------------------------------------------------------------------

/**
 * Invariant check before F3: every vertex of every Part must lie within `1e-9` normalized units
 * of the line through `centroid` along `line`. Throws `Stage1FailureError` otherwise, so the F3
 * exemption can never reach an Assembly that is not an All_Collinear_Assembly (Req 9.5, 9.7).
 */
export function assertAllCollinearAssembly(
  parts: readonly Part[],
  centroid: Vec3,
  line: Vec3,
  partId: string,
): void {
  const direction = normalize(line);
  for (const part of parts) {
    for (let i = 0; i < part.positions.length / 3; i++) {
      const offset = sub(vertexAt(part, i), centroid);
      const perpendicular = length(sub(offset, scale(direction, dot(offset, direction))));
      if (perpendicular > GEOMETRIC_EPS) {
        throw new Stage1FailureError(
          partId,
          "Axis_Generator",
          new RangeError(
            `fallback F3 was reached, but Part ${part.partId} has a vertex ${perpendicular} from the common line`,
          ),
        );
      }
    }
  }
}

/**
 * Fallback F3: completes the frame from the line direction with the Duff et al. orthonormal
 * basis. The result depends on the world-space components of `line`. This is the only caller of
 * `math/onb.ts` inside `stage1/`, and it runs only after {@link assertAllCollinearAssembly}.
 * `onb` returns `(b1, b2)` with `b1 × b2 = line`, so `(line, b1, b2)` is right-handed.
 */
function completeFrameF3(line: Vec3): [Vec3, Vec3] {
  return orthonormalBasis(line);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function vertexAt(part: Part, index: number): Vec3 {
  return [at(part.positions, 3 * index), at(part.positions, 3 * index + 1), at(part.positions, 3 * index + 2)];
}

/** Indexed read of an array of tuples that throws instead of returning `undefined`. */
function at2<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new RangeError(`index ${index} is outside a list of length ${items.length}`);
  }
  return item;
}

/** Largest value, or `-Infinity` for an empty list. A loop, because spreading a long list overflows the stack. */
function maxOf(values: readonly number[]): number {
  let largest = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    largest = Math.max(largest, value);
  }
  return largest;
}

function axisName(index: number): FrameAxisName {
  const name = AXIS_NAMES[index];
  if (name === undefined) {
    throw new RangeError(`axis index ${index} is out of range`);
  }
  return name;
}

function projectOnto(basis: Basis, x: Vec3): Vec3 {
  if (basis === FULL_SPACE) {
    return x;
  }
  let result: Vec3 = [0, 0, 0];
  for (const b of basis) {
    const d = dot(x, b);
    result = [result[0] + d * b[0], result[1] + d * b[1], result[2] + d * b[2]];
  }
  return result;
}

/** Mean in two passes: the second pass adds the mean residual of the first. */
function meanOf(points: readonly Vec3[]): Vec3 {
  const n = points.length;
  let sum: Vec3 = [0, 0, 0];
  for (const p of points) {
    sum = [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]];
  }
  const first: Vec3 = [sum[0] / n, sum[1] / n, sum[2] / n];
  let residual: Vec3 = [0, 0, 0];
  for (const p of points) {
    residual = [residual[0] + (p[0] - first[0]), residual[1] + (p[1] - first[1]), residual[2] + (p[2] - first[2])];
  }
  return [first[0] + residual[0] / n, first[1] + residual[1] / n, first[2] + residual[2] / n];
}

/** Row-major covariance `mean(r rᵀ)` of vectors measured from their mean. */
function covarianceOf(rel: readonly Vec3[]): number[] {
  const n = rel.length;
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const r of rel) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        c[3 * i + j] = at(c, 3 * i + j) + at(r, i) * at(r, j);
      }
    }
  }
  return c.map((value) => value / n);
}

/** Per weld cluster, the summed area of the distinct triangles that touch it. */
function computeClusterAreas(part: Part, clusterCount: number): Float64Array {
  const areas = new Float64Array(clusterCount);
  for (let t = 0; t < part.triangleAreas.length; t++) {
    const area = at(part.triangleAreas, t);
    const ids = [0, 1, 2].map((k) => at(part.weldIds, at(part.triangles, 3 * t + k)));
    const distinct = ids.filter((id, k) => ids.indexOf(id) === k);
    for (const id of distinct) {
      areas[id] = at(areas, id) + area;
    }
  }
  return areas;
}
