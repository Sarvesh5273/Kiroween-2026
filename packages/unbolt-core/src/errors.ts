import type {
  ConfigurationError,
  ConfigurationIssue,
  Diagnostic,
  EmptyAssemblyError,
  InvalidGeometryError,
  MonolithicMeshError,
  NodePath,
  Vec3,
} from "./types";

// ---------------------------------------------------------------------------
// Deterministic value formatting
// ---------------------------------------------------------------------------

/**
 * Formats a rejected value as a deterministic string, so the error stays plain data and the
 * same input always gives the same message. Primitives use their JSON form, but `NaN`,
 * infinities and `-0` are spelled out. Objects and functions are not expanded.
 */
export function formatRejected(value: unknown): string {
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return "NaN";
    }
    if (value === Number.POSITIVE_INFINITY) {
      return "Infinity";
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return "-Infinity";
    }
    if (Object.is(value, -0)) {
      return "-0";
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "symbol") {
    return "[symbol]";
  }
  if (typeof value === "function") {
    return "[function]";
  }
  return "[object]";
}

/** Node path as a string, for example `/` for the root and `/0/3` for child 0, then child 3. */
export function formatNodePath(path: NodePath): string {
  return `/${path.join("/")}`;
}

/** A number that stays plain data: finite values pass through, others become their formatted text. */
export type PlainNumber = number | string;

export function plainNumber(value: number): PlainNumber {
  return Number.isFinite(value) ? value : formatRejected(value);
}

function plainVec3(value: Vec3 | readonly number[]): [PlainNumber, PlainNumber, PlainNumber] {
  return [plainNumber(value[0] ?? Number.NaN), plainNumber(value[1] ?? Number.NaN), plainNumber(value[2] ?? Number.NaN)];
}

// ---------------------------------------------------------------------------
// Thrown errors. These signal misuse of a stage function or a broken invariant (D9).
// ---------------------------------------------------------------------------

/** Base class for every error this package throws. `code` is stable and safe to forward. */
export class UnboltCoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
}

export class InvalidSampleCountError extends UnboltCoreError {
  /** Formatted rejected value. */
  readonly rejected: string;

  constructor(rejected: string) {
    super(
      "InvalidSampleCount",
      `samplesPerPartPerDirection must be an integer in [1, 4096]; rejected ${rejected}`,
    );
    this.rejected = rejected;
  }
}

export type Stage1Component = "BVH_Builder" | "Axis_Generator";

export class Stage1FailureError extends UnboltCoreError {
  readonly partId: string;
  readonly component: Stage1Component;

  constructor(partId: string, component: Stage1Component, cause?: unknown) {
    super("Stage1Failure", `${component} failed for Part ${partId}`, cause === undefined ? undefined : { cause });
    this.partId = partId;
    this.component = component;
  }
}

export class DeadlockWitnessInvariantError extends UnboltCoreError {
  constructor() {
    super(
      "DeadlockWitnessInvariant",
      "A deadlocked Blocking_Graph has no sink SCC with at least 2 members; this should be unreachable",
    );
  }
}

export class PrimitiveRangeError extends UnboltCoreError {
  /** The rejected `t`. Non-finite values are stored as their formatted text. */
  readonly t: PlainNumber;

  constructor(t: number) {
    super("PrimitiveRange", `Primitive parameter t must be finite and in [0, 1]; rejected ${formatRejected(t)}`);
    this.t = plainNumber(t);
  }
}

export class PrimitiveParamError extends UnboltCoreError {
  /** Name of the invalid parameter. */
  readonly param: string;

  constructor(param: string, detail: string) {
    super("PrimitiveParam", `Invalid primitive parameter ${param}: ${detail}`);
    this.param = param;
  }
}

export class InvalidDirectionError extends UnboltCoreError {
  readonly dir: [PlainNumber, PlainNumber, PlainNumber];

  constructor(dir: Vec3 | readonly number[]) {
    super(
      "InvalidDirection",
      `Direction must be finite with unit length within 1e-6; rejected [${dir.map((c) => formatRejected(c)).join(", ")}]`,
    );
    this.dir = plainVec3(dir);
  }
}

export class MovingPartInStaticSetError extends UnboltCoreError {
  readonly partId: string;

  constructor(partId: string) {
    super("MovingPartInStaticSet", `The moving Part ${partId} also appears in the static set`);
    this.partId = partId;
  }
}

/** A straight move whose distance is not a finite number of at least 0. */
export class InvalidMoveDistanceError extends UnboltCoreError {
  readonly distance: PlainNumber;

  constructor(distance: number) {
    super("InvalidMoveDistance", `Move distance must be finite and at least 0; rejected ${formatRejected(distance)}`);
    this.distance = plainNumber(distance);
  }
}

/** A trajectory that names an unknown Part, repeats a Part, or has malformed straight-move params. */
export class InvalidTrajectoryError extends UnboltCoreError {
  readonly reason: "unknown_part" | "duplicate_step" | "duplicate_part" | "malformed_params";
  readonly partId: string;

  constructor(reason: InvalidTrajectoryError["reason"], partId: string, detail: string) {
    super("InvalidTrajectory", `Trajectory ${reason.replace("_", " ")} for Part ${partId}: ${detail}`);
    this.reason = reason;
    this.partId = partId;
  }
}

export class AssemblyNotNormalizedError extends UnboltCoreError {
  readonly measuredMaxExtent: PlainNumber;

  constructor(measuredMaxExtent: number) {
    super(
      "AssemblyNotNormalized",
      `The Assembly must be normalized to maxExtent 1.0 before the naive baseline runs; measured ${formatRejected(measuredMaxExtent)}`,
    );
    this.measuredMaxExtent = plainNumber(measuredMaxExtent);
  }
}

export class InvalidSolverConfigError extends UnboltCoreError {
  readonly configurationError: ConfigurationError;

  constructor(configurationError: ConfigurationError) {
    super("InvalidSolverConfig", configurationError.message);
    this.configurationError = configurationError;
  }
}

// ---------------------------------------------------------------------------
// Builders for returned error values (plain data)
// ---------------------------------------------------------------------------

function compareIssues(a: ConfigurationIssue, b: ConfigurationIssue): number {
  const keyA = a.fields.join(",");
  const keyB = b.fields.join(",");
  if (keyA < keyB) {
    return -1;
  }
  return keyA > keyB ? 1 : 0;
}

/** Collects every violated field into one error, sorted by field name. */
export function buildConfigurationError(issues: readonly ConfigurationIssue[]): ConfigurationError {
  if (issues.length === 0) {
    throw new RangeError("buildConfigurationError requires at least one issue");
  }
  const sorted = issues.map((issue) => ({ ...issue, fields: [...issue.fields], rejected: [...issue.rejected] }));
  sorted.sort(compareIssues);
  return {
    kind: "ConfigurationError",
    message: `Invalid Solver_Config: ${sorted.map((issue) => issue.message).join("; ")}`,
    issues: sorted,
  };
}

export function buildInvalidGeometryError(
  reason: InvalidGeometryError["reason"],
  nodePaths: readonly NodePath[],
): InvalidGeometryError {
  const paths = nodePaths.map((path) => formatNodePath(path));
  let message: string;
  switch (reason) {
    case "malformed":
      message = `Malformed mesh geometry at ${paths.join(", ")}`;
      break;
    case "non-finite":
      message = `Non-finite position or normal at ${paths.join(", ")}`;
      break;
    case "zero-extent":
      message = "The Assembly has zero maximum extent and cannot be normalized";
      break;
    case "non-finite-scale":
      message = "The normalization scale is not finite and positive";
      break;
  }
  return {
    kind: "InvalidGeometryError",
    message,
    reason,
    nodePaths: nodePaths.map((path) => path.slice()),
  };
}

export function buildEmptyAssemblyError(diagnostics: readonly Diagnostic[]): EmptyAssemblyError {
  return {
    kind: "EmptyAssemblyError",
    message: "The hierarchy contains no triangles in any mesh node",
    diagnostics: diagnostics.map((diagnostic) => ({ ...diagnostic, nodePath: diagnostic.nodePath.slice() })),
  };
}

export function buildMonolithicMeshError(totalTriangles: number, nodePath: NodePath): MonolithicMeshError {
  return {
    kind: "MonolithicMeshError",
    message: `The Assembly is one connected island of ${totalTriangles} triangles at ${formatNodePath(nodePath)}; there is nothing to disassemble`,
    totalTriangles,
    nodePath: nodePath.slice(),
  };
}
