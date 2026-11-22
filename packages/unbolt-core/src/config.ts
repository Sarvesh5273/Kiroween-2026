import { buildConfigurationError, formatRejected } from "./errors";
import type { ConfigurationError, ConfigurationIssue } from "./types";

/** Default PRNG seed (0x5EED2027). The same in every run of the same package version (Req 3.7). */
export const DEFAULT_SEED = 0x5eed2027;

/**
 * Solver_Config. Each field is optional. A field that is omitted or `undefined` takes its
 * default from {@link DEFAULT_SOLVER_CONFIG}. Unknown keys are ignored.
 */
export interface SolverConfig {
  /**
   * Weld radius as a fraction of the Assembly world AABB diagonal. Must be finite and `>= 0`.
   * Default `1e-6`.
   */
  weldTolerance?: number | undefined;
  /**
   * Distance in normalized units that each ray origin moves inward from its surface point.
   * Must be finite and `>= 0`. Default `1e-4`.
   */
  microShrink?: number | undefined;
  /**
   * Normalized clearance used by the solver. Must be finite and `>= 0`, and strictly less than
   * `microShrink`. Default `5e-5`.
   */
  clearanceEpsilon?: number | undefined;
  /**
   * Dot-product threshold for hit classification. Must be finite and in `[0, 1)`. A hit is
   * rejected when `dot(n, dir) >= -tau`. Default `0.05`.
   */
  tau?: number | undefined;
  /** Stratified Sample_Rays per Part per direction. Integer in `[1, 4096]`. Default `48`. */
  samplesPerPartPerDirection?: number | undefined;
  /**
   * Relative symmetry tolerance for Fastener classification: `abs(e2 - e3) <= tol * max(e2, e3)`.
   * Finite and `>= 0`. Default `0.1`.
   */
  fastenerSymmetryTolerance?: number | undefined;
  /**
   * Minimum slenderness `e1 / ((e2 + e3) / 2)` for Fastener classification. Finite and `>= 1`.
   * Default `2.0`.
   */
  fastenerSlendernessThreshold?: number | undefined;
  /**
   * Angular tolerance in degrees for helical applicability. Finite, strictly greater than 0 and
   * strictly less than 90. Default `5`.
   */
  helicalAngularToleranceDeg?: number | undefined;
  /** Helical pitch in normalized units per revolution. Finite and `> 0`. Default `0.01`. */
  threadPitch?: number | undefined;
  /** PRNG seed. Integer in `[0, 4294967295]`. Default {@link DEFAULT_SEED}. */
  seed?: number | undefined;
}

/** Every field of a Solver_Config with its value filled in. */
export type ResolvedSolverConfig = { readonly [K in keyof SolverConfig]-?: number };

/** Fixed defaults. Clearance_Epsilon (`5e-5`) is below Micro_Shrink (`1e-4`). */
export const DEFAULT_SOLVER_CONFIG: ResolvedSolverConfig = Object.freeze({
  weldTolerance: 1e-6,
  microShrink: 1e-4,
  clearanceEpsilon: 5e-5,
  tau: 0.05,
  samplesPerPartPerDirection: 48,
  fastenerSymmetryTolerance: 0.1,
  fastenerSlendernessThreshold: 2.0,
  helicalAngularToleranceDeg: 5,
  threadPitch: 0.01,
  seed: DEFAULT_SEED,
});

const CONFIG_FIELDS = Object.keys(DEFAULT_SOLVER_CONFIG) as (keyof ResolvedSolverConfig)[];

export type ConfigValidation =
  | { ok: true; config: ResolvedSolverConfig }
  | { ok: false; error: ConfigurationError };

type NumericRule = (value: number) => boolean;

interface FieldRule {
  field: keyof ResolvedSolverConfig;
  accepts: NumericRule;
  requirement: string;
}

const isFiniteNonNegative: NumericRule = (value) => Number.isFinite(value) && value >= 0;

const FIELD_RULES: readonly FieldRule[] = [
  { field: "weldTolerance", accepts: isFiniteNonNegative, requirement: "a finite number >= 0" },
  { field: "microShrink", accepts: isFiniteNonNegative, requirement: "a finite number >= 0" },
  { field: "clearanceEpsilon", accepts: isFiniteNonNegative, requirement: "a finite number >= 0" },
  {
    field: "tau",
    accepts: (value) => Number.isFinite(value) && value >= 0 && value < 1,
    requirement: "a finite number in [0, 1)",
  },
  {
    field: "samplesPerPartPerDirection",
    accepts: (value) => Number.isInteger(value) && value >= 1 && value <= 4096,
    requirement: "an integer in [1, 4096]",
  },
  {
    field: "fastenerSymmetryTolerance",
    accepts: isFiniteNonNegative,
    requirement: "a finite number >= 0",
  },
  {
    field: "fastenerSlendernessThreshold",
    accepts: (value) => Number.isFinite(value) && value >= 1,
    requirement: "a finite number >= 1",
  },
  {
    field: "helicalAngularToleranceDeg",
    accepts: (value) => Number.isFinite(value) && value > 0 && value < 90,
    requirement: "a finite number in (0, 90)",
  },
  { field: "threadPitch", accepts: (value) => Number.isFinite(value) && value > 0, requirement: "a finite number > 0" },
  {
    field: "seed",
    accepts: (value) => Number.isInteger(value) && value >= 0 && value <= 4294967295,
    requirement: "an integer in [0, 4294967295]",
  },
];

/**
 * Checks a Solver_Config without throwing or mutating the input. `undefined` means all defaults.
 * Every violated rule is reported in one {@link ConfigurationError}, with issues sorted by field.
 */
export function validateConfig(input: unknown): ConfigValidation {
  if (input === undefined) {
    return { ok: true, config: DEFAULT_SOLVER_CONFIG };
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      error: buildConfigurationError([
        {
          fields: ["(config)"],
          rejected: [formatRejected(input)],
          message: `(config) must be an object or undefined; rejected ${formatRejected(input)}`,
        },
      ]),
    };
  }

  const source = input as Record<string, unknown>;
  const issues: ConfigurationIssue[] = [];
  const resolved: Record<string, number> = { ...DEFAULT_SOLVER_CONFIG };

  for (const rule of FIELD_RULES) {
    const raw = source[rule.field];
    if (raw === undefined) {
      continue;
    }
    if (typeof raw === "number" && rule.accepts(raw)) {
      resolved[rule.field] = raw;
      continue;
    }
    issues.push({
      fields: [rule.field],
      rejected: [formatRejected(raw)],
      message: `${rule.field} must be ${rule.requirement}; rejected ${formatRejected(raw)}`,
    });
  }

  // Req 2.6: only checked when both values already pass Req 2.5.
  const clearanceFieldFailed = issues.some((issue) => issue.fields[0] === "clearanceEpsilon");
  const microShrinkFieldFailed = issues.some((issue) => issue.fields[0] === "microShrink");
  if (!clearanceFieldFailed && !microShrinkFieldFailed) {
    const clearance = resolved.clearanceEpsilon ?? DEFAULT_SOLVER_CONFIG.clearanceEpsilon;
    const shrink = resolved.microShrink ?? DEFAULT_SOLVER_CONFIG.microShrink;
    if (clearance >= shrink) {
      issues.push({
        fields: ["clearanceEpsilon", "microShrink"],
        rejected: [formatRejected(clearance), formatRejected(shrink)],
        message: `clearanceEpsilon must be strictly less than microShrink; rejected clearanceEpsilon ${formatRejected(clearance)} and microShrink ${formatRejected(shrink)}`,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, error: buildConfigurationError(issues) };
  }
  return { ok: true, config: toResolved(resolved) };
}

/**
 * Overlays the defined fields of `input` on {@link DEFAULT_SOLVER_CONFIG}. Call it after
 * {@link validateConfig}. It does not validate, and it returns a new object.
 */
export function resolveConfig(input?: SolverConfig): ResolvedSolverConfig {
  const resolved: Record<string, number> = { ...DEFAULT_SOLVER_CONFIG };
  for (const field of CONFIG_FIELDS) {
    const value = input?.[field];
    if (value !== undefined) {
      resolved[field] = value;
    }
  }
  return toResolved(resolved);
}

function toResolved(values: Record<string, number>): ResolvedSolverConfig {
  const result: Record<string, number> = {};
  for (const field of CONFIG_FIELDS) {
    const value = values[field];
    if (value === undefined) {
      throw new Error(`resolved Solver_Config is missing ${field}`);
    }
    result[field] = value;
  }
  return result as unknown as ResolvedSolverConfig;
}
