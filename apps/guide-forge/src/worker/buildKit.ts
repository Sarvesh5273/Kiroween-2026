/**
 * Builds a bundled kit by name inside the Solver_Worker (Requirement 6.3). The lookup uses the
 * `SHOWCASE_KITS` and `DEADLOCK_CAGES` registries of `@unboltkit/sample-kits`, so the app never
 * keeps its own copy of the builders.
 */
import { DEADLOCK_CAGES, SHOWCASE_KITS, type KitEntry } from "@unboltkit/sample-kits";
import type { Group } from "three";

/** Code carried to the main thread through `toSolveFailure`. */
export const UNKNOWN_KIT_CODE = "UnknownKit";

/** Thrown for a kit name outside the five bundled names. The message names the rejected value. */
export class UnknownKitError extends Error {
  readonly code = UNKNOWN_KIT_CODE;
  /** The rejected value as text. */
  readonly rejected: string;

  constructor(rejected: unknown) {
    const text = formatRejectedKit(rejected);
    super(`Unknown kit name ${text}; expected one of ${kitNames().map((n) => JSON.stringify(n)).join(", ")}`);
    this.name = "UnknownKitError";
    this.rejected = text;
  }
}

function formatRejectedKit(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "object" && value !== null) {
    return "[object]";
  }
  if (typeof value === "symbol") {
    return "[symbol]";
  }
  if (typeof value === "function") {
    return "[function]";
  }
  return String(value);
}

function registry(): readonly KitEntry[] {
  return [...SHOWCASE_KITS, ...DEADLOCK_CAGES];
}

function kitNames(): string[] {
  return registry().map((entry) => entry.name);
}

/** Builds the kit with the given name, or throws {@link UnknownKitError}. */
export function buildKit(name: string): Group {
  // Compare by value over the registry list, so names such as "constructor" never match.
  const entry = registry().find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new UnknownKitError(name);
  }
  return entry.build();
}
