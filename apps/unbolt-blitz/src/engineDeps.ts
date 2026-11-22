/**
 * Composition-root factory for the engine's injected dependencies (design D2, D6).
 *
 * This is the only file that imports `DEFAULT_SOLVER_CONFIG` by value. The
 * context carries no override, so `helicalAngularToleranceDeg` is Core's own
 * default (5 degrees) and the engine classifies aligned fasteners exactly as
 * `@unboltkit/core` does.
 */
import { createDefaultPrimitiveRegistry, DEFAULT_SOLVER_CONFIG } from "@unboltkit/core";
import type { EngineDeps } from "./game/blitzEngine";

export function createEngineDeps(): EngineDeps {
  return {
    registry: createDefaultPrimitiveRegistry(),
    ctx: { config: DEFAULT_SOLVER_CONFIG },
  };
}
