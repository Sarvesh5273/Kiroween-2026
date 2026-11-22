import type { Object3D } from "three";
import { describe, expect, it } from "vitest";
import { solveDisassembly } from "../../src/pipeline";
import { stage0ParseScene } from "../../src/stage0/stage0";
import type { DisassemblyPlan } from "../../src/types";
import { type KitCase, kitsIn } from "../helpers/kitSet";
/**
 * Kit solve examples (Req 16.9, 23.4, 23.5, and the `userData` independence of design R10).
 *
 * Each showcase kit and the Keyboard_Fixture solves at the default Solver_Config with one
 * Plan_Step per Part and no repeated Part_ID. In the default keyboard plan every case screw comes
 * before the PCB, selected by node name. Each cage is deadlocked with 0 steps and at least 1 SCC.
 * Solving a kit with every `userData` cleared gives a plan deep-equal to solving it unchanged.
 */
const TEST_TIMEOUT = 120_000;
/** Solves each kit once per file, because the Full_Keyboard solve takes a few seconds. */
const solved = new Map<string, DisassemblyPlan>();
function solveOnce(kit: KitCase): DisassemblyPlan {
  const cached = solved.get(kit.name);
  if (cached !== undefined) {
    return cached;
  }
  const plan = solveDisassembly(kit.build());
  solved.set(kit.name, plan);
  return plan;
}
/** Node name of every Part, by Part_ID, from a fresh Stage 0 run on a fresh build of the kit. */
function nameByPartId(kit: KitCase): Map<string, string> {
  const stage0 = stage0ParseScene(kit.build());
  if (stage0.status !== "ok") {
    throw new Error(`${kit.name}: Stage 0 returned ${stage0.error.kind}: ${stage0.error.message}`);
  }
  return new Map(stage0.parts.map((part) => [part.partId, part.sourceNodeName]));
}
function clearUserData(root: Object3D): void {
  root.traverse((node) => {
    node.userData = {};
  });
}
describe("showcase kits and the Keyboard_Fixture solve at defaults (Req 23.4)", () => {
  for (const kit of kitsIn("showcase", "fixture")) {
    it(
      `${kit.name}: solved, one Plan_Step per Part, no repeated Part_ID`,
      () => {
        const plan = solveOnce(kit);
        if (plan.status !== "solved") {
          throw new Error(`${kit.name}: expected status "solved", received "${plan.status}"`);
        }
        const names = nameByPartId(kit);
        const stepIds = plan.steps.map((step) => step.partId);
        expect(stepIds, `${kit.name}: a Part_ID appears in two steps`).toHaveLength(new Set(stepIds).size);
        expect(plan.steps, `${kit.name}: one Plan_Step per Part`).toHaveLength(names.size);
        expect([...stepIds].sort()).toEqual([...names.keys()].sort());
        expect(plan.sampling.polyBudgetExceeded).toBe(false);
      },
      TEST_TIMEOUT,
    );
  }
  it(
    "default keyboard plan: every case_screw step precedes the pcb step (Req 23.5)",
    () => {
      const keyboard = kitsIn("showcase")[0];
      if (keyboard === undefined) {
        throw new Error("no showcase kit is registered");
      }
      const plan = solveOnce(keyboard);
      if (plan.status !== "solved") {
        throw new Error(`${keyboard.name}: expected status "solved", received "${plan.status}"`);
      }
      const names = nameByPartId(keyboard);
      const nameOf = (partId: string): string => names.get(partId) ?? "";
      const screwIndexes = plan.steps.flatMap((step, i) => (/^case_screw/.test(nameOf(step.partId)) ? [i] : []));
      const pcbIndexes = plan.steps.flatMap((step, i) => (/^pcb$/.test(nameOf(step.partId)) ? [i] : []));
      expect(screwIndexes.length, "the keyboard has at least 4 case screws").toBeGreaterThanOrEqual(4);
      expect(pcbIndexes, "the keyboard has exactly one PCB step").toHaveLength(1);
      const pcbIndex = pcbIndexes[0] ?? -1;
      const late = screwIndexes.filter((index) => index > pcbIndex).map((index) => nameOf(plan.steps[index]?.partId ?? ""));
      expect(late, `case screws planned after the pcb step at index ${pcbIndex}`).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
describe("Deadlock_Cages are deadlocked (Req 16.9)", () => {
  for (const kit of kitsIn("cage")) {
    it(
      `${kit.name}: deadlocked with 0 steps and at least 1 SCC`,
      () => {
        const plan = solveOnce(kit);
        if (plan.status !== "deadlocked") {
          throw new Error(`${kit.name}: expected status "deadlocked", received "${plan.status}"`);
        }
        expect(plan.steps).toHaveLength(0);
        expect(plan.witness.sccs.length).toBeGreaterThanOrEqual(1);
        for (const scc of plan.witness.sccs) {
          expect(scc.partIds.length).toBeGreaterThanOrEqual(2);
          expect(scc.edges.length).toBeGreaterThan(0);
        }
      },
      TEST_TIMEOUT,
    );
  }
});
describe("the engine never reads userData (design R10)", () => {
  for (const kit of kitsIn("showcase", "cage", "fixture")) {
    it(
      `${kit.name}: clearing every userData leaves the plan unchanged`,
      () => {
        const root = kit.build();
        let sawConstructionAxis = false;
        root.traverse((node) => {
          if (node.userData.constructionAxis !== undefined) sawConstructionAxis = true;
        });
        expect(sawConstructionAxis, `${kit.name}: the kit should carry a constructionAxis to clear`).toBe(true);
        clearUserData(root);
        root.traverse((node) => {
          expect(Object.keys(node.userData)).toEqual([]);
        });
        const cleared = solveDisassembly(root);
        expect(cleared).toStrictEqual(solveOnce(kit));
      },
      TEST_TIMEOUT,
    );
  }
});
