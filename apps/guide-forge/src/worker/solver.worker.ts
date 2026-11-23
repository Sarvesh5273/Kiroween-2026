/**
 * Solver_Worker entry. Message handler only: the solve lives in `solvePipeline.ts` and the move
 * check in `moveCheck.ts`.
 *
 * On a `solve` message it runs `runSolve`, posts a `progress` message for every Stage_Progress_Event,
 * then posts one `result` (with every typed-array buffer listed as a transferable) or one
 * `failure`. Every outgoing message carries the `requestId` of the request (Requirements 5.3, 5.9,
 * 5.12, 17.3, 17.7).
 *
 * The solve keeps its Stage 1 Parts in this worker. A later `check` message for the same solve
 * runs `verifyLinearMove` on those Parts and posts one `checkResult` or one `checkFailure` with the
 * request's `checkId`. Checks run only on request, never as part of a solve.
 *
 * The tsconfig `lib` holds DOM and no WebWorker, so the worker global is reached through the small
 * structural `WorkerPort` below and not through `DedicatedWorkerGlobalScope`.
 */
import type { SolveResult, WorkerInMessage, WorkerOutMessage } from "../protocol";
import { toSolveFailure } from "./failure";
import { runMoveCheck, type MoveCheckContext } from "./moveCheck";
import { runSolve } from "./solvePipeline";

interface WorkerPort {
  onmessage: ((event: MessageEvent<WorkerInMessage>) => void) | null;
  postMessage(message: WorkerOutMessage, transfer: Transferable[]): void;
}

const port = self as unknown as WorkerPort;

/** Parts of the latest solve in this worker. */
let context: MoveCheckContext | null = null;

/**
 * Every distinct `ArrayBuffer` behind the typed arrays of the render data. Each buffer is listed
 * once, because a repeated buffer in a transfer list throws `DataCloneError`. A `SharedArrayBuffer`
 * is shared, not transferred, so it is not listed. The render data are copies, so the Stage 1
 * Parts kept for move checks stay intact.
 */
function collectTransferables(result: SolveResult): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const part of result.parts) {
    for (const array of [part.positions, part.normals, part.indices]) {
      if (array.buffer instanceof ArrayBuffer) {
        buffers.add(array.buffer);
      }
    }
  }
  return [...buffers];
}

port.onmessage = (event: MessageEvent<WorkerInMessage>): void => {
  const message = event.data;
  if (message.type === "check") {
    const { requestId, checkId } = message;
    try {
      const result = runMoveCheck(context, message);
      port.postMessage({ type: "checkResult", requestId, checkId, result }, []);
    } catch (thrown: unknown) {
      port.postMessage({ type: "checkFailure", requestId, checkId, failure: toSolveFailure(thrown) }, []);
    }
    return;
  }
  const { requestId } = message;
  context = null;
  try {
    const result = runSolve(message, {
      onProgress: (progress) => {
        port.postMessage({ type: "progress", requestId, event: progress }, []);
      },
      onStage1Ready: (stage1) => {
        context = { requestId, stage1 };
      },
    });
    port.postMessage({ type: "result", requestId, result }, collectTransferables(result));
  } catch (thrown: unknown) {
    // Any throw (Core error, compile failure, DataCloneError) becomes a failure for the Recovery_Card.
    context = null;
    port.postMessage({ type: "failure", requestId, failure: toSolveFailure(thrown) }, []);
  }
};
