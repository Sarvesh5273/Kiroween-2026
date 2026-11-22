import { describe, expect, it } from "vitest";
import { createPrng, fnv1a32, substreamSeed } from "../../src/prng";
import { DEFAULT_SEED } from "../../src/config";

function take(seed: number, count: number): number[] {
  const prng = createPrng(seed);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(prng.nextUint32());
  }
  return values;
}

describe("createPrng", () => {
  it("gives the same sequence for two instances with the same seed", () => {
    expect(take(DEFAULT_SEED, 512)).toStrictEqual(take(DEFAULT_SEED, 512));
  });

  it("gives different sequences for different seeds", () => {
    expect(take(1, 16)).not.toStrictEqual(take(2, 16));
  });

  it("keeps nextFloat in [0, 1) and equal to nextUint32 / 2^32", () => {
    for (const seed of [0, 1, DEFAULT_SEED, 0xffffffff]) {
      const floats = createPrng(seed);
      const integers = createPrng(seed);
      for (let i = 0; i < 5000; i++) {
        const value = floats.nextFloat();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
        expect(value).toBe(integers.nextUint32() / 4294967296);
      }
    }
  });

  it("rejects a seed outside the uint32 range or not an integer", () => {
    expect(() => createPrng(-1)).toThrow(RangeError);
    expect(() => createPrng(1.5)).toThrow(RangeError);
    expect(() => createPrng(4294967296)).toThrow(RangeError);
  });
});

describe("substreamSeed", () => {
  const partIds = ["/#0", "/#1", "/0#0", "/0/3#1", "/0/3#10"];

  it("gives distinct seeds for distinct Part_IDs", () => {
    const seeds = partIds.map((id) => substreamSeed(DEFAULT_SEED, id));
    expect(new Set(seeds).size).toBe(partIds.length);
  });

  it("returns the same unsigned 32-bit seed for the same key", () => {
    for (const id of partIds) {
      const first = substreamSeed(DEFAULT_SEED, id);
      expect(first).toBe(substreamSeed(DEFAULT_SEED, id));
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("hashes UTF-16 code units with FNV-1a 32-bit", () => {
    // Known FNV-1a 32-bit vectors. The empty string gives the offset basis.
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
  });
});
