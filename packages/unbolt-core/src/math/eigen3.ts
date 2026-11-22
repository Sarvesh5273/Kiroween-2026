import type { Vec3 } from "../types";

/** Row-major 3×3 matrix as nine numbers. Only the symmetric part is used. */
export type Mat3Flat = readonly number[];

export interface Eigen3Result {
  /** Eigenvalues in descending order, `values[0] >= values[1] >= values[2]`. */
  values: Vec3;
  /** `vectors[i]` is the unit eigenvector for `values[i]`. Vectors are mutually orthogonal. */
  vectors: [Vec3, Vec3, Vec3];
}

/** Upper bound on Jacobi sweeps. The loop also stops early once the off-diagonal sum is below the floor. */
export const JACOBI_MAX_SWEEPS = 64;
const OFF_DIAGONAL_FLOOR = 1e-300;

type Matrix = number[][];

/**
 * Eigen-decomposition of a symmetric 3×3 matrix by the cyclic Jacobi method. The result is
 * deterministic: the same input always gives the same bits. The input is symmetrized as
 * `(m[i][j] + m[j][i]) / 2` first. Throws `RangeError` on a wrong length or a non-finite entry.
 */
export function jacobiEigen3(m: Mat3Flat): Eigen3Result {
  if (m.length !== 9) {
    throw new RangeError(`jacobiEigen3 expects 9 values; received ${m.length}`);
  }
  for (const entry of m) {
    if (!Number.isFinite(entry)) {
      throw new RangeError("jacobiEigen3 received a non-finite entry");
    }
  }

  let a: Matrix = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (m[3 * i + j]! + m[3 * j + i]!) / 2));
  let v: Matrix = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let sweep = 0; sweep < JACOBI_MAX_SWEEPS; sweep++) {
    const offDiagonal = Math.abs(a[0]![1]!) + Math.abs(a[0]![2]!) + Math.abs(a[1]![2]!);
    if (offDiagonal < OFF_DIAGONAL_FLOOR) {
      break;
    }
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const rotation = rotationFor(a, p, q);
      if (rotation === null) {
        continue;
      }
      a = multiply(transpose(rotation), multiply(a, rotation));
      v = multiply(v, rotation);
      a[p]![q] = 0;
      a[q]![p] = 0;
    }
  }

  const order = [0, 1, 2].sort((i, j) => {
    const diff = a[j]![j]! - a[i]![i]!;
    return diff !== 0 ? diff : i - j;
  });
  const values: Vec3 = [a[order[0]!]![order[0]!]!, a[order[1]!]![order[1]!]!, a[order[2]!]![order[2]!]!];
  const column = (k: number): Vec3 => [v[0]![k]!, v[1]![k]!, v[2]![k]!];
  return {
    values,
    vectors: [column(order[0]!), column(order[1]!), column(order[2]!)],
  };
}

/**
 * Jacobi rotation J that zeroes `a[p][q]`. J has `J[p][p] = J[q][q] = c`, `J[p][q] = s` and
 * `J[q][p] = -s`. Returns `null` when the entry is already zero.
 * With `theta = (a[q][q] - a[p][p]) / (2 a[p][q])`, `t = sign(theta) / (|theta| + sqrt(theta² + 1))`
 * (sign(0) = +1), `c = 1 / sqrt(t² + 1)` and `s = t c`.
 */
function rotationFor(a: Matrix, p: number, q: number): Matrix | null {
  const apq = a[p]![q]!;
  if (apq === 0) {
    return null;
  }
  const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
  const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
  const c = 1 / Math.sqrt(t * t + 1);
  const s = t * c;
  const j: Matrix = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  j[p]![p] = c;
  j[q]![q] = c;
  j[p]![q] = s;
  j[q]![p] = -s;
  return j;
}

function multiply(x: Matrix, y: Matrix): Matrix {
  return [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => x[i]![0]! * y[0]![j]! + x[i]![1]! * y[1]![j]! + x[i]![2]! * y[2]![j]!),
  );
}

function transpose(x: Matrix): Matrix {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => x[j]![i]!));
}
