/**
 * Seeded pseudo-random helpers for the Blitz test suite.
 * Every random input in a test must come from here, never from an unseeded source.
 */

/** A function returning a float in [0, 1). */
export type Rng = () => number;

/**
 * mulberry32: a small, fast 32-bit seeded PRNG.
 * The same seed always yields the same sequence.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle driven by `rng`. Returns a new array and leaves the
 * input untouched, so the result is reproducible for a given seed.
 */
export function shuffle<T>(rng: Rng, array: readonly T[]): T[] {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}
