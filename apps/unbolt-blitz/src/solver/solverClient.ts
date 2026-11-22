import type {
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

export interface SolverClient {
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

  function terminateWorker(): void {
    if (worker !== null) {
      const stale = worker;
      worker = null;
      stale.onmessage = null;
      stale.onerror = null;
      stale.terminate();
    }
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

      /** One worker serves one solve, so it is released as soon as that solve has ended. */
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
            finish();
            handlers.onSolved(requestId, message.result);
            break;
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
        finish();
        handlers.onFailure(requestId, {
          name: "WorkerError",
          code: null,
          message: event.message || "The solver worker raised an unhandled error.",
        });
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

    dispose() {
      disposed = true;
      terminateWorker();
    },
  };
}
