import { describe, expect, it } from "vitest";
import { createPrng } from "../../src/prng";
import { UnionFind } from "../../src/stage0/unionFind";

describe("UnionFind representative", () => {
  it("keeps the smallest member as representative when union by rank picks a larger root", () => {
    const uf = new UnionFind(10);
    expect(uf.union(5, 9)).toBe(true);
    // Root 5 now has rank 1. Attaching root 2 (rank 0) under root 5 keeps 5 as the root.
    expect(uf.union(9, 2)).toBe(true);

    expect(uf.find(2)).toBe(uf.find(9));
    expect(uf.representative(9)).toBe(2);
    expect(uf.representative(5)).toBe(2);
    expect(uf.representative(0)).toBe(0);
    expect(uf.union(2, 5)).toBe(false);
  });

  it("matches the smallest index of every component on seeded random unions", () => {
    const size = 64;
    const rng = createPrng(0x5eed2027);
    const uf = new UnionFind(size);
    // Reference: label every vertex with its component id, and relabel on each merge.
    const label = Array.from({ length: size }, (_, i) => i);

    for (let step = 0; step < 200; step++) {
      const a = Math.floor(rng.nextFloat() * size);
      const b = Math.floor(rng.nextFloat() * size);
      const labelA = label[a] ?? -1;
      const labelB = label[b] ?? -1;
      if (labelA !== labelB) {
        for (let i = 0; i < size; i++) {
          if (label[i] === labelB) {
            label[i] = labelA;
          }
        }
      }
      uf.union(a, b);
    }

    const smallest = new Map<number, number>();
    for (let i = 0; i < size; i++) {
      const component = label[i];
      if (component === undefined) {
        throw new Error(`label ${i} is missing`);
      }
      const current = smallest.get(component);
      if (current === undefined || i < current) {
        smallest.set(component, i);
      }
    }

    for (let x = 0; x < size; x++) {
      const component = label[x];
      const expected = component === undefined ? undefined : smallest.get(component);
      expect(uf.representative(x)).toBe(expected);
      for (let y = 0; y < size; y++) {
        expect(uf.find(x) === uf.find(y)).toBe(label[x] === label[y]);
      }
    }
  });
});
