import type { ResolvedSolverConfig } from "../config";
import { createPrng, substreamSeed } from "../prng";
import { at } from "../stage0/arrayAccess";
import type { NormalizedPart } from "../types";
/**
 * The Sample_Rays' origins for one Part. `originX/Y/Z[i]` is the micro-shrunk origin of sample
 * `i`, and `sourceTri[i]` is the Part-local index of the triangle it was drawn from.
 */
export interface SampleSet {
  readonly count: number;
  readonly originX: Float64Array;
  readonly originY: Float64Array;
  readonly originZ: Float64Array;
  readonly sourceTri: Uint32Array;
}
const EMPTY_SAMPLES: SampleSet = Object.freeze({
  count: 0,
  originX: new Float64Array(0),
  originY: new Float64Array(0),
  originZ: new Float64Array(0),
  sourceTri: new Uint32Array(0),
});
/**
 * Stratified area-weighted surface sampler (Req 12.4, 7.4, 13.1, 13.9). This is the only module
 * in `src/` that imports `prng.ts`.
 *
 * - Eligible triangles have a Part-local index that is a multiple of `stride` (Req 7.4) and a
 *   positive area. Zero-area triangles are never selected, so they never cast a ray (Req 13.9).
 *   Cumulative areas are summed in double precision in index order. When no triangle is
 *   eligible, the Part has no samples and no random value is drawn.
 * - The Part has its own substream, `createPrng(substreamSeed(seed, partId))`, so its samples do
 *   not depend on how many other Parts exist (design D6).
 * - For stratum `i = 0..N-1`, three values `r0, r1, r2` are drawn in that order. The position
 *   in the cumulative area range is `x = (i + r0) * total / N`. The triangle is the first one
 *   whose cumulative area exceeds `x`, found by binary search, so a zero-width range is never
 *   chosen. A rounded `x` that reaches `total` falls back to the last triangle with a positive
 *   width. The point inside the triangle has barycentric coordinates
 *   `(1 - s, s(1 - r2), s r2)` with `s = sqrt(r1)`, which are uniform over the triangle.
 * - The ray origin is `point - microShrink * faceNormal`, so it lies inside a Watertight_Solid_Part
 *   (Req 13.1).
 *
 * @param stride `Sampling_Metadata.stride`, an integer of at least 1.
 */
export function buildSampleSet(part: NormalizedPart, stride: number, config: ResolvedSolverConfig): SampleSet {
  if (!Number.isInteger(stride) || stride < 1) {
    throw new RangeError(`sampling stride must be an integer >= 1; received ${String(stride)}`);
  }
  const strata = config.samplesPerPartPerDirection;
  const triangleCount = Math.floor(part.triangles.length / 3);
  const eligible: number[] = [];
  const cumulative: number[] = [];
  let total = 0;
  for (let t = 0; t < triangleCount; t += stride) {
    const area = at(part.triangleAreas, t);
    if (area > 0) {
      total += area;
      eligible.push(t);
      cumulative.push(total);
    }
  }
  if (eligible.length === 0) {
    return EMPTY_SAMPLES;
  }
  // Last entry whose cumulative range has a positive width, for the rounding fallback.
  let lastWide = eligible.length - 1;
  while (lastWide > 0 && at(cumulative, lastWide) <= at(cumulative, lastWide - 1)) {
    lastWide--;
  }
  const prng = createPrng(substreamSeed(config.seed, part.partId));
  const originX = new Float64Array(strata);
  const originY = new Float64Array(strata);
  const originZ = new Float64Array(strata);
  const sourceTri = new Uint32Array(strata);
  for (let i = 0; i < strata; i++) {
    const r0 = prng.nextFloat();
    const r1 = prng.nextFloat();
    const r2 = prng.nextFloat();
    const x = ((i + r0) * total) / strata;
    let lo = 0;
    let hi = eligible.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (at(cumulative, mid) > x) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    const slot = at(cumulative, lo) > x ? lo : lastWide;
    const triangle = at(eligible, slot);
    const s = Math.sqrt(r1);
    const b0 = 1 - s;
    const b1 = s * (1 - r2);
    const b2 = s * r2;
    const va = 3 * at(part.triangles, 3 * triangle);
    const vb = 3 * at(part.triangles, 3 * triangle + 1);
    const vc = 3 * at(part.triangles, 3 * triangle + 2);
    const nx = at(part.faceNormals, 3 * triangle);
    const ny = at(part.faceNormals, 3 * triangle + 1);
    const nz = at(part.faceNormals, 3 * triangle + 2);
    originX[i] = b0 * at(part.positions, va) + b1 * at(part.positions, vb) + b2 * at(part.positions, vc) - config.microShrink * nx;
    originY[i] =
      b0 * at(part.positions, va + 1) + b1 * at(part.positions, vb + 1) + b2 * at(part.positions, vc + 1) - config.microShrink * ny;
    originZ[i] =
      b0 * at(part.positions, va + 2) + b1 * at(part.positions, vb + 2) + b2 * at(part.positions, vc + 2) - config.microShrink * nz;
    sourceTri[i] = triangle;
  }
  return { count: strata, originX, originY, originZ, sourceTri };
}
