/**
 * Tarjan's strongly connected components algorithm (Tarjan 1972), written without recursion so
 * a deep graph cannot overflow the call stack (Req 16.2).
 *
 * Nodes are the integers `0 .. adjacency.length - 1`. The caller numbers them in ascending
 * Part_ID order, so visiting nodes and neighbors in ascending numeric order is visiting them in
 * ascending Part_ID order. The visit order is fixed and does not depend on the order in which
 * the neighbors were listed or on any `Map` or `Set`.
 *
 * Self-loops and repeated neighbors are harmless.
 *
 * @param adjacency `adjacency[v]` lists the nodes `w` with an edge `v → w`.
 * @returns The components in the order Tarjan completes them (a component appears after every
 *   component it can reach). Each component lists its nodes in ascending order.
 * @throws RangeError when a neighbor is not an integer node number.
 */
export function tarjanScc(adjacency: ReadonlyArray<ReadonlyArray<number>>): number[][] {
  const nodeCount = adjacency.length;
  const neighbors: number[][] = adjacency.map((list, v) => {
    for (const w of list) {
      if (!Number.isInteger(w) || w < 0 || w >= nodeCount) {
        throw new RangeError(`node ${v} has the invalid neighbor ${w}; nodes are 0 to ${nodeCount - 1}`);
      }
    }
    return list.slice().sort((a, b) => a - b);
  });

  const order = new Int32Array(nodeCount).fill(-1);
  const low = new Int32Array(nodeCount);
  const onStack = new Uint8Array(nodeCount);
  const componentStack: number[] = [];
  // Explicit call stack: the node of each frame and the position of its next neighbor.
  const frameNode: number[] = [];
  const frameNext: number[] = [];
  const components: number[][] = [];
  let counter = 0;

  for (let root = 0; root < nodeCount; root++) {
    if ((order[root] as number) !== -1) {
      continue;
    }
    order[root] = counter;
    low[root] = counter;
    counter++;
    componentStack.push(root);
    onStack[root] = 1;
    frameNode.push(root);
    frameNext.push(0);

    while (frameNode.length > 0) {
      const top = frameNode.length - 1;
      const v = frameNode[top] as number;
      const list = neighbors[v] as number[];
      const position = frameNext[top] as number;
      if (position < list.length) {
        frameNext[top] = position + 1;
        const w = list[position] as number;
        if ((order[w] as number) === -1) {
          order[w] = counter;
          low[w] = counter;
          counter++;
          componentStack.push(w);
          onStack[w] = 1;
          frameNode.push(w);
          frameNext.push(0);
        } else if (onStack[w] === 1) {
          low[v] = Math.min(low[v] as number, order[w] as number);
        }
        continue;
      }
      frameNode.pop();
      frameNext.pop();
      if (low[v] === order[v]) {
        const component: number[] = [];
        for (;;) {
          const w = componentStack.pop();
          if (w === undefined) {
            throw new Error("Tarjan component stack underflow");
          }
          onStack[w] = 0;
          component.push(w);
          if (w === v) {
            break;
          }
        }
        component.sort((a, b) => a - b);
        components.push(component);
      }
      const parent = frameNode[frameNode.length - 1];
      if (parent !== undefined) {
        low[parent] = Math.min(low[parent] as number, low[v] as number);
      }
    }
  }
  return components;
}
