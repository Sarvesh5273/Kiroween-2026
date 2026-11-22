import { createDefaultPrimitiveRegistry } from "@unboltkit/core";
import type { Pose, PrimitiveRegistry, TrajectoryStep } from "@unboltkit/core";
import { Matrix4 } from "three";
import type { Mesh } from "three";

export interface ExitAnimation {
  partId: string;
  mesh: Mesh;
  step: TrajectoryStep;
  /** Start time in milliseconds, normally the `at` of the `part_removed` event. */
  startMs: number;
  durationMs: number;
}

/** `clamp((now - start) / duration, 0, 1)`. A non-positive duration is finished at its start. */
export function exitProgress(startMs: number, durationMs: number, nowMs: number): number {
  if (!(durationMs > 0)) return nowMs >= startMs ? 1 : 0;
  const t = (nowMs - startMs) / durationMs;
  return Math.min(1, Math.max(0, t));
}

/** Matrix of the rigid motion `x -> R*x + T` from a row-major rotation. */
export function poseToMatrix(pose: Pose): Matrix4 {
  const r = pose.rotation;
  if (r.length !== 9) {
    throw new RangeError(`Pose rotation must hold 9 numbers, got ${r.length}.`);
  }
  const t = pose.translation;
  return new Matrix4().set(
    r[0] as number, r[1] as number, r[2] as number, t[0],
    r[3] as number, r[4] as number, r[5] as number, t[1],
    r[6] as number, r[7] as number, r[8] as number, t[2],
    0, 0, 0, 1,
  );
}

/**
 * Runs any number of exit animations at once. Each animation reads only its own
 * start time, and nothing here locks input (Req 11.6, 11.7). A missing
 * primitive or a throwing `pose` is an internal error and propagates.
 */
export class ExitAnimator {
  private readonly active = new Map<string, ExitAnimation>();

  constructor(private readonly registry: PrimitiveRegistry = createDefaultPrimitiveRegistry()) {}

  /** Starts an animation. Throws `RangeError` when the part is already animating. */
  start(animation: ExitAnimation): void {
    if (this.active.has(animation.partId)) {
      throw new RangeError(`Part "${animation.partId}" already has an exit animation.`);
    }
    this.active.set(animation.partId, animation);
  }

  has(partId: string): boolean {
    return this.active.has(partId);
  }

  get activeCount(): number {
    return this.active.size;
  }

  /**
   * Applies the pose of every running animation for `nowMs` and returns the ids
   * that reached t = 1. Those animations are dropped after their final pose is applied.
   */
  update(nowMs: number): { finished: string[] } {
    const finished: string[] = [];
    for (const animation of this.active.values()) {
      const t = exitProgress(animation.startMs, animation.durationMs, nowMs);
      const found = this.registry.get(animation.step.primitive);
      if (!found.ok) {
        throw new Error(
          `Primitive "${animation.step.primitive}" for part "${animation.partId}" is not registered.`,
        );
      }
      const pose = found.value.pose(t, animation.step.params);
      const mesh = animation.mesh;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(poseToMatrix(pose));
      mesh.matrixWorldNeedsUpdate = true;
      if (t >= 1) finished.push(animation.partId);
    }
    for (const partId of finished) this.active.delete(partId);
    return { finished };
  }

  /** Drops every animation without applying a pose. */
  clear(): void {
    this.active.clear();
  }
}
