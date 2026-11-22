import type { CoreError } from "@unboltkit/core";
import type { SolveFailure, WorkerRejection } from "../protocol";

/** Thrown when Core reports an error that only a bug in this app can cause (for example a bad config). */
export class UnexpectedSolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnexpectedSolveError";
  }
}

/** Thrown when Stage 4 cannot compile a plan that Stage 3 reported as solved. */
export class CompileFailureError extends Error {
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(`Stage 4 could not compile the solved plan (${kind}): ${message}`);
    this.name = "CompileFailureError";
    this.kind = kind;
  }
}

/**
 * Maps a Core error value to a recoverable rejection.
 *
 * - `MonolithicMeshError` always maps to `monolithic`, whatever the triangle count (there is no
 *   over-budget case here: an over-budget multi-part scene is solved, not rejected).
 * - `EmptyAssemblyError` and `InvalidGeometryError` map to `no-geometry`.
 * - `ConfigurationError` throws, because the app always passes the default config.
 */
export function mapCoreError(error: CoreError): WorkerRejection {
  switch (error.kind) {
    case "MonolithicMeshError":
      return { reason: "monolithic", totalTriangles: error.totalTriangles };
    case "EmptyAssemblyError":
    case "InvalidGeometryError":
      return { reason: "no-geometry", errorKind: error.kind, message: error.message };
    case "ConfigurationError":
      throw new UnexpectedSolveError(error.message);
  }
}

/** Plain-data copy of anything thrown. Keeps `name` and `code` of Core errors. */
export function toSolveFailure(thrown: unknown): SolveFailure {
  if (thrown instanceof Error) {
    const code = (thrown as { code?: unknown }).code;
    return {
      name: thrown.name,
      code: typeof code === "string" ? code : null,
      message: thrown.message,
    };
  }
  let message: string;
  try {
    message = typeof thrown === "string" ? thrown : JSON.stringify(thrown) ?? String(thrown);
  } catch {
    message = String(thrown);
  }
  return { name: "NonErrorThrown", code: null, message };
}
