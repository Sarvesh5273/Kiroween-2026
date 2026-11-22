import type { ManifestScc } from "./manifestTypes.js";

export interface EdgeGroup {
  fromName: string;
  toName: string;
  /** How many candidate directions `from` is blocked in by `to`. */
  directionCount: number;
  /** The first witnessed direction, as a sample. */
  sampleDir: [number, number, number];
}

/** Collapses the per-direction witness edges of an SCC into one entry per blocked pair. */
export function groupSccEdges(scc: ManifestScc): EdgeGroup[] {
  const groups = new Map<string, EdgeGroup>();
  for (const edge of scc.edges) {
    const key = `${edge.from}\u0000${edge.to}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { fromName: edge.fromName, toName: edge.toName, directionCount: 1, sampleDir: edge.dir });
    } else {
      existing.directionCount += 1;
    }
  }
  return [...groups.values()];
}
