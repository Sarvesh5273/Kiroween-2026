import { at } from "./arrayAccess";

/**
 * Union-Find over the integers `0..size-1`.
 *
 * Union by rank keeps the trees shallow, and path halving shortens them during `find`. Union by
 * rank alone would make the set's root depend on rank, so the set's smallest member is tracked
 * in a separate table. {@link UnionFind.representative} returns that smallest member, so the
 * representative is always the smallest index in the set (Req 5.5, design Stage 0b).
 */
export class UnionFind {
  private readonly parent: Uint32Array;
  private readonly rank: Uint8Array;
  private readonly smallest: Uint32Array;

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 0) {
      throw new RangeError(`UnionFind size must be a non-negative integer; received ${String(size)}`);
    }
    this.parent = new Uint32Array(size);
    this.rank = new Uint8Array(size);
    this.smallest = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
      this.smallest[i] = i;
    }
  }

  /** Internal root of the set containing `x`. Its identity can change with union by rank. */
  find(x: number): number {
    let node = x;
    for (;;) {
      const up = at(this.parent, node);
      if (up === node) {
        return node;
      }
      // Path halving: point this node at its grandparent, then continue from there.
      const grandparent = at(this.parent, up);
      this.parent[node] = grandparent;
      node = grandparent;
    }
  }

  /** Merges the sets of `a` and `b`. Returns `true` if they were separate. */
  union(a: number, b: number): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) {
      return false;
    }
    const rankA = at(this.rank, rootA);
    const rankB = at(this.rank, rootB);
    const minimum = Math.min(at(this.smallest, rootA), at(this.smallest, rootB));

    let newRoot = rootA;
    let child = rootB;
    if (rankA < rankB) {
      newRoot = rootB;
      child = rootA;
    } else if (rankA === rankB) {
      this.rank[rootA] = rankA + 1;
    }
    this.parent[child] = newRoot;
    this.smallest[newRoot] = minimum;
    return true;
  }

  /** Smallest index in the set containing `x`. */
  representative(x: number): number {
    return at(this.smallest, this.find(x));
  }
}
