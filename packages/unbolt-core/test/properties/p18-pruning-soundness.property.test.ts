import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import { stage2BuildDbg } from "../../src/stage2/dbgBuilder";
import type { BlockingEdge } from "../../src/types";
import { assemblyArbitrary, worldGeometry } from "../arbitraries/assemblies";
import { domainMessage, failWith } from "../helpers/failWith";
import { checkWatertight } from "../helpers/watertight";
/**
 * Property 18: OBB pruning is sound (Req 11.4, 11.7).
 *
 * For every generated Assembly of 2 to 8 Parts, every Part is first checked with the independent
 * watertightness checker under the run's Micro_Shrink, so a generator defect fails the run
 * instead of passing vacuously. Then the Blocking_Graph built with OBB pruning must equal the one
 * built with pruning fully disabled: the same `(A, B, d)` triples in the same order and, for
 * every edge, the same triangle lists on both Parts.
 */
const SEED = 0x1b0cf18;
const NUM_RUNS = 100;
function tripleOf(edge: BlockingEdge): string {
  return `${edge.from} -> ${edge.to} @${edge.dirIndex}`;
}
describe("Property 18: OBB pruning is sound", () => {
  it(`gives identical edges and triangle lists with pruning on and off (seed ${SEED}, ${NUM_RUNS} runs)`, () => {
    let totalPruned = 0;
    let totalEdges = 0;
    let totalTested = 0;
    fc.assert(
      fc.property(assemblyArbitrary(), fc.context(), (assembly, ctx) => {
        const domain = {
          layout: assembly.layout,
          partCount: assembly.parts.length,
          microShrink: assembly.config.microShrink,
          clearanceEpsilon: assembly.config.clearanceEpsilon,
          extent: assembly.extent,
          se3: assembly.se3,
        };
        // Precondition: every Part is a Watertight_Solid_Part under this run's Micro_Shrink.
        const minThickness = assembly.config.microShrink * assembly.extent;
        for (const part of assembly.parts) {
          const { positions, index } = worldGeometry(part);
          const report = checkWatertight(positions, index, { minThickness });
          if (!report.ok) {
            failWith(ctx, { ...domain, part: part.name, kind: part.kind }, `generated Part is not watertight: ${report.problems.join("; ")}`);
          }
        }
        const stage0 = stage0ParseScene(assembly.root, assembly.config);
        if (stage0.status !== "ok") {
          return failWith(ctx, domain, `Stage 0 returned ${stage0.error.kind}: ${stage0.error.message}`);
        }
        const stage1 = stage1Prepare(stage0, assembly.config);
        if (stage1.status !== "ok") {
          return failWith(ctx, domain, `Stage 1 returned ${stage1.error.kind}: ${stage1.error.message}`);
        }
        const pruned = stage2BuildDbg(stage1, stage1.config, { obbPruning: true });
        const full = stage2BuildDbg(stage1, stage1.config, { obbPruning: false });
        totalPruned += pruned.stats.pairsPruned;
        totalEdges += full.edges.length;
        totalTested += full.stats.pairsTested;
        const prunedTriples = pruned.edges.map(tripleOf);
        const fullTriples = full.edges.map(tripleOf);
        expect(prunedTriples, domainMessage(ctx, domain, "pruning changed the set of blocking triples")).toEqual(fullTriples);
        for (const [i, edge] of pruned.edges.entries()) {
          const reference = full.edges[i];
          expect(edge.fromTriangles, domainMessage(ctx, { ...domain, triple: tripleOf(edge) }, "fromTriangles differ")).toEqual(
            reference?.fromTriangles,
          );
          expect(edge.toTriangles, domainMessage(ctx, { ...domain, triple: tripleOf(edge) }, "toTriangles differ")).toEqual(
            reference?.toTriangles,
          );
        }
        expect(pruned.edges, domainMessage(ctx, domain, "pruned and unpruned edges differ")).toEqual(full.edges);
        // Both runs examine the same triples, and only the pruned run skips any.
        expect(pruned.stats.pairsTested).toBe(full.stats.pairsTested);
        expect(full.stats.pairsPruned).toBe(0);
        expect(pruned.stats.raysCast).toBeLessThanOrEqual(full.stats.raysCast);
        return undefined;
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
    // Guard against a vacuous pass: pruning must have skipped triples, and blocking must exist.
    expect(totalTested).toBeGreaterThan(0);
    expect(totalPruned).toBeGreaterThan(0);
    expect(totalEdges).toBeGreaterThan(0);
  }, 600_000);
});
