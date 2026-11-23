import type { MoveVerification } from "@unboltkit/core";
import type {
  StraightMoveRequest,
  SolveFailure,
  SolveResult,
  SolveSource,
  StageName,
  WorkerOutMessage,
  WorkerRejection,
} from "../protocol";

/**
 * Main-thread wrapper around the Blitz_Worker.
 *
 * Each solve gets a fresh module Worker. A solve that is still pending when the next one starts is
 * terminated, so its result can never arrive (latest request wins). Messages whose `requestId` is not
 * the latest id are dropped as a second guard. This file imports no Core runtime code, so no BVH or
 * DBG code is bundled into the main thread.
 *
 * After a successful solve the worker stays alive with that solve's parts, so `checkMove` can ask it
 * to check one explicit straight move. Rejected and failed solves still release their worker. A new
 * solve or `dispose` terminates the worker, and any check still waiting is never answered.
 */

/** The part of `Worker` that the client uses. A real `Worker` satisfies it, and tests pass a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<WorkerOutMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
}

/** Creates the worker for one solve. The default builds the real module worker. */
export type WorkerFactory = () => WorkerLike;

export interface SolveHandlers {
  onProgress?: (requestId: number, stage: StageName, state: "started" | "completed") => void;
  onSolved: (requestId: number, result: SolveResult) => void;
  onRejected: (requestId: number, rejection: WorkerRejection) => void;
  /** Called for a `failure` message, a worker `error` event, and a failed worker start or post. */
  onFailure: (requestId: number, failure: SolveFailure) => void;
}

export interface CheckHandlers {
  onResult: (verification: MoveVerification, elapsedMs: number) => void;
  /** A `checkFailure` message, a worker error, or no worker to ask. */
  onFailure: (failure: SolveFailure) => void;
}

export interface SolverClient {
  /**
   * Asks the worker of the latest solve to check one straight move. Returns false, without calling
   * a handler, when there is no live worker for the latest solve.
   */
  checkMove(attemptId: number, move: StraightMoveRequest, handlers: CheckHandlers): boolean;
  /** Starts a solve and returns its `requestId`. Terminates a pending solve first. */
  solve(source: SolveSource, transfer: Transferable[], handlers: SolveHandlers): number;
  /** Terminates any pending worker. Later `solve` calls throw. */
  dispose(): void;
}

export function createBlitzWorker(): WorkerLike {
  return new Worker(new URL("../worker/blitz.worker.ts", import.meta.url), { type: "module" });
}

function failureFromThrown(thrown: unknown): SolveFailure {
  if (thrown instanceof Error) {
    return { name: thrown.name, code: null, message: thrown.message };
  }
  return { name: "NonErrorThrown", code: null, message: String(thrown) };
}

export function createSolverClient(makeWorker: WorkerFactory = createBlitzWorker): SolverClient {
  let latestId = 0;
  let worker: WorkerLike | null = null;
  let disposed = false;
  /** Checks waiting for the current worker, by attempt id. */
  let pendingChecks = new Map<number, CheckHandlers>();

  function terminateWorker(): void {
    if (worker !== null) {
      const stale = worker;
      worker = null;
      stale.onmessage = null;
      stale.onerror = null;
      stale.terminate();
    }
    pendingChecks = new Map();
  }

  return {
    solve(source, transfer, handlers) {
      if (disposed) {
        throw new Error("SolverClient is disposed.");
      }

      terminateWorker();
      latestId += 1;
      const requestId = latestId;

      /** Reports a failure that happened before the worker could answer, after the caller got its id. */
      const failLater = (thrown: unknown): void => {
        queueMicrotask(() => {
          if (requestId === latestId && !disposed) {
            handlers.onFailure(requestId, failureFromThrown(thrown));
          }
        });
      };

      let created: WorkerLike;
      try {
        created = makeWorker();
      } catch (thrown) {
        failLater(thrown);
        return requestId;
      }
      worker = created;

      /** A rejected or failed solve releases its worker. A solved one keeps it for move checks. */
      const finish = (): void => {
        if (worker === created) {
          terminateWorker();
        }
      };

      created.onmessage = (event: MessageEvent<WorkerOutMessage>): void => {
        const message = event.data;
        if (message.requestId !== latestId || worker !== created) {
          return;
        }
        switch (message.type) {
          case "progress":
            handlers.onProgress?.(requestId, message.stage, message.state);
            break;
          case "solved":
            handlers.onSolved(requestId, message.result);
            break;
          case "checkResult":
          case "checkFailure": {
            const check = pendingChecks.get(message.attemptId);
            if (check === undefined) return;
            pendingChecks.delete(message.attemptId);
            if (message.type === "checkResult") check.onResult(message.verification, message.elapsedMs);
            else check.onFailure(message.failure);
            break;
          }
          case "rejected":
            finish();
            handlers.onRejected(requestId, message.rejection);
            break;
          case "failure":
            finish();
            handlers.onFailure(requestId, message.failure);
            break;
        }
      };

      created.onerror = (event: ErrorEvent): void => {
        if (requestId !== latestId || worker !== created) {
          return;
        }
        const failure: SolveFailure = {
          name: "WorkerError",
          code: null,
          message: event.message || "The solver worker raised an unhandled error.",
        };
        const checks = [...pendingChecks.values()];
        finish();
        handlers.onFailure(requestId, failure);
        for (const check of checks) check.onFailure(failure);
      };

      try {
        created.postMessage({ type: "solve", requestId, source }, transfer);
      } catch (thrown) {
        // For example a DataCloneError. Stop this worker and report the failure for this request.
        finish();
        failLater(thrown);
      }
      return requestId;
    },

    checkMove(attemptId, move, handlers) {
      if (disposed || worker === null) return false;
      const current = worker;
      pendingChecks.set(attemptId, handlers);
      try {
        current.postMessage(
          {
            type: "check",
            requestId: latestId,
            attemptId,
            move: { partId: move.partId, dir: [move.dir[0], move.dir[1], move.dir[2]], distance: move.distance, staticPartIds: [...move.staticPartIds] },
          },
          [],
        );
      } catch (thrown) {
        pendingChecks.delete(attemptId);
        handlers.onFailure(failureFromThrown(thrown));
      }
      return true;
    },
    dispose() {
      disposed = true;
      terminateWorker();
    },
  };
}
