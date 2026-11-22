import { validateConfig, type SolverConfig } from "../config";
import type { ErrorResult, NormalizedPart, Stage0Result, Stage1Result } from "../types";
import { computePartFrame } from "./axisGenerator";
import { buildPartBvh } from "./bvhBuilder";
import { buildCandidateAxes } from "./candidateAxes";
import { normalizeParts } from "./normalizer";
import { computePartMetrics } from "./partMetrics";

/**
 * Stage 1: normalization, one BVH per Part, PCA/OBB frames, Candidate_Axes and metrics.
 *
 * - An incoming `ErrorResult` is returned unchanged, so chained stages equal the pipeline.
 * - The Solver_Config is validated here too, because this function can be called directly.
 *   A `ConfigurationError` is returned as a value.
 * - The Normalizer's `InvalidGeometryError` (`zero-extent`, `non-finite-scale`, `non-finite`) is
 *   returned as a value, before any BVH is built or any ray is cast.
 * - A BVH or frame failure throws `Stage1FailureError { partId, component }` (Req 9.11).
 *
 * Parts are emitted in ascending Part_ID order (UTF-16 code units), each with its exact float64
 * `aabb` in normalized coordinates.
 */
export function stage1Prepare(input: Stage0Result | ErrorResult, config?: SolverConfig): Stage1Result | ErrorResult {
  if (input.status === "error") {
    return input;
  }
  const validation = validateConfig(config);
  if (!validation.ok) {
    return { status: "error", error: validation.error, diagnostics: [] };
  }
  const resolved = validation.config;

  const normalized = normalizeParts(input.parts);
  if (!normalized.ok) {
    return { status: "error", error: normalized.error, diagnostics: input.diagnostics };
  }

  const bounded = normalized.parts.slice().sort((a, b) => (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0));
  const bvhs = bounded.map((part) => buildPartBvh(part));

  const parts: NormalizedPart[] = bounded.map((part, index) => {
    const bvh = bvhs[index];
    if (bvh === undefined) {
      throw new RangeError(`no BVH was built for Part ${part.partId}`);
    }
    const frame = computePartFrame(part, bounded);
    return {
      ...part,
      frame,
      candidateAxes: buildCandidateAxes(frame.axes),
      metrics: computePartMetrics(frame.obb.halfExtents, resolved),
      bvh,
    };
  });

  return {
    status: "ok",
    parts,
    normalization: normalized.normalization,
    sampling: input.sampling,
    diagnostics: input.diagnostics,
    config: resolved,
  };
}
