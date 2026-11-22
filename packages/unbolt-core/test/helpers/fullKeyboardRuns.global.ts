import { parseFullKeyboardRunCount, readRawFullKeyboardRuns } from "./fullKeyboardRuns";
/**
 * Vitest `globalSetup` (Req 25.12). It validates `UNBOLT_FULL_KB_RUNS` once, before any test file
 * runs, with the same parser that the Full_Keyboard files use, and defines no globals. An invalid
 * value fails the whole run with a message that names the variable, the rejected value and the
 * accepted format, even when the files selected for the run would not read the value.
 *
 * Importing `fullKeyboardRuns.ts` already throws the same message for an invalid value, so this
 * explicit check is the documented contract and the import is its backstop.
 */
export default function validateFullKeyboardRuns(): void {
  const parsed = parseFullKeyboardRunCount(readRawFullKeyboardRuns());
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
}
