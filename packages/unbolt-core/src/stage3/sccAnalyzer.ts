import { DeadlockWitnessInvariantError } from "../errors";
import type { BlockingEdge, DeadlockWitness, WitnessEdge } from "../types";
import { tarjanScc } from "./tarjan";

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The SCC_Analyzer (Req 16).
 *
 * The graph has one node per unremoved Part and an edge `A → B` whenever any Blocking_Edge
 * `(A, B, k)` exists, where `A` is the moving Part (`edge.from`) and `B` the blocker
 * (`edge.to`). Edges whose ends are not both unremoved, and self-edges, are ignored (Req 16.2).
 *
 * A witness SCC has at least 2 members and no edge from a member to an unremoved Part outside
 * the SCC (a sink SCC, Req 16.3). In a real deadlock every unremoved Part is blocked along
 * every axis, so every node has an outgoing edge and a sink SCC with at least 2 members always
 * exists. If none does, this function throws and never returns an empty witness.
 *
 * Output order (Req 16.3, 16.4, 16.5): members of each SCC in code-unit order, SCCs by their
 * smallest member, edges sorted by `(from, dirIndex, to)`, and `unassignedPartIds` ascending.
 *
 * @param unremovedPartIds Every unremoved Part_ID, in any order.
 * @param edges Blocking_Edges of the whole graph. Order does not matter.
 * @throws DeadlockWitnessInvariantError when no witness SCC exists (Req 16.7).
 */
export function buildDeadlockWitness(unremovedPartIds: readonly string[], edges: readonly BlockingEdge[]): DeadlockWitness {
  const ids = unremovedPartIds.slice().sort(compareCodeUnits);
  const indexOf = new Map<string, number>();
  ids.forEach((id, index) => indexOf.set(id, index));

  const internalEdges: BlockingEdge[] = [];
  const adjacency: number[][] = ids.map(() => []);
  for (const edge of edges) {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined || from === to) {
      continue;
    }
    internalEdges.push(edge);
    (adjacency[from] as number[]).push(to);
  }

  const components = tarjanScc(adjacency);
  const componentOf = new Int32Array(ids.length);
  components.forEach((members, componentIndex) => {
    for (const member of members) {
      componentOf[member] = componentIndex;
    }
  });
  const hasOutgoingEdgeOutside = new Uint8Array(components.length);
  for (let from = 0; from < adjacency.length; from++) {
    for (const to of adjacency[from] as number[]) {
      if (componentOf[from] !== componentOf[to]) {
        hasOutgoingEdgeOutside[componentOf[from] as number] = 1;
      }
    }
  }

  const witnessComponents = components
    .map((members, componentIndex) => ({ members, componentIndex }))
    .filter(({ members, componentIndex }) => members.length >= 2 && hasOutgoingEdgeOutside[componentIndex] === 0)
    // Members are ascending node numbers, which are ascending Part_IDs, so the first member is
    // the smallest.
    .sort((a, b) => (a.members[0] as number) - (b.members[0] as number));
  if (witnessComponents.length === 0) {
    throw new DeadlockWitnessInvariantError();
  }

  const assigned = new Uint8Array(ids.length);
  const sccs: DeadlockWitness["sccs"] = witnessComponents.map(({ members, componentIndex }) => {
    for (const member of members) {
      assigned[member] = 1;
    }
    const witnessEdges: WitnessEdge[] = internalEdges
      .filter((edge) => {
        const from = indexOf.get(edge.from) as number;
        const to = indexOf.get(edge.to) as number;
        return componentOf[from] === componentIndex && componentOf[to] === componentIndex;
      })
      .sort((a, b) => compareCodeUnits(a.from, b.from) || a.dirIndex - b.dirIndex || compareCodeUnits(a.to, b.to))
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        dirIndex: edge.dirIndex,
        dir: [edge.dir[0], edge.dir[1], edge.dir[2]],
        fromTriangles: edge.fromTriangles.slice(),
        toTriangles: edge.toTriangles.slice(),
      }));
    return { partIds: members.map((member) => ids[member] as string), edges: witnessEdges };
  });

  const unassignedPartIds = ids.filter((_, index) => assigned[index] === 0);
  return { sccs, unassignedPartIds };
}
