/**
 * Compile-time checks for the public result types (Req 30.3, 30.4). Vitest does not run this
 * file (its name does not match `*.test.ts`); `tsc --noEmit` checks it. Every `@ts-expect-error`
 * below must sit on a line that really is a type error, or `tsc` reports an unused directive.
 *
 * All types are imported from the package root specifier, with no path into `src/`.
 */
import type {
  CoreError,
  DeadlockedPlan,
  DeadlockWitness,
  DisassemblyPlan,
  EmptyAssemblyError,
  InvalidGeometryError,
  MonolithicMeshError,
  ConfigurationError,
  MotionPrimitive,
  PlanStep,
  SamplingMetadata,
  SolvedPlan,
  SolverConfig,
  TrajectoryStep,
} from "@unboltkit/core";

/** Exact type equality, so a widened or narrowed alias fails the build. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function assertType<_T extends true>(): void {
  // Compile-time only.
}

// Req 30.4: the status is exactly this literal union.
assertType<Equal<DisassemblyPlan["status"], "solved" | "deadlocked" | "error">>();

/** Every type that Req 30.3 requires at the package root is importable and usable. */
export type RequiredRootTypes = [
  DisassemblyPlan,
  PlanStep,
  DeadlockWitness,
  MonolithicMeshError,
  EmptyAssemblyError,
  InvalidGeometryError,
  ConfigurationError,
  SolverConfig,
  SamplingMetadata,
  TrajectoryStep,
  MotionPrimitive,
];

export function narrowingChecks(plan: DisassemblyPlan): void {
  // Before narrowing, `steps`, `witness` and `error` are not reachable.
  // @ts-expect-error `steps` does not exist on the error variant.
  void plan.steps;
  // @ts-expect-error `witness` exists only on the deadlocked variant.
  void plan.witness;
  // @ts-expect-error `error` exists only on the error variant.
  void plan.error;
  // Fields that every variant has stay reachable.
  const status: "solved" | "deadlocked" | "error" = plan.status;
  void status;
  void plan.diagnostics;

  if (plan.status === "solved") {
    assertType<Equal<typeof plan, SolvedPlan>>();
    const steps: PlanStep[] = plan.steps;
    void steps;
    // @ts-expect-error `witness` is not on a solved plan.
    void plan.witness;
    // @ts-expect-error `error` is not on a solved plan.
    void plan.error;
  } else if (plan.status === "deadlocked") {
    assertType<Equal<typeof plan, DeadlockedPlan>>();
    // Plan_Steps completed before the deadlock stay reachable (Req 16.1).
    const steps: PlanStep[] = plan.steps;
    const witness: DeadlockWitness = plan.witness;
    void steps;
    void witness;
    // @ts-expect-error `error` is not on a deadlocked plan.
    void plan.error;
  } else {
    const error: CoreError = plan.error;
    void error;
    // @ts-expect-error `steps` is not on an error result.
    void plan.steps;
    // @ts-expect-error `witness` is not on an error result.
    void plan.witness;
  }

  // Narrowing on `!== "error"` reaches `steps`, but `witness` still needs the deadlocked check.
  if (plan.status !== "error") {
    const steps: PlanStep[] = plan.steps;
    void steps;
    // @ts-expect-error `witness` is on only one of the two remaining variants.
    void plan.witness;
  }
}

/** A `switch` on `status` is exhaustive. Adding a fourth status to the union would break this function. */
export function exhaustive(plan: DisassemblyPlan): string {
  switch (plan.status) {
    case "solved":
      return `solved with ${plan.steps.length} steps`;
    case "deadlocked":
      return `deadlocked with ${plan.witness.sccs.length} SCCs`;
    case "error":
      return plan.error.kind;
  }
}
