import { buildHauntedClockworkLockbox } from "@unboltkit/sample-kits";
import { describe, expect, it } from "vitest";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import { stage2BuildDbg } from "../../src/stage2/dbgBuilder";
import { stage3Peel } from "../../src/stage3/peelSolver";
import { stage4Compile } from "../../src/stage4/trajectoryCompiler";
import { computeNaiveRadialClashes } from "../../src/stage4/naiveBaseline";
import { DEFAULT_SOLVER_CONFIG } from "../../src/config";
/**
 * Node-environment smoke test (Req 1.3, 1.4, 22.12). The Vitest config selects the `node`
 * environment and has no setup file, so no DOM global may exist. Stages 0 to 4 and the
 * Naive_Baseline then run on the Haunted Clockwork Lockbox, and the assertions read their outputs.
 */
const TEST_TIMEOUT = 120_000;
function isThenable(value: unknown): boolean {
  return value !== null && typeof value === "object" && typeof (value as { then?: unknown }).then === "function";
}
describe("node environment smoke test (Req 1.3, 22.12)", () => {
  it("runs without any DOM or WebGL global", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof HTMLCanvasElement).toBe("undefined");
    expect(typeof OffscreenCanvas).toBe("undefined");
    expect(typeof HTMLElement).toBe("undefined");
    expect(typeof WebGLRenderingContext).toBe("undefined");
  });
  it(
    "runs Stage 0 to Stage 4 and the Naive_Baseline on the lockbox",
    () => {
      const root = buildHauntedClockworkLockbox();
      let meshCount = 0;
      root.traverse((node) => {
        if ((node as { isMesh?: boolean }).isMesh === true) meshCount++;
      });
      expect(meshCount).toBeGreaterThanOrEqual(2);
      const stage0 = stage0ParseScene(root);
      expect(isThenable(stage0), "Stage 0 returns a plain value (Req 1.4)").toBe(false);
      if (stage0.status !== "ok") {
        throw new Error(`Stage 0 returned ${stage0.error.kind}: ${stage0.error.message}`);
      }
      // One Island per mesh, so the Part count equals the mesh count.
      expect(stage0.parts).toHaveLength(meshCount);
      const stage1 = stage1Prepare(stage0);
      expect(isThenable(stage1)).toBe(false);
      if (stage1.status !== "ok") {
        throw new Error(`Stage 1 returned ${stage1.error.kind}: ${stage1.error.message}`);
      }
      expect(stage1.parts).toHaveLength(stage0.parts.length);
      for (const part of stage1.parts) {
        expect(part.candidateAxes).toHaveLength(32);
        expect(part.bvh).toBeDefined();
      }
      const graph = stage2BuildDbg(stage1, stage1.config);
      expect(isThenable(graph)).toBe(false);
      expect(graph.partIds).toEqual(stage1.parts.map((part) => part.partId));
      expect(graph.stats.pairsTested).toBe(stage1.parts.length * (stage1.parts.length - 1) * 32);
      expect(graph.stats.raysCast).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
      const plan = stage3Peel(stage1, graph, stage1.config);
      expect(isThenable(plan)).toBe(false);
      expect(plan.status).toBe("solved");
      if (plan.status !== "solved") {
        throw new Error(`the lockbox did not solve: ${plan.status}`);
      }
      expect(plan.steps).toHaveLength(stage1.parts.length);
      expect(new Set(plan.steps.map((step) => step.partId)).size).toBe(plan.steps.length);
      const compiled = stage4Compile(plan, stage1, DEFAULT_SOLVER_CONFIG);
      expect(isThenable(compiled)).toBe(false);
      if (!compiled.ok) {
        throw new Error(`Stage 4 failed: ${compiled.error.kind}: ${compiled.error.message}`);
      }
      // One Trajectory_Step per Plan_Step, for the same Part, in the same order.
      expect(compiled.steps).toHaveLength(plan.steps.length);
      expect(compiled.steps.map((step) => step.partId)).toEqual(plan.steps.map((step) => step.partId));
      const baseline = computeNaiveRadialClashes(stage1);
      expect(isThenable(baseline)).toBe(false);
      // One baseline entry per Part, in ascending Part_ID order, and a total that adds up.
      expect(baseline.perPart).toHaveLength(stage1.parts.length);
      expect(baseline.perPart.map((entry) => entry.partId)).toEqual(stage1.parts.map((part) => part.partId));
      expect(baseline.perPart.reduce((sum, entry) => sum + entry.clashCount, 0)).toBe(baseline.totalClashes);
      for (const entry of baseline.perPart) {
        expect(entry.clashes).toHaveLength(entry.clashCount);
      }
    },
    TEST_TIMEOUT,
  );
});
