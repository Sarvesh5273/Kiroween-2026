/**
 * SolverClient: owns the Solver_Worker lifecycle on the Main_Thread.
 *
 * This is the only module that constructs a `Worker`. It keeps a monotonic request id, terminates the
 * previous worker when a new solve starts, drops messages that carry a stale request id, and turns
 * worker-level errors into `solve/failed` actions. It uses no random numbers.
 *
 * `checkMove` sends one "Check this move" request to the worker of the current solve, which still
 * holds that solve's Parts. At most one check is in flight. A check asked for while another runs
 * waits, and a newer one replaces it, so the worker never spends time on a move the user has
 * already moved on from. A check already running cannot be interrupted; its late answer is
 * still dispatched, and the reducer ignores it because its `checkId` is no longer pending.
 */
import type { CheckMoveMessage, MoveCheckRequest, SolveFailure, SolveLabel, SolveSource, WorkerOutMessage } from "../protocol";
import type { AppAction } from "../state/types";

export interface SolverClient {
  /** Terminates any running worker, starts a new one, posts the request. Returns the new request id. */
  solve(source: SolveSource, label: SolveLabel, transfer?: Transferable[]): number;
  /**
   * Checks one move on the Parts of the current solve. Dispatches `moveCheck/started` with `key`,
   * then `moveCheck/completed` or `moveCheck/failed`. Returns the check id, or `null` when no
   * solve is current.
   */
  checkMove(move: MoveCheckRequest, key: string): number | null;
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
  let checkCounter = 0;
  /** The check the current worker is running, and the newest one waiting behind it. */
  let checkInFlight: CheckMoveMessage | null = null;
  let checkQueued: CheckMoveMessage | null = null;

  function terminateCurrent(): void {
    if (currentWorker !== null) {
      currentWorker.terminate();
      currentWorker = null;
    }
    checkInFlight = null;
    checkQueued = null;
  }

  function postCheck(worker: Worker, message: CheckMoveMessage): void {
    checkInFlight = message;
    try {
      worker.postMessage(message);
    } catch (thrown) {
      checkInFlight = null;
      dispatch({ type: "moveCheck/failed", requestId: message.requestId, checkId: message.checkId, failure: failureFromThrown(thrown) });
    }
  }

  /** The in-flight check is answered: start the queued one, if any. */
  function checkSettled(worker: Worker): void {
    checkInFlight = null;
    const next = checkQueued;
    checkQueued = null;
    if (next !== null) postCheck(worker, next);
  }

  /** A worker error while a check runs fails that check, so its card never stays on Checking. */
  function failChecks(failure: SolveFailure): void {
    for (const message of [checkInFlight, checkQueued]) {
      if (message !== null) {
        dispatch({ type: "moveCheck/failed", requestId: message.requestId, checkId: message.checkId, failure });
      }
    }
    checkInFlight = null;
    checkQueued = null;
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
        case "checkResult":
          dispatch({ type: "moveCheck/completed", requestId, checkId: message.checkId, result: message.result });
          checkSettled(worker);
          break;
        case "checkFailure":
          dispatch({ type: "moveCheck/failed", requestId, checkId: message.checkId, failure: message.failure });
          checkSettled(worker);
          break;
      }
    };

    worker.onerror = (event: ErrorEvent): void => {
      if (!isCurrent()) return;
      const location = event.filename ? ` (${event.filename}:${event.lineno})` : "";
      const text = event.message ? event.message : "The solver worker raised an unhandled error.";
      const failure: SolveFailure = { name: "WorkerError", code: null, message: `${text}${location}` };
      dispatch({ type: "solve/failed", requestId, failure });
      failChecks(failure);
    };

    worker.onmessageerror = (): void => {
      if (!isCurrent()) return;
      const failure: SolveFailure = {
        name: "WorkerMessageError",
        code: null,
        message: "The solver worker sent a message that could not be deserialized.",
      };
      dispatch({ type: "solve/failed", requestId, failure });
      failChecks(failure);
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

    checkMove(move, key) {
      if (disposed || currentWorker === null || currentId === null) return null;
      checkCounter += 1;
      const message: CheckMoveMessage = {
        type: "check",
        requestId: currentId,
        checkId: checkCounter,
        move: { partId: move.partId, dir: [move.dir[0], move.dir[1], move.dir[2]], distance: move.distance, staticPartIds: move.staticPartIds.slice() },
      };
      dispatch({ type: "moveCheck/started", requestId: currentId, checkId: message.checkId, key });
      if (checkInFlight === null) postCheck(currentWorker, message);
      else checkQueued = message;
      return message.checkId;
    },
    dispose() {
      disposed = true;
      currentId = null;
      terminateCurrent();
    },
  };
}
