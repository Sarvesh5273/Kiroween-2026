/**
 * Visual and UX polish pass: deadlock edge grouping, locked-part count, timeline tick thinning,
 * naive travel distance and default framing margin. The deadlocked result comes from the real
 * solve pipeline.
 */
import { describe, expect, it } from "vitest";
import { checkClashes } from "@unboltkit/core";
import { NAIVE_TRAVEL_DISTANCE, naiveOffset } from "../../src/motion/naiveExplode";
import { selectCalloutModel } from "../../src/panels/StatusCallout";
import type { SolveResult } from "../../src/protocol";
import { announceDeadlock } from "../../src/state/announce";
import { groupEdgesByPair, selectDeadlockModel } from "../../src/state/selectors";
import { DEFAULT_FRAME_MARGIN, frameBounds } from "../../src/viewport/cameraViews";
import { timelineTickStride, visibleTickNumbers } from "../../src/viewport/ViewportToolbar";
import { runSolve } from "../../src/worker/solvePipeline";

function solveKit(kitName: string): SolveResult {
  return runSolve(
    { type: "solve", requestId: 1, source: { kind: "kit", kitName } },
    { now: () => performance.now(), checkClashes },
  );
}

describe("deadlock model of the Dumbbell and Ring cage", () => {
  const cage = solveKit("deadlock-cage-dumbbell-ring");
  const model = selectDeadlockModel(cage);

  it("counts the two cycle members as locked parts in one cycle", () => {
    expect(model).not.toBeNull();
    if (model === null || cage.plan.status !== "deadlocked") return;
    const memberCount = new Set(cage.plan.witness.sccs.flatMap((scc) => scc.partIds)).size;
    expect(model.lockedCount).toBe(memberCount + cage.plan.witness.unassignedPartIds.length);
    expect(model.lockedCount).toBe(2);
    expect(model.cycles).toHaveLength(1);
    expect(announceDeadlock(model)).toContain("1 cycle, 2 locked parts");
    expect(selectCalloutModel(cage, "dbg")?.detail).toContain("2 parts are locked");
  });

  it("groups every cycle's edges by unique (from, to) pair with a direction count", () => {
    if (model === null || cage.plan.status !== "deadlocked") throw new Error("expected a deadlock");
    const rawEdges = cage.plan.witness.sccs[0]?.edges ?? [];
    const groups = model.cycles[0]?.edgeGroups ?? [];
    expect(rawEdges.length).toBeGreaterThan(groups.length);
    const keys = groups.map((group) => `${group.from}->${group.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(groups.reduce((sum, group) => sum + group.directionCount, 0)).toBe(rawEdges.length);
    for (const group of groups) {
      const expected = rawEdges.filter((edge) => edge.from === group.from && edge.to === group.to).length;
      expect(group.directionCount).toBe(expected);
    }
  });
});

describe("groupEdgesByPair", () => {
  it("keeps first-seen order and counts repeats", () => {
    expect(
      groupEdgesByPair([
        { from: "a", to: "b" },
        { from: "b", to: "a" },
        { from: "a", to: "b" },
      ]),
    ).toEqual([
      { from: "a", to: "b", directionCount: 2 },
      { from: "b", to: "a", directionCount: 1 },
    ]);
  });
});

describe("timeline tick thinning", () => {
  it("labels every step up to 20 steps", () => {
    expect(visibleTickNumbers(20)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(visibleTickNumbers(0)).toEqual([]);
  });

  it("uses stride 5 for 21 to 50 steps and stride 20 above 50", () => {
    expect(timelineTickStride(21)).toBe(5);
    expect(timelineTickStride(50)).toBe(5);
    expect(timelineTickStride(51)).toBe(20);
  });

  it("always includes the first and last step and never crowds the last label", () => {
    for (const n of [21, 30, 49, 50, 51, 100, 146, 200]) {
      const labels = visibleTickNumbers(n);
      const stride = timelineTickStride(n);
      expect(labels[0]).toBe(1);
      expect(labels[labels.length - 1]).toBe(n);
      expect(new Set(labels).size).toBe(labels.length);
      expect(labels).toEqual([...labels].sort((a, b) => a - b));
      for (let i = 1; i < labels.length; i++) {
        expect((labels[i] as number) - (labels[i - 1] as number)).toBeGreaterThanOrEqual(Math.min(stride / 2, n - 1));
      }
    }
    expect(visibleTickNumbers(146)).toEqual([1, 20, 40, 60, 80, 100, 120, 146]);
  });
});

describe("naive explode travel and framing margin", () => {
  it("moves a part by 0.65 along its direction at s = 1", () => {
    expect(NAIVE_TRAVEL_DISTANCE).toBe(0.65);
    expect(naiveOffset(1, [0, 1, 0])).toEqual([0, 0.65, 0]);
    expect(naiveOffset(0, [1, 0, 0])).toEqual([0, 0, 0]);
  });

  it("frames the iso view with the tightened default margin", () => {
    expect(DEFAULT_FRAME_MARGIN).toBe(1.0);
    const bounds = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] } as const;
    const tight = frameBounds({ min: [...bounds.min], max: [...bounds.max] }, [1, 1, 1], 40, 1.6);
    const loose = frameBounds({ min: [...bounds.min], max: [...bounds.max] }, [1, 1, 1], 40, 1.6, 1.1);
    expect(tight.distance).toBeLessThan(loose.distance);
  });
});
