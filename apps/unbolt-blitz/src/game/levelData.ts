/**
 * Converts a worker `SolveResult` into the engine's `EngineLevelInput`.
 *
 * Pure TypeScript: no DOM, React or Three.js import, and no runtime import from
 * `@unboltkit/core`. The engine edge set is `graph.edges` united with the edges
 * of the witness SCCs, deduplicated (design D4). Stage 3 verifies each move
 * exactly and may find blockers that never appear in `graph.edges`; they are
 * only visible through the witness of a deadlocked plan.
 */
import type { PartRenderData, SolveResult } from "../protocol";
import type { EngineEdge, EngineLevelInput, EnginePart } from "./blitzEngine";

function toEnginePart(part: PartRenderData): EnginePart {
  return {
    partId: part.partId,
    displayName: part.displayName,
    isFastener: part.isFastener,
    principalAxis: part.principalAxis,
    obb: part.obb,
    aabb: part.aabb,
    candidateAxes: part.candidateAxes,
  };
}

/** Collects `graph.edges` then witness edges, keeping the first occurrence of each (from, to, dirIndex). */
function mergeEdges(result: SolveResult): EngineEdge[] {
  const seen = new Set<string>();
  const merged: EngineEdge[] = [];
  const add = (from: string, to: string, dirIndex: number): void => {
    // Part ids are path strings and never contain a NUL character.
    const key = `${from}\u0000${to}\u0000${dirIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ from, to, dirIndex });
  };

  for (const edge of result.edges) add(edge.from, edge.to, edge.dirIndex);

  if (result.plan.status === "deadlocked") {
    for (const scc of result.plan.witness.sccs) {
      for (const edge of scc.edges) add(edge.from, edge.to, edge.dirIndex);
    }
  }
  return merged;
}

/** Part-id lists of the witness SCCs, or an empty list for a solved plan. */
function deadlockSccsOf(result: SolveResult): string[][] {
  if (result.plan.status !== "deadlocked") return [];
  return result.plan.witness.sccs.map((scc) => [...scc.partIds]);
}

/** Builds the engine level data for one solved level. */
export function toEngineLevelInput(result: SolveResult): EngineLevelInput {
  return {
    parts: result.parts.map(toEnginePart),
    edges: mergeEdges(result),
    deadlockSccs: deadlockSccsOf(result),
  };
}
