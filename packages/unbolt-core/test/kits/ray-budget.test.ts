import { buildMechanicalKeyboard65 } from "@unboltkit/sample-kits";
import { describe, expect, it } from "vitest";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import { stage2BuildDbg } from "../../src/stage2/dbgBuilder";
/**
 * Ray budget regression (Req 3.3, 11.5, design "Performance and ray budget").
 *
 * The default Full_Keyboard (146 Parts) runs through `stage2BuildDbg` with the default
 * Solver_Config. `stats.raysCast` is a deterministic count of the rays actually cast, so the
 * bound catches a cost regression without timing anything.
 */
const TEST_TIMEOUT = 120_000;
const RAY_BUDGET = 6_000_000;
describe("Full_Keyboard ray budget", () => {
  it(
    `casts at most ${RAY_BUDGET} rays in stage2BuildDbg`,
    () => {
      const stage0 = stage0ParseScene(buildMechanicalKeyboard65());
      if (stage0.status !== "ok") {
        throw new Error(`Stage 0 returned ${stage0.error.kind}: ${stage0.error.message}`);
      }
      const stage1 = stage1Prepare(stage0);
      if (stage1.status !== "ok") {
        throw new Error(`Stage 1 returned ${stage1.error.kind}: ${stage1.error.message}`);
      }
      const graph = stage2BuildDbg(stage1, stage1.config);
      const parts = stage1.parts.length;
      // Guard against a vacuous pass: this is the full keyboard, every triple was examined, and
      // rays were really cast.
      expect(parts).toBeGreaterThanOrEqual(140);
      expect(graph.stats.pairsTested).toBe(parts * (parts - 1) * 32);
      expect(graph.stats.pairsPruned).toBeGreaterThan(0);
      expect(graph.stats.raysCast).toBeGreaterThan(0);
      expect(graph.stats.raysCast, `rays cast for ${parts} Parts`).toBeLessThanOrEqual(RAY_BUDGET);
    },
    TEST_TIMEOUT,
  );
});
