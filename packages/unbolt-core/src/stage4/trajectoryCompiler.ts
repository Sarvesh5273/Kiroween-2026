import { validateConfig, type SolverConfig } from "../config";
import { createDefaultPrimitiveRegistry } from "../primitives/registry";
import type { PrimitivePartInfo, PrimitiveRegistry } from "../primitives/types";
import { computePartMetrics } from "../stage1/partMetrics";
import type { CompileError, DisassemblyPlan, NormalizedPart, Stage1Result, TrajectoryStep } from "../types";

/**
 * Stage 4: compiles the Plan_Steps of a solved plan into Trajectory_Steps (Req 19).
 *
 * - A plan whose status is not `'solved'` gives `{ kind: 'PlanNotSolved', status }` and no steps
 *   (Req 19.7).
 * - Each step, in order, becomes `{ partId, primitive, params }`. The registry's `select` takes
 *   the highest-priority applicable primitive, with ties broken by ascending name (Req 19.3).
 *   Every step is treated alike, wherever the plan came from, so a supplied step with a non-null
 *   `secondary` gets `two_step_l_slide` (Req 19.10).
 * - The plan is only read. The returned params are fresh arrays that do not alias the plan.
 * - `registry` defaults to `createDefaultPrimitiveRegistry()`. A custom registry may fail with
 *   `NoApplicablePrimitive`.
 *
 * @param config Validated here, because this function can be called directly. Missing fields
 *   take their defaults. The Fastener flag is computed from the Part's OBB and this config.
 * @throws RangeError when a Plan_Step names a Part that is not in `stage1`.
 */
export function stage4Compile(
  plan: DisassemblyPlan,
  stage1: Stage1Result,
  config: SolverConfig,
  registry: PrimitiveRegistry = createDefaultPrimitiveRegistry(),
): { ok: true; steps: TrajectoryStep[] } | { ok: false; error: CompileError } {
  if (plan.status !== "solved") {
    return {
      ok: false,
      error: {
        kind: "PlanNotSolved",
        status: plan.status,
        message: `Only a solved plan can be compiled; received status ${plan.status}`,
      },
    };
  }
  const validation = validateConfig(config);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const context = { config: validation.config };
  const partsById = new Map<string, NormalizedPart>();
  for (const part of stage1.parts) {
    partsById.set(part.partId, part);
  }

  const steps: TrajectoryStep[] = [];
  for (const step of plan.steps) {
    const part = partsById.get(step.partId);
    if (part === undefined) {
      throw new RangeError(`Plan_Step names Part ${step.partId}, which is not in the Stage 1 result`);
    }
    const info: PrimitivePartInfo = {
      partId: part.partId,
      isFastener: computePartMetrics(part.frame.obb.halfExtents, validation.config).isFastener,
      principalAxis: part.frame.axes[0],
      obbCenter: part.frame.obb.center,
      obbHalfExtents: part.frame.obb.halfExtents,
    };
    const selected = registry.select(step, info, context);
    if (!selected.ok) {
      return { ok: false, error: selected.error };
    }
    steps.push({
      partId: step.partId,
      primitive: selected.value.name,
      params: selected.value.buildParams(step, info, context),
    });
  }
  return { ok: true, steps };
}
