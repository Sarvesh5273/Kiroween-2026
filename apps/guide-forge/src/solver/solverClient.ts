/**
 * SolverClient: owns the Solver_Worker lifecycle on the Main_Thread.
 *
 * This is the only module that constructs a `Worker`. It keeps a monotonic request id, terminates the
 * previous worker when a new solve starts, drops messages that carry a stale request id, and turns
 * worker-level errors into `solve/failed` actions. It uses no random numbers.
 */
import type { SolveFailure, SolveLabel, SolveSource, WorkerOutMessage } from "../protocol";
import type { AppAction } from "../state/types";

export interface SolverClient {
  /** Terminates any running worker, starts a new one, posts the request. Returns the new request id. */
  solve(source: SolveSource, label: SolveLabel, transfer?: Transferable[]): number;
  /** Terminates the running worker. Later calls to `solve` throw. */
  dispose(): void;
}

function defaultMakeWorker(): Worker {
  return new Worker(new URL("../worker/solver.worker.ts", import.meta.url), { type: "module" });
}

/** Builds a failure from a thrown value. Errors keep their name and message. */
function failureFromThrown(thrown: unknown): SolveFailure {
  if (thrown instanceof Error) {
    return { name: thrown.name, code: null, message: thrown.message };
  }
  return { name: "NonErrorThrown", code: null, message: String(thrown) };
}

export function createSolverClient(
  dispatch: (action: AppAction) => void,
  makeWorker: () => Worker = defaultMakeWorker,
): SolverClient {
  let counter = 0;
  let currentId: number | null = null;
  let currentWorker: Worker | null = null;
  let disposed = false;

  function terminateCurrent(): void {
    if (currentWorker !== null) {
      currentWorker.terminate();
      currentWorker = null;
    }
  }

  function attach(worker: Worker, requestId: number): void {
    // A handler acts only while its own worker is the current one and its id is the current id.
    const isCurrent = (): boolean => currentWorker === worker && currentId === requestId;

    worker.onmessage = (event: MessageEvent<WorkerOutMessage>): void => {
      const message = event.data;
      if (!isCurrent() || message.requestId !== requestId) return;
      switch (message.type) {
        case "progress":
          dispatch({ type: "solve/progress", requestId, event: message.event });
          break;
        case "result":
          dispatch({ type: "solve/succeeded", requestId, result: message.result });
          break;
        case "failure":
          dispatch({ type: "solve/failed", requestId, failure: message.failure });
          break;
      }
    };

    worker.onerror = (event: ErrorEvent): void => {
      if (!isCurrent()) return;
      const location = event.filename ? ` (${event.filename}:${event.lineno})` : "";
      const text = event.message ? event.message : "The solver worker raised an unhandled error.";
      dispatch({
        type: "solve/failed",
        requestId,
        failure: { name: "WorkerError", code: null, message: `${text}${location}` },
      });
    };

    worker.onmessageerror = (): void => {
      if (!isCurrent()) return;
      dispatch({
        type: "solve/failed",
        requestId,
        failure: {
          name: "WorkerMessageError",
          code: null,
          message: "The solver worker sent a message that could not be deserialized.",
        },
      });
    };
  }

  return {
    solve(source, label, transfer) {
      if (disposed) {
        throw new Error("SolverClient is disposed.");
      }
      terminateCurrent();
      counter += 1;
      const requestId = counter;
      currentId = requestId;

      dispatch({ type: "solve/started", requestId, label });

      let worker: Worker;
      try {
        worker = makeWorker();
      } catch (thrown) {
        dispatch({ type: "solve/failed", requestId, failure: failureFromThrown(thrown) });
        return requestId;
      }
      currentWorker = worker;
      attach(worker, requestId);

      try {
        worker.postMessage({ type: "solve", requestId, source }, transfer ?? []);
      } catch (thrown) {
        // For example a DataCloneError. Stop the worker and report the failure for this request.
        terminateCurrent();
        dispatch({ type: "solve/failed", requestId, failure: failureFromThrown(thrown) });
      }
      return requestId;
    },

    dispose() {
      disposed = true;
      currentId = null;
      terminateCurrent();
    },
  };
}
