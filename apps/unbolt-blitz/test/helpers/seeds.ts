/**
 * One fixed seed per correctness property, keyed by the property number in
 * design.md. Use as `{ seed: SEEDS[n], numRuns: 100 }` for fast-check, or as
 * the argument to `mulberry32(SEEDS[n])`. Values are arbitrary but constant,
 * so any failure reproduces exactly.
 */
export type PropertyNumber =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18
  | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26;

export const SEEDS: Readonly<Record<PropertyNumber, number>> = {
  1: 0x1a2b3c01,
  2: 0x2b3c4d02,
  3: 0x3c4d5e03,
  4: 0x4d5e6f04,
  5: 0x5e6f7005,
  6: 0x6f708106,
  7: 0x70819207,
  8: 0x8192a308,
  9: 0x92a3b409,
  10: 0xa3b4c50a,
  11: 0xb4c5d60b,
  12: 0xc5d6e70c,
  13: 0xd6e7f80d,
  14: 0xe7f8090e,
  15: 0xf8091a0f,
  16: 0x091a2b10,
  17: 0x1a2b3c11,
  18: 0x2b3c4d12,
  19: 0x3c4d5e13,
  20: 0x4d5e6f14,
  21: 0x5e6f7015,
  22: 0x6f708116,
  23: 0x70819217,
  24: 0x8192a318,
  25: 0x92a3b419,
  26: 0xa3b4c51a,
};
