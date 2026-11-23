/**
 * The Blitz_Worker message handler as a plain function, so Vitest runs the same code in Node.
 *
 * A `solve` message runs the Core pipeline and keeps that solve's Stage 1 parts. A later `check`
 * message for the same solve runs Core's production `verifyLinearMove` on exactly the move it
 * names: that part, that direction, that distance, against those static parts. Nothing here picks
 * another axis or changes the static set.
 */
import { verifyLinearMove as coreVerifyLinearMove } from "@unboltkit/core";
import type { Stage1Result } from "@unboltkit/core";
import type { CheckMoveMessage, WorkerInMessage, WorkerOutMessage } from "../protocol";
import { toSolveFailure } from "./rejection";
import { runBlitzSolve } from "./runBlitzSolve";
import { collectTransferables } from "./transfer";

export type Post = (message: WorkerOutMessage, transfer?: Transferable[]) => void;

export interface WorkerHandlerDeps {
  verifyLinearMove: typeof coreVerifyLinearMove;
  now: () => number;
}

/** Thrown when a check does not describe a move on the current solve's parts. */
export class MoveCheckRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoveCheckRequestError";
  }
}

function runCheck(
  context: { requestId: number; stage1: Stage1Result } | null,
  message: CheckMoveMessage,
  deps: WorkerHandlerDeps,
): { verification: ReturnType<typeof coreVerifyLinearMove>; elapsedMs: number } {
  if (context === null || context.requestId !== message.requestId) {
    throw new MoveCheckRequestError(`No prepared parts for solve ${message.requestId}.`);
  }
  const byId = new Map(context.stage1.parts.map((part) => [part.partId, part]));
  const moving = byId.get(message.move.partId);
  if (moving === undefined) throw new MoveCheckRequestError(`Part ${message.move.partId} is not in this level.`);
  const statics = message.move.staticPartIds.map((partId) => {
    const part = byId.get(partId);
    if (part === undefined) throw new MoveCheckRequestError(`Static part ${partId} is not in this level.`);
    return part;
  });
  const started = deps.now();
  const verification = deps.verifyLinearMove(moving, message.move.dir, message.move.distance, statics, context.stage1.config);
  return { verification, elapsedMs: deps.now() - started };
}

/** Returns the `onmessage` body of the worker. Every answer goes through `post`. */
export function createWorkerHandler(post: Post, overrides: Partial<WorkerHandlerDeps> = {}): (message: WorkerInMessage) => void {
  const deps: WorkerHandlerDeps = {
    verifyLinearMove: overrides.verifyLinearMove ?? coreVerifyLinearMove,
    now: overrides.now ?? ((): number => performance.now()),
  };
  let context: { requestId: number; stage1: Stage1Result } | null = null;
  return (message) => {
    if (message.type === "check") {
      const { requestId, attemptId } = message;
      try {
        const { verification, elapsedMs } = runCheck(context, message, deps);
        post({ type: "checkResult", requestId, attemptId, verification, elapsedMs });
      } catch (thrown) {
        post({ type: "checkFailure", requestId, attemptId, failure: toSolveFailure(thrown) });
      }
      return;
    }
    const { requestId } = message;
    context = null;
    try {
      const outcome = runBlitzSolve(message, {
        onStage: (stage, state) => {
          post({ type: "progress", requestId, stage, state });
        },
        onStage1Ready: (stage1) => {
          context = { requestId, stage1 };
        },
      });
      if (outcome.kind === "rejected") {
        context = null;
        post({ type: "rejected", requestId, rejection: outcome.rejection });
        return;
      }
      post({ type: "solved", requestId, result: outcome.result }, collectTransferables(outcome.result));
    } catch (thrown) {
      context = null;
      post({ type: "failure", requestId, failure: toSolveFailure(thrown) });
    }
  };
}
