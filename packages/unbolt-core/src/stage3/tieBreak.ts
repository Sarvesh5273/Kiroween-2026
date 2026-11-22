import type { Vec3 } from "../types";

/** Cascade tolerance for Slenderness, Radial_Exposure and Escape_Distance (Req 15.3). */
export const CASCADE_TOLERANCE = 1e-9;

/** The tie-break key of one removable Part, computed against the Parts unremoved at the start of the iteration. */
export interface TieBreakKey {
  partId: string;
  /** (a) Fastener classification. Compared exactly. */
  isFastener: boolean;
  /** (b) Slenderness, descending. May be `+Infinity`, never `NaN`. */
  slenderness: number;
  /** (c) Radial_Exposure, descending. */
  radialExposure: number;
  /** (d) Escape_Distance along the direction Req 14.3 chooses, ascending. */
  escapeDistance: number;
}

/** Part_IDs that survive each cascade step, each in the order of the input candidates. */
export interface CascadeSteps {
  afterFastener: string[];
  afterSlenderness: string[];
  afterRadialExposure: string[];
  afterEscapeDistance: string[];
}

export interface CascadeResult {
  /** The single selected Part_ID, component (e). */
  partId: string;
  steps: CascadeSteps;
}

/** UTF-16 code-unit comparison. Never `localeCompare` (Req 15.2). */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Distance from `center` to `mean`, in normalized coordinates (Req 15.4). */
export function radialExposure(center: Vec3, mean: Vec3): number {
  return Math.hypot(center[0] - mean[0], center[1] - mean[1], center[2] - mean[2]);
}

/**
 * The per-component tolerance cascade of Req 15.1 and 15.3. Each step compares every candidate
 * with one best value taken from the candidates that remain at that step, so the cascade cannot
 * form comparison cycles. `best` is always attained by a candidate, so no step empties the set.
 *
 * 1. (a) Fasteners, exactly: if any candidate is a Fastener, only Fasteners stay.
 * 2. (b) Slenderness within `1e-9` of the maximum. If the maximum is `+Infinity`, exactly the
 *    `+Infinity` candidates stay, which avoids `Infinity - Infinity = NaN`.
 * 3. (c) Radial_Exposure within `1e-9` of the maximum.
 * 4. (d) Escape_Distance within `1e-9` of the minimum.
 * 5. (e) The smallest Part_ID by UTF-16 code units.
 *
 * @throws RangeError when `candidates` is empty, or a key component is `NaN`.
 */
export function selectByCascade(candidates: readonly TieBreakKey[]): CascadeResult {
  if (candidates.length === 0) {
    throw new RangeError("selectByCascade requires at least one candidate");
  }
  for (const candidate of candidates) {
    if (Number.isNaN(candidate.slenderness) || Number.isNaN(candidate.radialExposure) || Number.isNaN(candidate.escapeDistance)) {
      throw new RangeError(`tie-break key of Part ${candidate.partId} contains NaN`);
    }
  }
  let remaining = candidates.slice();

  if (remaining.some((candidate) => candidate.isFastener)) {
    remaining = remaining.filter((candidate) => candidate.isFastener);
  }
  const afterFastener = remaining.map((candidate) => candidate.partId);

  const bestSlenderness = remaining.reduce((best, candidate) => Math.max(best, candidate.slenderness), Number.NEGATIVE_INFINITY);
  remaining =
    bestSlenderness === Number.POSITIVE_INFINITY
      ? remaining.filter((candidate) => candidate.slenderness === Number.POSITIVE_INFINITY)
      : remaining.filter((candidate) => bestSlenderness - candidate.slenderness <= CASCADE_TOLERANCE);
  const afterSlenderness = remaining.map((candidate) => candidate.partId);

  const bestExposure = remaining.reduce((best, candidate) => Math.max(best, candidate.radialExposure), Number.NEGATIVE_INFINITY);
  remaining = remaining.filter((candidate) => bestExposure - candidate.radialExposure <= CASCADE_TOLERANCE);
  const afterRadialExposure = remaining.map((candidate) => candidate.partId);

  const bestEscape = remaining.reduce((best, candidate) => Math.min(best, candidate.escapeDistance), Number.POSITIVE_INFINITY);
  remaining = remaining.filter((candidate) => candidate.escapeDistance - bestEscape <= CASCADE_TOLERANCE);
  const afterEscapeDistance = remaining.map((candidate) => candidate.partId);

  let selected = remaining[0];
  for (const candidate of remaining) {
    if (selected === undefined || compareCodeUnits(candidate.partId, selected.partId) < 0) {
      selected = candidate;
    }
  }
  if (selected === undefined) {
    throw new RangeError("the tie-break cascade emptied the candidate set");
  }
  return {
    partId: selected.partId,
    steps: { afterFastener, afterSlenderness, afterRadialExposure, afterEscapeDistance },
  };
}
