import { MANIFEST_SCHEMA } from "../../src/manifestTypes.js";
import type { DisassemblyManifest } from "../../src/manifestTypes.js";

/**
 * Illustrative manifest shown in preview mode, when the page runs outside a Kiro Crew host or no
 * `disassembly-manifest.json` exists yet. The numbers are made up. They show a candidate that
 * deadlocks where the baseline was solved. The dashboard labels it as a sample.
 */
export const SAMPLE_MANIFEST: DisassemblyManifest = {
  schema: MANIFEST_SCHEMA,
  generatedAt: "2026-01-01T00:00:00.000Z",
  tool: { name: "crew-assembly-ci", version: "0.1.0" },
  mode: "diff",
  assembly: {
    source: { kind: "glb", name: "assemblies/dumbbell-ring.glb" },
    status: "deadlocked",
    partCount: 6,
    totalTriangles: 5120,
    polyBudgetExceeded: false,
    clashes: { oracle: 0, naive: 14, naiveObstructedParts: 5, avoidedByPlan: 14 },
    repairability: {
      maxDepth: 3,
      steps: [
        { depth: 1, partId: "part-1", name: "cover", primitive: "linear_slide" },
        { depth: 2, partId: "part-2", name: "bracket", primitive: "linear_slide" },
        { depth: 3, partId: "part-3", name: "bolt", primitive: "helical_unscrew" },
      ],
    },
    deadlock: {
      sccs: [
        {
          partIds: ["part-4", "part-5"],
          names: ["dumbbell", "captive_ring"],
          edges: [
            { from: "part-4", to: "part-5", fromName: "dumbbell", toName: "captive_ring", dir: [0, 1, 0] },
            { from: "part-5", to: "part-4", fromName: "captive_ring", toName: "dumbbell", dir: [0, -1, 0] },
          ],
        },
      ],
      blockedByCycle: [{ partId: "part-6", name: "base_plate" }],
    },
    error: null,
  },
  diff: {
    baseline: {
      source: { kind: "glb", name: "main:assemblies/dumbbell-ring.glb" },
      status: "solved",
      partCount: 6,
      oracleClashes: 0,
      naiveClashes: 12,
    },
    deadlockRegressed: true,
    newlyDeadlocked: true,
    newSccs: [["captive_ring", "dumbbell"]],
    resolvedSccs: [],
    depthRegressions: [
      { name: "dumbbell", partId: "part-4", baselineDepth: 4, candidateDepth: null, delta: null },
      { name: "captive_ring", partId: "part-5", baselineDepth: 5, candidateDepth: null, delta: null },
      { name: "base_plate", partId: "part-6", baselineDepth: 2, candidateDepth: 6, delta: 4 },
    ],
    depthImprovements: [{ name: "cover", partId: "part-1", baselineDepth: 3, candidateDepth: 1, delta: -2 }],
    addedParts: [],
    removedParts: [],
  },
  verdict: {
    ci: "fail",
    summary: "FAIL: The candidate deadlocks (1 SCC) and the baseline did not.",
    reasons: ["The candidate deadlocks (1 SCC) and the baseline did not."],
    warnings: ["3 parts became harder to reach (repairability depth regression)."],
  },
};
