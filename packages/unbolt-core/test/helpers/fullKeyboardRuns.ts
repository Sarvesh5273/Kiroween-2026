/**
 * Full_Keyboard_Run_Count (Req 25.10 to 25.12): how many runs each Full_Keyboard invariant
 * property executes. This is the only code that reads `UNBOLT_FULL_KB_RUNS`. Solver code never
 * reads it, because the purity scan of `src/` rejects `process` (Req 1.7).
 *
 * The environment is read through `globalThis`, so the package needs no `@types/node`.
 */
export type FullKeyboardRunCount = { ok: true; runs: number } | { ok: false; message: string };
/** Run count when `UNBOLT_FULL_KB_RUNS` is not set (Req 25.10). */
export const DEFAULT_FULL_KB_RUNS = 10;
export const FULL_KB_RUNS_VARIABLE = "UNBOLT_FULL_KB_RUNS";
const ACCEPTED_FORMAT = "a positive integer matching ^[1-9][0-9]*$, at most 9007199254740991";
/**
 * Parses the raw value of `UNBOLT_FULL_KB_RUNS`.
 *
 * - `undefined` (variable not set) gives the default of 10.
 * - A string that matches `^[1-9][0-9]*$` and denotes an integer no greater than
 *   `Number.MAX_SAFE_INTEGER` gives that integer. The bound is compared as a `BigInt`, so a long
 *   digit string is never rounded before the comparison.
 * - Anything else, including `''`, `'0'`, `'01'`, `'-3'`, `'1.5'`, `' 10'`, `'1e3'` and `'ten'`,
 *   gives `ok: false` with a message that names the variable, quotes the rejected value and
 *   states the accepted format. The default is never substituted (Req 25.12).
 */
export function parseFullKeyboardRunCount(raw: string | undefined): FullKeyboardRunCount {
  if (raw === undefined) {
    return { ok: true, runs: DEFAULT_FULL_KB_RUNS };
  }
  if (/^[1-9][0-9]*$/.test(raw) && BigInt(raw) <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: true, runs: Number(raw) };
  }
  return {
    ok: false,
    message: `${FULL_KB_RUNS_VARIABLE} is set to ${JSON.stringify(raw)}, which is not accepted. Expected ${ACCEPTED_FORMAT}, or leave it unset to use ${DEFAULT_FULL_KB_RUNS}.`,
  };
}
interface EnvironmentHost {
  process?: { env?: Record<string, string | undefined> };
}
/** The raw value of `UNBOLT_FULL_KB_RUNS`, or `undefined` when it is not set. */
export function readRawFullKeyboardRuns(): string | undefined {
  const host = globalThis as EnvironmentHost;
  return host.process?.env?.[FULL_KB_RUNS_VARIABLE];
}
function resolveFullKeyboardRunCount(): number {
  const parsed = parseFullKeyboardRunCount(readRawFullKeyboardRuns());
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return parsed.runs;
}
/**
 * Full_Keyboard_Run_Count, computed when this module loads. An invalid value throws here, so any
 * Full_Keyboard file fails on import and the default of 10 is never substituted.
 */
export const FULL_KB_RUNS: number = resolveFullKeyboardRunCount();
