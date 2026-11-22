import type { Object3D } from "three";
import { validateConfig, type SolverConfig } from "../config";
import {
  buildEmptyAssemblyError,
  buildInvalidGeometryError,
  buildMonolithicMeshError,
  formatNodePath,
} from "../errors";
import type { ErrorResult, GeometryIssue, NodePath, SamplingMetadata, Stage0Result } from "../types";
import { parseScene } from "./sceneParser";
import { splitIslands } from "./islandSplitter";

/** Total-triangle budget above which the DBG_Builder samples with a stride (Req 7.2, 7.3). */
export const POLY_BUDGET = 150000;

/**
 * Sampling_Metadata for `totalTriangles`, the full unsampled count (Req 7.1 to 7.3). Parts are
 * never stride-reduced, so only the sampler uses `stride`.
 */
export function computeSamplingMetadata(totalTriangles: number): SamplingMetadata {
  const exceeded = totalTriangles > POLY_BUDGET;
  return {
    stride: exceeded ? Math.ceil(totalTriangles / POLY_BUDGET) : 1,
    polyBudgetExceeded: exceeded,
    totalTriangles,
    polyBudget: POLY_BUDGET,
  };
}

/**
 * Stage 0: parses `root` and splits it into Parts. Errors are returned as values, in this order
 * (Req 6.6):
 *
 * 1. Solver_Config validation. On failure, no geometry is read.
 * 2. `InvalidGeometryError`: `non-finite` if any non-finite finding exists, otherwise
 *    `malformed`. Every offending node path is listed in traversal order.
 * 3. `EmptyAssemblyError`: no triangles in any mesh node. Includes the diagnostics.
 * 4. `MonolithicMeshError`: exactly one Island.
 *
 * Otherwise the result holds the Parts in mesh order, then island order.
 */
export function stage0ParseScene(root: Object3D, config?: SolverConfig): Stage0Result | ErrorResult {
  const validation = validateConfig(config);
  if (!validation.ok) {
    return { status: "error", error: validation.error, diagnostics: [] };
  }

  const parsed = parseScene(root);
  if (parsed.invalid.length > 0) {
    const reason = parsed.invalid.some((issue) => issue.reason === "non-finite") ? "non-finite" : "malformed";
    return {
      status: "error",
      error: buildInvalidGeometryError(reason, uniqueNodePaths(parsed.invalid)),
      diagnostics: parsed.diagnostics,
    };
  }

  const totalTriangles = parsed.meshes.reduce((sum, mesh) => sum + mesh.triangles.length / 3, 0);
  if (totalTriangles === 0) {
    return {
      status: "error",
      error: buildEmptyAssemblyError(parsed.diagnostics),
      diagnostics: parsed.diagnostics,
    };
  }

  const parts = splitIslands(parsed.meshes, validation.config.weldTolerance);
  const [onlyPart] = parts;
  if (parts.length === 1 && onlyPart !== undefined) {
    return {
      status: "error",
      error: buildMonolithicMeshError(totalTriangles, onlyPart.sourceNodePath),
      diagnostics: parsed.diagnostics,
    };
  }

  return {
    status: "ok",
    parts,
    meshes: parsed.meshes,
    diagnostics: parsed.diagnostics,
    totalTriangles,
    sampling: computeSamplingMetadata(totalTriangles),
  };
}

/** Distinct node paths in first-seen (traversal) order. */
function uniqueNodePaths(issues: readonly GeometryIssue[]): NodePath[] {
  const seen = new Set<string>();
  const paths: NodePath[] = [];
  for (const issue of issues) {
    const key = formatNodePath(issue.nodePath);
    if (!seen.has(key)) {
      seen.add(key);
      paths.push(issue.nodePath);
    }
  }
  return paths;
}
