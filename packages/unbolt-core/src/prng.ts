/**
 * Seeded PRNG for the solver. It uses sfc32 (Chris Doty-Humphrey) for the stream, and
 * splitmix32 for seeding. Only `stage2/sampler.ts` may import this module.
 */

export interface Prng {
  /** Next value as an unsigned 32-bit integer. */
  nextUint32(): number;
  /** Next value in `[0, 1)`, equal to `nextUint32() / 2^32`. */
  nextFloat(): number;
}

const GOLDEN_GAMMA = 0x9e3779b9;
const TWO_POW_32 = 4294967296;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function assertUint32Seed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`PRNG seed must be an integer in [0, 4294967295]; received ${String(seed)}`);
  }
}

/**
 * One splitmix32 step. It adds the golden gamma to `state` and runs the 32-bit finalizer.
 * The result is an unsigned 32-bit integer. Any integer `state` is accepted.
 */
export function splitmix32(state: number): number {
  let z = (state + GOLDEN_GAMMA) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

/** FNV-1a 32-bit hash over UTF-16 code units. Returns an unsigned 32-bit integer. */
export function fnv1a32(key: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Creates a generator. The four sfc32 state words come from consecutive splitmix32 outputs
 * started at `seed`, so every seed gives a non-degenerate state.
 */
export function createPrng(seed: number): Prng {
  assertUint32Seed(seed);

  let splitState = seed;
  const nextSeedWord = (): number => {
    const word = splitmix32(splitState);
    splitState = (splitState + GOLDEN_GAMMA) >>> 0;
    return word;
  };
  let a = nextSeedWord() | 0;
  let b = nextSeedWord() | 0;
  let c = nextSeedWord() | 0;
  let d = nextSeedWord() | 0;

  const nextUint32 = (): number => {
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const result = (t + d) | 0;
    c = (c + result) | 0;
    return result >>> 0;
  };

  return {
    nextUint32,
    nextFloat: () => nextUint32() / TWO_POW_32,
  };
}

/**
 * Seed for a named substream, `splitmix32(seed ^ fnv1a32(key)) >>> 0`. Each Part uses
 * `key = Part_ID`, so a Part's samples do not depend on how many other Parts exist.
 */
export function substreamSeed(seed: number, key: string): number {
  assertUint32Seed(seed);
  return splitmix32(seed ^ fnv1a32(key)) >>> 0;
}
