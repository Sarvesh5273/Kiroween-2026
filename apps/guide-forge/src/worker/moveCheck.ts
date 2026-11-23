/**
 * "Check this move" in the Solver_Worker: one straight move, checked on demand with Core's
 * production `verifyLinearMove` against the Parts the main thread says are present.
 *
 * The solve keeps its Stage 1 Parts in a {@link MoveCheckContext}, so a check reuses the Parts and
 * BVHs that the solve already built and never re-runs a stage. Nothing here reads the plan: a
 * deadlocked plan can still have one proposed move checked, and the move is checked exactly as
 * requested. The direction is never swapped for another axis and the static set is never changed.
 *
 * No DOM or worker global, so Vitest calls it in Node.
 */
import { verifyLinearMove as coreVerifyLinearMove, type Stage1Result, type Vec3 } from "@unboltkit/core";
import type { CheckMoveMessage, MoveCheckResult } from "../protocol";

/** The Stage 1 output of the solve that a check belongs to. */
export interface MoveCheckContext {
  requestId: number;
  stage1: Stage1Result;
}

export interface MoveCheckDeps {
  now: () => number;
  verifyLinearMove: typeof coreVerifyLinearMove;
}

export const DEFAULT_MOVE_CHECK_DEPS: MoveCheckDeps = {
  now: () => performance.now(),
  verifyLinearMove: coreVerifyLinearMove,
};

/** Thrown when a check request does not describe a move on the current solve's Parts. */
export class MoveCheckRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoveCheckRequestError";
  }
}

function isFiniteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

/**
 * Checks one move. The distance arrives in model units and is multiplied by the normalization
 * scale, because the Stage 1 Parts are normalized to `maxExtent = 1`.
 *
 * @throws MoveCheckRequestError when there is no solve, the request names another solve, an
 *   unknown or repeated Part, lists the moving Part as static, or has a non-finite direction or a
 *   distance that is not finite and greater than 0. Errors of `verifyLinearMove` propagate.
 */
export function runMoveCheck(
  context: MoveCheckContext | null,
  message: CheckMoveMessage,
  deps: Partial<MoveCheckDeps> = {},
): MoveCheckResult {
  const now = deps.now ?? DEFAULT_MOVE_CHECK_DEPS.now;
  const verify = deps.verifyLinearMove ?? DEFAULT_MOVE_CHECK_DEPS.verifyLinearMove;
  if (context === null || context.requestId !== message.requestId) {
    throw new MoveCheckRequestError(`No prepared Parts for solve ${message.requestId}. Open the model again and retry.`);
  }
  const { move } = message;
  if (!isFiniteVec3(move.dir)) {
    throw new MoveCheckRequestError("The move direction must be three finite numbers.");
  }
  if (typeof move.distance !== "number" || !Number.isFinite(move.distance) || move.distance <= 0) {
    throw new MoveCheckRequestError(`The travel distance must be a finite number greater than 0, received ${String(move.distance)}.`);
  }
  const byId = new Map(context.stage1.parts.map((part) => [part.partId, part]));
  const moving = byId.get(move.partId);
  if (moving === undefined) {
    throw new MoveCheckRequestError(`Part ${move.partId} is not in this model.`);
  }
  const seen = new Set<string>();
  const statics = move.staticPartIds.map((partId) => {
    const part = byId.get(partId);
    if (part === undefined) {
      throw new MoveCheckRequestError(`Present Part ${partId} is not in this model.`);
    }
    if (partId === move.partId) {
      throw new MoveCheckRequestError(`The moving Part ${partId} is also listed as present and fixed.`);
    }
    if (seen.has(partId)) {
      throw new MoveCheckRequestError(`Present Part ${partId} is listed twice.`);
    }
    seen.add(partId);
    return part;
  });
  const start = now();
  const verification = verify(moving, move.dir, move.distance * context.stage1.normalization.scale, statics, context.stage1.config);
  return { verification, elapsedMs: now() - start };
}
