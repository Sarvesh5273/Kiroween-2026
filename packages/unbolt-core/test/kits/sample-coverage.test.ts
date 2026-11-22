import { describe, expect, it } from "vitest";
import { checkClashes } from "../../src/oracle/clashChecker";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import { stage2BuildDbg } from "../../src/stage2/dbgBuilder";
import type { NormalizedPart, Vec3 } from "../../src/types";
import { KIT_CASES } from "../helpers/kitSet";
/**
 * Sample coverage diagnostic (Req 22.17, 22.18).
 *
 * For each of the 5 kits at defaults and the Keyboard_Fixture, every Expected_Blocking_Edge
 * `(A, B, d)` is found with the Clash_Checker: A translated along each of its 32 Candidate_Axes
 * against B as the only static Part, with at least one Opposing_Normal_Collision. The DBG_Builder
 * then runs with default pruning and `collectRayCounts`, and each edge's count is
 * `forwardRays + backwardRays` of its record (0 when it has none, flagged `pruned` when the
 * triple was pruned). One line per edge is reported, and the test fails after listing every edge
 * with fewer than 2 detecting Sample_Rays.
 */
const TEST_TIMEOUT = 120_000;
const MIN_DETECTING_RAYS = 2;
/** Safety margin for the box pre-filter, 10 times Micro_Shrink, so it never rejects a real edge. */
const CULL_MARGIN = 1e-3;
/**
 * True when some ray from a point of `a`'s box along `d` can reach `b`'s box. A ray from `a` at
 * `p` meets `b` only if `b - a = t d` for `t >= 0` with `a` in A's box and `b` in B's box, which is
 * the ray from the origin along `d` meeting the box `[b.min - a.max, b.max - a.min]`. The mirror
 * rays of B along `-d` give the same condition. This only skips oracle calls that cannot report a
 * collision, so it changes no result, only the running time.
 */
function sweptBoxMayReach(a: NormalizedPart, b: NormalizedPart, d: Vec3): boolean {
  let tNear = 0;
  let tFar = Number.POSITIVE_INFINITY;
  for (let c = 0; c < 3; c++) {
    const lo = b.aabb.min[c]! - a.aabb.max[c]! - CULL_MARGIN;
    const hi = b.aabb.max[c]! - a.aabb.min[c]! + CULL_MARGIN;
    const component = d[c]!;
    if (component === 0) {
      if (lo > 0 || hi < 0) return false;
    } else {
      const t1 = lo / component;
      const t2 = hi / component;
      tNear = Math.max(tNear, Math.min(t1, t2));
      tFar = Math.min(tFar, Math.max(t1, t2));
      if (tNear > tFar) return false;
    }
  }
  return true;
}
interface EdgeReport {
  kit: string;
  from: string;
  to: string;
  dirIndex: number;
  count: number;
  pruned: boolean;
}
function formatEdge(edge: EdgeReport): string {
  return `${edge.kit} | ${edge.from} -> ${edge.to} | dirIndex ${edge.dirIndex} | detecting rays ${edge.count} | ${edge.pruned ? "pruned" : "not pruned"}`;
}
function tripleKey(from: string, to: string, dirIndex: number): string {
  return `${from}\u0000${to}\u0000${dirIndex}`;
}
describe("sample coverage of every Expected_Blocking_Edge (Req 22.17, 22.18)", () => {
  for (const kit of KIT_CASES) {
    it(
      `${kit.name}: every Expected_Blocking_Edge is detected by at least ${MIN_DETECTING_RAYS} Sample_Rays`,
      () => {
        const stage0 = stage0ParseScene(kit.build());
        if (stage0.status !== "ok") {
          throw new Error(`${kit.name}: Stage 0 returned ${stage0.error.kind}: ${stage0.error.message}`);
        }
        const stage1 = stage1Prepare(stage0);
        if (stage1.status !== "ok") {
          throw new Error(`${kit.name}: Stage 1 returned ${stage1.error.kind}: ${stage1.error.message}`);
        }
        const config = stage1.config;
        // Expected_Blocking_Edges from the independent oracle.
        const expected: { from: string; to: string; dirIndex: number }[] = [];
        let oracleCalls = 0;
        for (const moving of stage1.parts) {
          for (const fixed of stage1.parts) {
            if (fixed.partId === moving.partId) continue;
            for (const [dirIndex, dir] of moving.candidateAxes.entries()) {
              if (!sweptBoxMayReach(moving, fixed, dir)) continue;
              oracleCalls++;
              if (checkClashes(moving, dir, [fixed], config).count >= 1) {
                expected.push({ from: moving.partId, to: fixed.partId, dirIndex });
              }
            }
          }
        }
        // Counts from the DBG_Builder with default pruning.
        const graph = stage2BuildDbg(stage1, config, { collectRayCounts: true });
        const diagnostics = graph.diagnostics;
        if (diagnostics === undefined) {
          throw new Error(`${kit.name}: collectRayCounts did not produce diagnostics`);
        }
        const counts = new Map<string, number>();
        for (const record of diagnostics.rayCounts) {
          counts.set(tripleKey(record.from, record.to, record.dirIndex), record.forwardRays + record.backwardRays);
        }
        const pruned = new Set(diagnostics.prunedTriples.map((t) => tripleKey(t.from, t.to, t.dirIndex)));
        const reports: EdgeReport[] = expected.map((edge) => {
          const key = tripleKey(edge.from, edge.to, edge.dirIndex);
          return { kit: kit.name, ...edge, count: counts.get(key) ?? 0, pruned: pruned.has(key) };
        });
        // One line per Expected_Blocking_Edge, then a summary.
        const lines = reports.map(formatEdge);
        const weakest = reports.reduce((min, edge) => Math.min(min, edge.count), Number.POSITIVE_INFINITY);
        console.info(
          `[sample-coverage] ${kit.name}: ${stage1.parts.length} Parts, ${expected.length} Expected_Blocking_Edges ` +
            `(${oracleCalls} oracle calls), weakest edge ${weakest} detecting rays\n${lines.join("\n")}`,
        );
        const weak = reports.filter((edge) => edge.count < MIN_DETECTING_RAYS);
        expect(
          weak.map(formatEdge),
          `${kit.name}: Expected_Blocking_Edges with fewer than ${MIN_DETECTING_RAYS} detecting Sample_Rays`,
        ).toEqual([]);
        // The diagnostic must have found something to check, and every edge must lie in the DBG.
        expect(expected.length, `${kit.name}: no Expected_Blocking_Edge was found`).toBeGreaterThan(0);
        const dbgEdges = new Set(graph.edges.map((edge) => tripleKey(edge.from, edge.to, edge.dirIndex)));
        const missing = reports.filter((edge) => !dbgEdges.has(tripleKey(edge.from, edge.to, edge.dirIndex)));
        expect(missing.map(formatEdge), `${kit.name}: Expected_Blocking_Edges missing from the DBG`).toEqual([]);
      },
      TEST_TIMEOUT,
    );
  }
});
