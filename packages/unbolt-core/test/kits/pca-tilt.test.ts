import { describe, expect, it } from "vitest";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import {
  findSourceMesh,
  radialClearanceLowerBound,
  readConstructionAxis,
  TriangleTree,
  type V3,
  worldConstructionAxis,
} from "../helpers/kitGeometry";
import { kitsIn } from "../helpers/kitSet";
/**
 * PCA tilt kit test (Req 23.12, 23.13, design R11).
 *
 * For every showcase kit at defaults and the Keyboard_Fixture, every Part's Construction_Axis `a`
 * (read from its source mesh, mapped to world space) must lie within
 * `0.25 × Radial_Clearance / L` radians of its nearest PCA axis, where `L` is the Part's extent
 * along `a` and both lengths are in normalized units. Radial_Clearance is replaced by the lower
 * bound of `radialClearanceLowerBound`, so this check is at least as strict as the requirement.
 */
const TEST_TIMEOUT = 120_000;
const TILT_FACTOR = 0.25;
interface Row {
  kit: string;
  node: string;
  angle: number;
  bound: number;
  clearance: number;
  length: number;
}
function describeRow(row: Row): string {
  return (
    `${row.kit} / ${row.node}: angle ${row.angle.toExponential(4)} rad exceeds bound ${row.bound.toExponential(4)} ` +
    `(0.25 × Radial_Clearance ${row.clearance.toExponential(4)} / L ${row.length.toExponential(4)})`
  );
}
describe("PCA tilt of the Construction_Axis (Req 23.12, 23.13)", () => {
  for (const kit of kitsIn("showcase", "fixture")) {
    it(
      `${kit.name}: every Part's Construction_Axis is within the tilt bound of a PCA axis`,
      () => {
        const root = kit.build();
        root.updateMatrixWorld(true);
        const stage0 = stage0ParseScene(root);
        if (stage0.status !== "ok") {
          throw new Error(`${kit.name}: Stage 0 returned ${stage0.error.kind}: ${stage0.error.message}`);
        }
        const stage1 = stage1Prepare(stage0);
        if (stage1.status !== "ok") {
          throw new Error(`${kit.name}: Stage 1 returned ${stage1.error.kind}: ${stage1.error.message}`);
        }
        const trees = stage1.parts.map((part) => new TriangleTree(part));
        const failures: string[] = [];
        const rows: Row[] = [];
        for (const [index, part] of stage1.parts.entries()) {
          const mesh = findSourceMesh(root, part.sourceNodePath);
          const local = readConstructionAxis(mesh);
          if ("problem" in local) {
            failures.push(`${kit.name} / ${mesh.name}: ${local.problem}`);
            continue;
          }
          const axis: V3 = worldConstructionAxis(mesh, local.axis);
          if (!axis.every((component) => Number.isFinite(component)) || Math.abs(Math.hypot(...axis) - 1) > 1e-9) {
            failures.push(`${kit.name} / ${mesh.name}: world Construction_Axis [${axis.join(", ")}] is not a finite unit vector`);
            continue;
          }
          // L: the Part's extent along the axis, in normalized units.
          let lo = Number.POSITIVE_INFINITY;
          let hi = Number.NEGATIVE_INFINITY;
          for (let v = 0; v < part.positions.length; v += 3) {
            const projection =
              (part.positions[v] ?? 0) * axis[0] + (part.positions[v + 1] ?? 0) * axis[1] + (part.positions[v + 2] ?? 0) * axis[2];
            lo = Math.min(lo, projection);
            hi = Math.max(hi, projection);
          }
          const length = hi - lo;
          const clearance = radialClearanceLowerBound(trees, index, axis).distance;
          const angle = Math.min(
            ...part.frame.axes.map((pca) =>
              Math.acos(Math.min(1, Math.abs(pca[0] * axis[0] + pca[1] * axis[1] + pca[2] * axis[2]))),
            ),
          );
          const bound = (TILT_FACTOR * clearance) / length;
          const row: Row = { kit: kit.name, node: mesh.name, angle, bound, clearance, length };
          rows.push(row);
          if (!(angle <= bound)) {
            failures.push(describeRow(row));
          }
        }
        expect(failures, `${kit.name}: Parts over the PCA tilt bound:\n${failures.join("\n")}`).toEqual([]);
        expect(rows).toHaveLength(stage1.parts.length);
        for (const row of rows) {
          expect(Number.isFinite(row.length) && row.length > 0, `${row.kit} / ${row.node}: L must be positive`).toBe(true);
          expect(Number.isFinite(row.clearance) && row.clearance > 0, `${row.kit} / ${row.node}: Radial_Clearance bound must be positive`).toBe(
            true,
          );
        }
      },
      TEST_TIMEOUT,
    );
  }
});
