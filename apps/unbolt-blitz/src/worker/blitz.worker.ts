import type { SolveRequestMessage, WorkerOutMessage } from "../protocol";
import { toSolveFailure } from "./rejection";
import { runBlitzSolve } from "./runBlitzSolve";
import { collectTransferables } from "./transfer";

/**
 * The part of the worker global scope this file uses. The tsconfig `lib` has DOM and no
 * WebWorker, so the global is reached through this structural interface.
 */
interface WorkerPort {
  onmessage: ((event: MessageEvent<SolveRequestMessage>) => void) | null;
  postMessage(message: WorkerOutMessage, transfer?: Transferable[]): void;
}

const port = self as unknown as WorkerPort;

/** Message handler only. All solving lives in `runBlitzSolve`. */
port.onmessage = (event: MessageEvent<SolveRequestMessage>): void => {
  const request = event.data;
  const { requestId } = request;

  try {
    const outcome = runBlitzSolve(request, {
      onStage: (stage, state) => {
        port.postMessage({ type: "progress", requestId, stage, state });
      },
    });

    if (outcome.kind === "rejected") {
      port.postMessage({ type: "rejected", requestId, rejection: outcome.rejection });
      return;
    }

    port.postMessage(
      { type: "solved", requestId, result: outcome.result },
      collectTransferables(outcome.result),
    );
  } catch (thrown) {
    port.postMessage({ type: "failure", requestId, failure: toSolveFailure(thrown) });
  }
};
