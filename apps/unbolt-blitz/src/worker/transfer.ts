import type { SolveResult } from "../protocol";

/**
 * Every distinct `ArrayBuffer` behind the typed arrays of a solve result, each exactly once.
 * A repeated buffer in a transfer list throws `DataCloneError`.
 */
export function collectTransferables(result: SolveResult): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  for (const part of result.parts) {
    seen.add(part.positions.buffer as ArrayBuffer);
    seen.add(part.normals.buffer as ArrayBuffer);
    seen.add(part.indices.buffer as ArrayBuffer);
  }
  return [...seen];
}
