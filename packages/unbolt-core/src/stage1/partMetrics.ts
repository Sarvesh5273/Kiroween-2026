import type { ResolvedSolverConfig } from "../config";
import type { Vec3 } from "../types";

export interface PartMetrics {
  /** Full OBB extents `2 × halfExtents`, sorted descending: `e1 >= e2 >= e3`. */
  extentsSorted: Vec3;
  /** `e1 / ((e2 + e3) / 2)`, or `+Infinity` when `e2 + e3 === 0` (Req 15.5). */
  slenderness: number;
  isFastener: boolean;
}

/**
 * Shared by Stage 3 (tie-break) and Stage 4 (helical applicability).
 *
 * `isFastener` is `abs(e2 - e3) <= tolSym × max(e2, e3) && slenderness >= tolSlender`. It uses
 * only the OBB half-extents and the two Fastener values of the config, with no per-kit or
 * per-name rule (Req 15.6, 19.4, 19.8).
 */
export function computePartMetrics(
  halfExtents: Vec3,
  config: Pick<ResolvedSolverConfig, "fastenerSymmetryTolerance" | "fastenerSlendernessThreshold">,
): PartMetrics {
  const sorted = [2 * halfExtents[0], 2 * halfExtents[1], 2 * halfExtents[2]].sort((a, b) => b - a);
  const e1 = sorted[0] ?? 0;
  const e2 = sorted[1] ?? 0;
  const e3 = sorted[2] ?? 0;
  const slenderness = e2 + e3 === 0 ? Number.POSITIVE_INFINITY : e1 / ((e2 + e3) / 2);
  const isFastener =
    Math.abs(e2 - e3) <= config.fastenerSymmetryTolerance * Math.max(e2, e3) &&
    slenderness >= config.fastenerSlendernessThreshold;
  return { extentsSorted: [e1, e2, e3], slenderness, isFastener };
}
