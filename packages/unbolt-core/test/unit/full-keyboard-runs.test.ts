import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFullKeyboardRunCount } from "../helpers/fullKeyboardRuns";
/**
 * The Full_Keyboard_Run_Count parser (Req 25.10 to 25.12). These are example tests, not property
 * tests: the workspace rules reserve property tests for geometric and graph properties of solver
 * output (Req 25.4).
 */
const ACCEPTED: readonly { raw: string | undefined; runs: number }[] = [
  { raw: undefined, runs: 10 },
  { raw: "1", runs: 1 },
  { raw: "10", runs: 10 },
  { raw: "100", runs: 100 },
  { raw: "9007199254740991", runs: Number.MAX_SAFE_INTEGER },
];
const REJECTED: readonly string[] = ["", "0", "01", "-3", "1.5", " 10", "10 ", "1e3", "ten", "+5", "0x10", "10\n", "9007199254740992", "99999999999999999999999"];
describe("parseFullKeyboardRunCount accepts the documented values", () => {
  for (const { raw, runs } of ACCEPTED) {
    it(`${raw === undefined ? "unset" : JSON.stringify(raw)} gives ${runs}`, () => {
      expect(parseFullKeyboardRunCount(raw)).toEqual({ ok: true, runs });
    });
  }
});
describe("parseFullKeyboardRunCount rejects everything else", () => {
  for (const raw of REJECTED) {
    it(`${JSON.stringify(raw)} gives ok: false with a message that names the variable, the value and the format`, () => {
      const result = parseFullKeyboardRunCount(raw);
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error(`${JSON.stringify(raw)} was accepted as ${result.runs}`);
      }
      expect(result.message).toContain("UNBOLT_FULL_KB_RUNS");
      expect(result.message).toContain(JSON.stringify(raw));
      expect(result.message).toContain("^[1-9][0-9]*$");
      expect(result.message).toContain("9007199254740991");
    });
  }
  it("never substitutes the default of 10 for a rejected value", () => {
    for (const raw of REJECTED) {
      expect(parseFullKeyboardRunCount(raw)).not.toMatchObject({ ok: true });
    }
  });
});
describe("the FULL_KB_RUNS module reads the environment when it loads", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it("exports 10 when UNBOLT_FULL_KB_RUNS is not set", async () => {
    vi.stubEnv("UNBOLT_FULL_KB_RUNS", undefined);
    vi.resetModules();
    const loaded = await import("../helpers/fullKeyboardRuns");
    expect(loaded.FULL_KB_RUNS).toBe(10);
  });
  it("exports the integer in UNBOLT_FULL_KB_RUNS", async () => {
    vi.stubEnv("UNBOLT_FULL_KB_RUNS", "37");
    vi.resetModules();
    const loaded = await import("../helpers/fullKeyboardRuns");
    expect(loaded.FULL_KB_RUNS).toBe(37);
  });
  it("throws on import for a rejected value instead of falling back to 10", async () => {
    for (const raw of ["0", "", "ten", "9007199254740992"]) {
      vi.stubEnv("UNBOLT_FULL_KB_RUNS", raw);
      vi.resetModules();
      await expect(import("../helpers/fullKeyboardRuns"), JSON.stringify(raw)).rejects.toThrow(
        new RegExp(`UNBOLT_FULL_KB_RUNS.*${JSON.stringify(raw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      );
    }
  });
  it("makes the global setup throw the same message", async () => {
    vi.stubEnv("UNBOLT_FULL_KB_RUNS", "-3");
    vi.resetModules();
    await expect(import("../helpers/fullKeyboardRuns.global")).rejects.toThrow(/UNBOLT_FULL_KB_RUNS.*"-3".*\^\[1-9\]\[0-9\]\*\$/);
  });
});
