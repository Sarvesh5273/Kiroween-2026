import {
  buildDeadlockCageDumbbellRing,
  buildDeadlockCageShipInBottle,
  buildHauntedClockworkLockbox,
  buildMechanicalKeyboard65,
  buildPlanetaryGearbox3Stage,
  KEYBOARD_FIXTURE_LAYOUT,
} from "@unboltkit/sample-kits";
import type { Group } from "three";
import { describe, expect, it } from "vitest";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import { stage2BuildDbg } from "../../src/stage2/dbgBuilder";
import type { BlockingEdge } from "../../src/types";
import { checkWatertight } from "../helpers/watertight";
/**
 * Pruning soundness on the fixed Assemblies (Req 11.4, 11.6, 22.16).
 *
 * For both cages, the lockbox, the gearbox and the Keyboard_Fixture, every Part must pass the
 * independent watertightness checker under the default Micro_Shrink, which is the precondition of
 * Req 11.4. The Blocking_Graph built with OBB pruning must then equal the one built with pruning
 * fully disabled over every Candidate_Axis. The full 65% keyboard is deliberately absent: the
 * unpruned DBG there needs about 65 million rays (Req 11.6).
 */
const TEST_TIMEOUT = 120_000;
/** Largest Assembly this test will run unpruned. The full keyboard has 146 Parts. */
const MAX_UNPRUNED_PARTS = 40;
const FIXED_ASSEMBLIES: readonly { name: string; build: () => Group }[] = [
  { name: "deadlock cage: dumbbell and ring", build: () => buildDeadlockCageDumbbellRing() },
  { name: "deadlock cage: ship in bottle", build: () => buildDeadlockCageShipInBottle() },
  { name: "haunted clockwork lockbox", build: () => buildHauntedClockworkLockbox() },
  { name: "3-stage planetary gearbox", build: () => buildPlanetaryGearbox3Stage() },
  { name: "keyboard fixture", build: () => buildMechanicalKeyboard65({ layout: KEYBOARD_FIXTURE_LAYOUT }) },
];
function tripleOf(edge: BlockingEdge): string {
  return `${edge.from} -> ${edge.to} @${edge.dirIndex}`;
}
describe("OBB pruning is sound on the fixed Assemblies (Req 11.4, 11.6)", () => {
  for (const assembly of FIXED_ASSEMBLIES) {
    it(
      `${assembly.name}: every Part is watertight and pruned and unpruned graphs are identical`,
      () => {
        const stage0 = stage0ParseScene(assembly.build());
        if (stage0.status !== "ok") {
          throw new Error(`${assembly.name}: Stage 0 returned ${stage0.error.kind}: ${stage0.error.message}`);
        }
        const stage1 = stage1Prepare(stage0);
        if (stage1.status !== "ok") {
          throw new Error(`${assembly.name}: Stage 1 returned ${stage1.error.kind}: ${stage1.error.message}`);
        }
        expect(stage1.parts.length, `${assembly.name}: too many Parts to run the DBG unpruned`).toBeLessThanOrEqual(MAX_UNPRUNED_PARTS);
        // Precondition: every Part is a Watertight_Solid_Part under the default Micro_Shrink.
        // The Assembly is normalized, so a thickness in normalized units is used as is.
        const problems: string[] = [];
        for (const part of stage1.parts) {
          const report = checkWatertight(part.positions, part.triangles, { minThickness: stage1.config.microShrink });
          if (!report.ok) {
            problems.push(`${part.sourceNodeName}: ${report.problems.join("; ")}`);
          }
        }
        expect(problems, `${assembly.name}: Parts that are not Watertight_Solid_Parts`).toEqual([]);
        const pruned = stage2BuildDbg(stage1, stage1.config, { obbPruning: true });
        const unpruned = stage2BuildDbg(stage1, stage1.config, { obbPruning: false });
        // The same triples, in the same order, then the same triangle lists on both Parts.
        expect(pruned.edges.map(tripleOf), `${assembly.name}: pruning changed the set of blocking triples`).toEqual(
          unpruned.edges.map(tripleOf),
        );
        for (const [i, edge] of pruned.edges.entries()) {
          const reference = unpruned.edges[i];
          expect(edge.fromTriangles, `${assembly.name}: fromTriangles of ${tripleOf(edge)}`).toEqual(reference?.fromTriangles);
          expect(edge.toTriangles, `${assembly.name}: toTriangles of ${tripleOf(edge)}`).toEqual(reference?.toTriangles);
        }
        expect(pruned.edges).toEqual(unpruned.edges);
        // Both runs examine every Candidate_Axis of every ordered pair, and only the pruned run skips any.
        const pairCount = stage1.parts.length * (stage1.parts.length - 1);
        expect(pruned.stats.pairsTested).toBe(pairCount * 32);
        expect(unpruned.stats.pairsTested).toBe(pairCount * 32);
        expect(unpruned.stats.pairsPruned).toBe(0);
        expect(pruned.stats.raysCast).toBeLessThanOrEqual(unpruned.stats.raysCast);
        // Guard against a vacuous pass: there are blocking edges to compare.
        expect(unpruned.edges.length, `${assembly.name}: the unpruned graph has no edges`).toBeGreaterThan(0);
        if (stage1.parts.length > 2) {
          expect(pruned.stats.pairsPruned, `${assembly.name}: pruning skipped nothing`).toBeGreaterThan(0);
        }
      },
      TEST_TIMEOUT,
    );
  }
});
