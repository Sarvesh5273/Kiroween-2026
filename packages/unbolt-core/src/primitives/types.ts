import type { ResolvedSolverConfig } from "../config";
import type { PlanStep, Pose, PrimitiveParams, RegistryResult, Vec3 } from "../types";

/** What a primitive may read of the Part that a Plan_Step moves. Computed from Stage 1 data. */
export interface PrimitivePartInfo {
  partId: string;
  isFastener: boolean;
  /** PCA1, the Part's principal axis (unit). */
  principalAxis: Vec3;
  obbCenter: Vec3;
  obbHalfExtents: Vec3;
}

export interface PrimitiveContext {
  config: ResolvedSolverConfig;
}

/**
 * A named, parameterized rigid-motion generator (Req 17.3).
 *
 * The members use method syntax on purpose: a `MotionPrimitive<LinearSlideParams>` can then be
 * registered where a plain `MotionPrimitive` is expected.
 */
export interface MotionPrimitive<P extends PrimitiveParams = PrimitiveParams> {
  /** 1 to 64 characters: `/^[a-z][a-z0-9_]{0,63}$/`. */
  name: string;
  /** A finite number. Higher priority is tried first. */
  priority: number;
  isApplicable(step: PlanStep, part: PrimitivePartInfo, ctx: PrimitiveContext): boolean;
  buildParams(step: PlanStep, part: PrimitivePartInfo, ctx: PrimitiveContext): P;
  /**
   * The pose at `t` in `[0, 1]`, acting as `x ↦ R·x + T`.
   * @throws PrimitiveRangeError when `t` is not finite or is outside `[0, 1]`.
   * @throws PrimitiveParamError when `params` is invalid.
   */
  pose(t: number, params: P): Pose;
}

export interface PrimitiveRegistry {
  /** Rejected registrations leave the registry unchanged. */
  register(primitive: MotionPrimitive): RegistryResult<void>;
  /** Exact, case-sensitive lookup. */
  get(name: string): RegistryResult<MotionPrimitive>;
  /** Priority descending, then name ascending by UTF-16 code unit. Computed on every call. */
  list(): readonly MotionPrimitive[];
  /** The first listed primitive whose `isApplicable` returns `true` (Req 17.9). */
  select(step: PlanStep, part: PrimitivePartInfo, ctx: PrimitiveContext): RegistryResult<MotionPrimitive>;
}

export type LinearSlideParams = Extract<PrimitiveParams, { kind: "linear_slide" }>;
export type HelicalUnscrewParams = Extract<PrimitiveParams, { kind: "helical_unscrew" }>;
export type TwoStepLSlideParams = Extract<PrimitiveParams, { kind: "two_step_l_slide" }>;
