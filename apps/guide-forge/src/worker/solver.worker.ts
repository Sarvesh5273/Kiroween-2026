/**
 * Solver_Worker entry. Message handler only: all pipeline logic lives in `solvePipeline.ts`.
 *
 * On a `solve` message it runs `runSolve`, posts a `progress` message for every Stage_Progress_Event,
 * then posts one `result` (with every typed-array buffer listed as a transferable) or one
 * `failure`. Every outgoing message carries the `requestId` of the request (Requirements 5.3, 5.9,
 * 5.12, 17.3, 17.7).
 *
 * The tsconfig `lib` holds DOM and no WebWorker, so the worker global is reached through the small
 * structural `WorkerPort` below and not through `DedicatedWorkerGlobalScope`.
 */
import type { SolveRequestMessage, SolveResult, WorkerOutMessage } from "../protocol";
import { toSolveFailure } from "./failure";
import { runSolve } from "./solvePipeline";

interface WorkerPort {
  onmessage: ((event: MessageEvent<SolveRequestMessage>) => void) | null;
  postMessage(message: WorkerOutMessage, transfer: Transferable[]): void;
}

const port = self as unknown as WorkerPort;

/**
 * Every distinct `ArrayBuffer` behind the typed arrays of the render data. Each buffer is listed
 * once, because a repeated buffer in a transfer list throws `DataCloneError`. A `SharedArrayBuffer`
 * is shared, not transferred, so it is not listed.
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

port.onmessage = (event: MessageEvent<SolveRequestMessage>): void => {
  const request = event.data;
  const { requestId } = request;
  try {
    const result = runSolve(request, {
      onProgress: (progress) => {
        port.postMessage({ type: "progress", requestId, event: progress }, []);
      },
    });
    port.postMessage({ type: "result", requestId, result }, collectTransferables(result));
  } catch (thrown: unknown) {
    // Any throw (Core error, compile failure, DataCloneError) becomes a failure for the Recovery_Card.
    port.postMessage({ type: "failure", requestId, failure: toSolveFailure(thrown) }, []);
  }
};
