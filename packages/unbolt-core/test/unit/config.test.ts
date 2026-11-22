import { describe, expect, it } from "vitest";
import { DEFAULT_SEED, DEFAULT_SOLVER_CONFIG, resolveConfig, validateConfig } from "../../src/config";
import { formatRejected } from "../../src/errors";

describe("default Solver_Config", () => {
  it("passes validation when omitted and when passed explicitly", () => {
    expect(validateConfig(undefined).ok).toBe(true);
    expect(validateConfig(DEFAULT_SOLVER_CONFIG).ok).toBe(true);
  });

  it("equals the documented default values", () => {
    expect(DEFAULT_SOLVER_CONFIG).toStrictEqual({
      weldTolerance: 1e-6,
      microShrink: 1e-4,
      clearanceEpsilon: 5e-5,
      tau: 0.05,
      samplesPerPartPerDirection: 48,
      fastenerSymmetryTolerance: 0.1,
      fastenerSlendernessThreshold: 2,
      helicalAngularToleranceDeg: 5,
      threadPitch: 0.01,
      seed: 1592598567,
    });
  });

  it("keeps clearanceEpsilon strictly below microShrink", () => {
    expect(DEFAULT_SOLVER_CONFIG.clearanceEpsilon).toBeLessThan(DEFAULT_SOLVER_CONFIG.microShrink);
  });

  it("exports the default seed 0x5EED2027", () => {
    expect(DEFAULT_SEED).toBe(0x5eed2027);
    expect(DEFAULT_SOLVER_CONFIG.seed).toBe(DEFAULT_SEED);
  });
});

describe("validateConfig rejections", () => {
  it("names tau and the rejected value when tau is 1", () => {
    const result = validateConfig({ tau: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("ConfigurationError");
    expect(result.error.issues).toStrictEqual([
      expect.objectContaining({ fields: ["tau"], rejected: ["1"] }),
    ]);
  });

  it("names both fields when clearanceEpsilon equals the default microShrink", () => {
    const result = validateConfig({ clearanceEpsilon: 1e-4 });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues).toStrictEqual([
      expect.objectContaining({
        fields: ["clearanceEpsilon", "microShrink"],
        rejected: ["0.0001", "0.0001"],
      }),
    ]);
  });

  it("lists every violated field once, sorted by field name", () => {
    const result = validateConfig({ tau: Number.NaN, seed: 4294967296, threadPitch: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.map((issue) => issue.fields[0])).toStrictEqual(["seed", "tau", "threadPitch"]);
    expect(result.error.issues.map((issue) => issue.rejected[0])).toStrictEqual(["4294967296", "NaN", "0"]);
    expect(result.error.message).toContain("seed");
    expect(result.error.message).toContain("threadPitch");
  });

  it("rejects a non-object config with the (config) field", () => {
    const result = validateConfig(null);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues).toStrictEqual([expect.objectContaining({ fields: ["(config)"], rejected: ["null"] })]);
  });

  it("rejects a helical angle of 90 degrees and a non-integer sample count", () => {
    const angle = validateConfig({ helicalAngularToleranceDeg: 90 });
    const samples = validateConfig({ samplesPerPartPerDirection: 2.5 });
    expect(angle.ok).toBe(false);
    expect(samples.ok).toBe(false);
  });

  it("does not mutate the input object", () => {
    const input = Object.freeze({ tau: 2, microShrink: 1e-3 });
    const before = { ...input };
    validateConfig(input);
    expect(input).toStrictEqual(before);
  });

  it("ignores unknown keys", () => {
    const result = validateConfig({ unknownKnob: "anything" });
    expect(result.ok).toBe(true);
  });
});

describe("resolveConfig", () => {
  it("overlays defined fields on the defaults", () => {
    const resolved = resolveConfig({ tau: 0.1, seed: undefined });
    expect(resolved.tau).toBe(0.1);
    expect(resolved.seed).toBe(DEFAULT_SEED);
    expect(resolved.samplesPerPartPerDirection).toBe(48);
  });
});

describe("formatRejected", () => {
  it("formats special numbers and primitives deterministically", () => {
    expect(formatRejected(Number.NaN)).toBe("NaN");
    expect(formatRejected(Number.POSITIVE_INFINITY)).toBe("Infinity");
    expect(formatRejected(-0)).toBe("-0");
    expect(formatRejected(undefined)).toBe("undefined");
    expect(formatRejected("a")).toBe('"a"');
    expect(formatRejected({ nested: true })).toBe("[object]");
  });
});
