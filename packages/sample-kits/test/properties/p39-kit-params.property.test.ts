import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { KitParameterError } from "../../src/index";
import { invalidKitArbitrary } from "../arbitraries/kitParams";

const SEED = 0x39badc0d;

describe("Kit_Builder parameter validation", () => {
  it("rejects every parameter object with exactly one invalid entry", { timeout: 120_000 }, () => {
    // Feature: unbolt-core-engine, Property 39: Invalid kit parameters are rejected
    fc.assert(
      fc.property(invalidKitArbitrary, ({ kit, build, params, param }) => {
        let returned: unknown = undefined;
        let thrown: unknown = undefined;
        try {
          returned = build(params);
        } catch (error) {
          thrown = error;
        }
        expect(returned, `${kit} must not return a group for ${String(param)}`).toBeUndefined();
        expect(thrown, `${kit} must throw for ${param}`).toBeInstanceOf(KitParameterError);
        expect((thrown as KitParameterError).param, kit).toBe(param);
        expect((thrown as KitParameterError).message, kit).toContain(param);
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
});
