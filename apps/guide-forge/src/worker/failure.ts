/**
 * Shapes anything thrown inside the Solver_Worker into the plain `SolveFailure` the main thread
 * shows in a Recovery_Card (Requirement 5.12).
 */
import type { SolveFailure } from "../protocol";

/** Name given to a thrown value that is not an `Error`. */
export const NON_ERROR_THROWN_NAME = "NonErrorThrown";

/** Name used when an `Error` has an empty or non-string `name`. */
const FALLBACK_ERROR_NAME = "Error";

/** Text for a non-Error throw. Falls back to the object tag when `String` itself throws. */
function describeThrown(value: unknown): string {
  try {
    return String(value);
  } catch (conversionError) {
    // A null-prototype object or a hostile `toString` cannot be converted. Use the tag instead.
    const reason = conversionError instanceof Error ? conversionError.message : "unknown";
    return `${Object.prototype.toString.call(value)} (not convertible to text: ${reason})`;
  }
}

/** The string `code` of an Error, or `null`. Core errors (`UnboltCoreError`) always carry one. */
function codeOf(error: Error): string | null {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Core errors keep their `name` and `code`. Other Errors keep `name` and `message`, with `code`
 * `null` unless they carry a string `code` (the stage 4 compile failure does). A non-Error throw
 * becomes name `"NonErrorThrown"` with `String(value)` as the message.
 */
export function toSolveFailure(thrown: unknown): SolveFailure {
  if (thrown instanceof Error) {
    return {
      name: thrown.name !== "" ? thrown.name : FALLBACK_ERROR_NAME,
      code: codeOf(thrown),
      message: thrown.message,
    };
  }
  return { name: NON_ERROR_THROWN_NAME, code: null, message: describeThrown(thrown) };
}
