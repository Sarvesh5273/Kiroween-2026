/**
 * Gives the event loop one turn.
 *
 * An invariant property runs 100 solves, which is 1 to 2 minutes of CPU work in one test. If that
 * work never leaves the call stack, a Vitest worker cannot answer the replies of its main process,
 * and the worker's own RPC call times out after 60 seconds ("Timeout calling onTaskUpdate"). That
 * is an unhandled error, so the whole run exits non-zero even though every test passed. The
 * invariant properties are therefore asynchronous and await this function at the end of each run.
 * It changes neither the generated values nor the run count.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
