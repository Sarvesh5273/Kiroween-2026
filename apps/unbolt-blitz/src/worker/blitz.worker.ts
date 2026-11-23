import type { WorkerInMessage, WorkerOutMessage } from "../protocol";
import { createWorkerHandler } from "./workerHandler";

/**
 * The part of the worker global scope this file uses. The tsconfig `lib` has DOM and no
 * WebWorker, so the global is reached through this structural interface.
 */
interface WorkerPort {
  onmessage: ((event: MessageEvent<WorkerInMessage>) => void) | null;
  postMessage(message: WorkerOutMessage, transfer?: Transferable[]): void;
}

const port = self as unknown as WorkerPort;

/** Message handler only. Solving and move checks live in `workerHandler.ts`. */
const handle = createWorkerHandler((message, transfer) => {
  port.postMessage(message, transfer ?? []);
});

port.onmessage = (event: MessageEvent<WorkerInMessage>): void => {
  handle(event.data);
};
