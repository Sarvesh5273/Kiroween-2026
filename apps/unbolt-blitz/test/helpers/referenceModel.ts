/**
 * An independent reference model of the Blitz rules, for comparison with the engine.
 *
 * It re-derives scoring, blocked attempts, false alarms and the deadlock oracle
 * straight from the rules, and it shares no code with `src/game`. The numbers
 * are written out here on purpose (100 x combo, +50 fastener, combo cap 8,
 * +3000 ms penalty, -250 floored at 0, +1000 for a real deadlock), so a wrong
 * constant in the engine shows up as a difference.
 *
 * It also holds an independent AABB overlap test, a sweep-based escape
 * distance, an angle function and a Kahn-style dependency checker.
 *
 * No randomness lives here except through the `Rng` a caller passes in.
 */
import type { Vec3 } from "@unboltkit/core";
import type { Aabb, EngineEdge, EngineLevelInput, EnginePart } from "../../src/game/blitzEngine";
import type { Rng } from "./prng";

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Overlap and contact tolerance: boxes that overlap by 1e-9 or less count as touching. */
export const REF_TOLERANCE = 1e-9;

/** True when `a` and `b` overlap by more than `tol` on every axis. Touching boxes do not overlap. */
export function aabbOverlap(a: Aabb, b: Aabb, tol: number = REF_TOLERANCE): boolean {
  for (let j = 0; j < 3; j++) {
    const depth = Math.min(a.max[j] as number, b.max[j] as number) - Math.max(a.min[j] as number, b.min[j] as number);
    if (!(depth > tol)) return false;
  }
  return true;
}

/** `box` moved by `s * dir`. */
export function translateAabb(box: Aabb, dir: Vec3, s: number): Aabb {
  return {
    min: [box.min[0] + s * dir[0], box.min[1] + s * dir[1], box.min[2] + s * dir[2]],
    max: [box.max[0] + s * dir[0], box.max[1] + s * dir[1], box.max[2] + s * dir[2]],
  };
}

/**
 * Escape distance by sweeping: collect every travel distance at which a face of
 * `box` meets a face of another box, look at the middle of each gap between
 * them, and return the end of the last gap in which `box` overlaps something.
 * Returns 0 when `box` never overlaps anything on the way out.
 */
export function referenceEscapeDistance(box: Aabb, dir: Vec3, others: readonly Aabb[]): number {
  const breakpoints = new Set<number>([0]);
  for (const other of others) {
    for (let j = 0; j < 3; j++) {
      const d = dir[j] as number;
      if (Math.abs(d) < 1e-12) continue;
      breakpoints.add(((other.min[j] as number) - (box.max[j] as number)) / d);
      breakpoints.add(((other.max[j] as number) - (box.min[j] as number)) / d);
    }
  }
  const sorted = [...breakpoints].filter((s) => Number.isFinite(s) && s >= 0).sort((x, y) => x - y);
  let escape = 0;
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted[i - 1] as number;
    const hi = sorted[i] as number;
    const moved = translateAabb(box, dir, (lo + hi) / 2);
    if (others.some((other) => aabbOverlap(moved, other))) escape = Math.max(escape, hi);
  }
  return escape;
}

/** Angle between two lines in degrees, in [0, 90]. A vector and its negative give 0. */
export function lineAngleDeg(a: Vec3, b: Vec3): number {
  const cross: Vec3 = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const crossLength = Math.hypot(cross[0], cross[1], cross[2]);
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const degrees = (Math.atan2(crossLength, dot) * 180) / Math.PI;
  return Math.min(degrees, 180 - degrees);
}

/** A fastener unscrews when the exit axis lies within `toleranceDeg` of its principal axis, either sign. */
export function referenceIsAligned(part: EnginePart, dir: Vec3, toleranceDeg = 5): boolean {
  return part.isFastener && lineAngleDeg(dir, part.principalAxis) <= toleranceDeg;
}

// ---------------------------------------------------------------------------
// Dependency checks (Kahn style)
// ---------------------------------------------------------------------------

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** For each part and axis, every part that blocks that axis, ignoring removals. */
function blockerTable(level: EngineLevelInput): Map<string, Set<string>[]> {
  const table = new Map<string, Set<string>[]>();
  for (const part of level.parts) {
    table.set(
      part.partId,
      part.candidateAxes.map(() => new Set<string>()),
    );
  }
  for (const edge of level.edges) {
    table.get(edge.from)?.[edge.dirIndex]?.add(edge.to);
  }
  return table;
}

function canLeave(perAxis: readonly Set<string>[], removed: ReadonlySet<string>): boolean {
  return perAxis.some((ids) => [...ids].every((id) => removed.has(id)));
}

export interface KahnResult {
  /** Rounds of parts that become removable together, each sorted. */
  layers: string[][];
  /** Parts that never become removable, sorted. */
  residual: string[];
}

/** Repeatedly removes every part that has an axis with no unremoved blocker. */
export function kahnLayers(level: EngineLevelInput): KahnResult {
  const table = blockerTable(level);
  const removed = new Set<string>();
  const layers: string[][] = [];
  for (;;) {
    const layer = level.parts
      .map((part) => part.partId)
      .filter((id) => !removed.has(id) && canLeave(table.get(id) as Set<string>[], removed))
      .sort(compareIds);
    if (layer.length === 0) break;
    layers.push(layer);
    for (const id of layer) removed.add(id);
  }
  const residual = level.parts
    .map((part) => part.partId)
    .filter((id) => !removed.has(id))
    .sort(compareIds);
  return { layers, residual };
}

export interface OrderCheck {
  valid: boolean;
  /** Index in `order` of the first problem, or null when valid. */
  failureIndex: number | null;
  reason: string | null;
}

/**
 * Checks that `order` removes parts one by one, each with some axis whose
 * blockers all left earlier. With `complete` true (the default) the order must
 * also name every part exactly once.
 */
export function checkRemovalOrder(level: EngineLevelInput, order: readonly string[], complete = true): OrderCheck {
  const table = blockerTable(level);
  const removed = new Set<string>();
  for (let i = 0; i < order.length; i++) {
    const id = order[i] as string;
    const perAxis = table.get(id);
    if (perAxis === undefined) return { valid: false, failureIndex: i, reason: `unknown part ${id}` };
    if (removed.has(id)) return { valid: false, failureIndex: i, reason: `part ${id} listed twice` };
    if (!canLeave(perAxis, removed)) {
      return { valid: false, failureIndex: i, reason: `part ${id} has no axis cleared by the earlier removals` };
    }
    removed.add(id);
  }
  if (complete && removed.size !== level.parts.length) {
    return { valid: false, failureIndex: order.length, reason: "order does not name every part" };
  }
  return { valid: true, failureIndex: null, reason: null };
}

/**
 * A seeded random valid removal order: at each step pick a random part that
 * currently has a clear axis. `residual` lists the parts left when none can move.
 */
export function randomValidOrder(rng: Rng, level: EngineLevelInput): { order: string[]; residual: string[] } {
  const table = blockerTable(level);
  const removed = new Set<string>();
  const order: string[] = [];
  for (;;) {
    const removable = level.parts
      .map((part) => part.partId)
      .filter((id) => !removed.has(id) && canLeave(table.get(id) as Set<string>[], removed))
      .sort(compareIds);
    if (removable.length === 0) break;
    const pick = removable[Math.min(removable.length - 1, Math.floor(rng() * removable.length))] as string;
    removed.add(pick);
    order.push(pick);
  }
  const residual = level.parts
    .map((part) => part.partId)
    .filter((id) => !removed.has(id))
    .sort(compareIds);
  return { order, residual };
}

// ---------------------------------------------------------------------------
// The rules model
// ---------------------------------------------------------------------------

export type RefOutcome = "victory" | "interlock_exposed";

export interface RefState {
  readonly removed: ReadonlySet<string>;
  readonly score: number;
  readonly combo: number;
  readonly mistakes: number;
  readonly falseAlarms: number;
  readonly penaltyMs: number;
  readonly outcome: RefOutcome | null;
}

export type RefUnbolt =
  | {
      kind: "legal";
      axisIndex: number;
      escapeDistance: number;
      awarded: number;
      comboBefore: number;
      comboAfter: number;
      completed: boolean;
    }
  | { kind: "blocked"; axisIndex: number; blockerIds: string[]; comboBefore: number }
  | { kind: "rejected"; reason: "unknown_part" | "not_live" | "level_complete" };

export type RefTrap =
  | { kind: "exposed"; sccs: string[][] }
  | { kind: "false_alarm"; penaltyApplied: number }
  | { kind: "rejected" };

export interface ReferenceModel {
  initial(): RefState;
  /** Axis indexes of `partId` with no unremoved blocker, ascending. */
  clearAxes(state: RefState, partId: string): number[];
  /** Live parts that have at least one clear axis, sorted. */
  removable(state: RefState): string[];
  unbolt(state: RefState, partId: string): { state: RefState; result: RefUnbolt };
  flag(state: RefState): { state: RefState; result: RefTrap };
  /**
   * The deadlock oracle. Peels every live part that can eventually leave, then
   * groups what remains into strongly connected components (two parts are in
   * the same group when each can reach the other through blocking edges).
   * Returns the groups of 2 or more parts, sorted. Empty means no real deadlock.
   */
  deadlockOracle(state: RefState): string[][];
}

/** Builds the reference model for one level. */
export function createReferenceModel(level: EngineLevelInput): ReferenceModel {
  const table = blockerTable(level);
  const partsById = new Map<string, EnginePart>(level.parts.map((part) => [part.partId, part]));

  const unremoved = (state: RefState, partId: string): string[][] =>
    (table.get(partId) as Set<string>[]).map((ids) => [...ids].filter((id) => !state.removed.has(id)).sort(compareIds));

  const clearAxes = (state: RefState, partId: string): number[] => {
    const axes: number[] = [];
    unremoved(state, partId).forEach((ids, k) => {
      if (ids.length === 0) axes.push(k);
    });
    return axes;
  };

  const livePartIds = (state: RefState): string[] =>
    level.parts
      .map((part) => part.partId)
      .filter((id) => !state.removed.has(id))
      .sort(compareIds);

  const deadlockOracle = (state: RefState): string[][] => {
    // Peel: a live part leaves when some axis has no blocker among the parts still present.
    const present = new Set(livePartIds(state));
    let progress = true;
    while (progress) {
      progress = false;
      for (const id of [...present]) {
        const perAxis = table.get(id) as Set<string>[];
        if (perAxis.some((ids) => [...ids].every((blocker) => !present.has(blocker)))) {
          present.delete(id);
          progress = true;
        }
      }
    }
    const stuck = [...present].sort(compareIds);
    if (stuck.length === 0) return [];

    // Edges among the stuck parts, then mutual reachability.
    const out = new Map<string, Set<string>>(stuck.map((id) => [id, new Set<string>()]));
    for (const edge of level.edges as readonly EngineEdge[]) {
      if (present.has(edge.from) && present.has(edge.to) && edge.from !== edge.to) {
        (out.get(edge.from) as Set<string>).add(edge.to);
      }
    }
    const reach = (start: string): Set<string> => {
      const seen = new Set<string>([start]);
      const queue = [start];
      while (queue.length > 0) {
        const v = queue.shift() as string;
        for (const w of out.get(v) as Set<string>) {
          if (!seen.has(w)) {
            seen.add(w);
            queue.push(w);
          }
        }
      }
      return seen;
    };
    const reachable = new Map<string, Set<string>>(stuck.map((id) => [id, reach(id)]));
    const assigned = new Set<string>();
    const groups: string[][] = [];
    for (const id of stuck) {
      if (assigned.has(id)) continue;
      const group = stuck.filter(
        (other) => (reachable.get(id) as Set<string>).has(other) && (reachable.get(other) as Set<string>).has(id),
      );
      for (const member of group) assigned.add(member);
      if (group.length >= 2) groups.push(group);
    }
    return groups.sort((a, b) => compareIds(a[0] as string, b[0] as string));
  };

  return {
    initial() {
      return { removed: new Set<string>(), score: 0, combo: 1, mistakes: 0, falseAlarms: 0, penaltyMs: 0, outcome: null };
    },

    deadlockOracle,

    clearAxes,

    removable(state) {
      return livePartIds(state).filter((id) => clearAxes(state, id).length > 0);
    },

    unbolt(state, partId) {
      if (state.outcome !== null) return { state, result: { kind: "rejected", reason: "level_complete" } };
      const part = partsById.get(partId);
      if (part === undefined) return { state, result: { kind: "rejected", reason: "unknown_part" } };
      if (state.removed.has(partId)) return { state, result: { kind: "rejected", reason: "not_live" } };

      const perAxis = unremoved(state, partId);
      const clear = clearAxes(state, partId);

      if (clear.length === 0) {
        // Blocked: report the axis with the fewest unremoved blockers, lowest index on a tie.
        let axisIndex = 0;
        perAxis.forEach((ids, k) => {
          if (ids.length < (perAxis[axisIndex] as string[]).length) axisIndex = k;
        });
        const mistakes = state.mistakes + 1;
        const next: RefState = {
          ...state,
          combo: 1,
          mistakes,
          penaltyMs: 3000 * (mistakes + state.falseAlarms),
        };
        return {
          state: next,
          result: { kind: "blocked", axisIndex, blockerIds: perAxis[axisIndex] as string[], comboBefore: state.combo },
        };
      }

      // Legal: the clear axis with the smallest escape distance, lowest index on a tie within 1e-9.
      const others: Aabb[] = level.parts
        .filter((other) => other.partId !== partId && !state.removed.has(other.partId))
        .map((other) => other.aabb);
      let axisIndex = clear[0] as number;
      let best = Infinity;
      for (const k of clear) {
        const distance = referenceEscapeDistance(part.aabb, part.candidateAxes[k] as Vec3, others);
        if (distance < best - REF_TOLERANCE) {
          best = distance;
          axisIndex = k;
        }
      }
      const awarded = 100 * state.combo + (part.isFastener ? 50 : 0);
      const removed = new Set(state.removed);
      removed.add(partId);
      const completed = removed.size === level.parts.length;
      const comboAfter = Math.min(8, state.combo + 1);
      const next: RefState = {
        ...state,
        removed,
        score: state.score + awarded,
        combo: comboAfter,
        outcome: completed ? "victory" : null,
      };
      return {
        state: next,
        result: { kind: "legal", axisIndex, escapeDistance: best, awarded, comboBefore: state.combo, comboAfter, completed },
      };
    },

    flag(state) {
      if (state.outcome !== null) return { state, result: { kind: "rejected" } };
      const sccs = deadlockOracle(state);
      if (sccs.length > 0) {
        return {
          state: { ...state, score: state.score + 1000, outcome: "interlock_exposed" },
          result: { kind: "exposed", sccs },
        };
      }
      const score = Math.max(0, state.score - 250);
      const falseAlarms = state.falseAlarms + 1;
      return {
        state: {
          ...state,
          combo: 1,
          score,
          falseAlarms,
          penaltyMs: 3000 * (state.mistakes + falseAlarms),
        },
        result: { kind: "false_alarm", penaltyApplied: state.score - score },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Comparing with the engine
// ---------------------------------------------------------------------------

/** The fields shared by `EngineState` and `RefState`. */
export interface ComparableState {
  readonly removed: ReadonlySet<string>;
  readonly score: number;
  readonly combo: number;
  readonly mistakes: number;
  readonly falseAlarms: number;
  readonly penaltyMs: number;
  readonly outcome: string | null;
}

/** Returns a description of the first field that differs, or null when the two states agree. */
export function describeMismatch(actual: ComparableState, expected: RefState): string | null {
  const fields = ["score", "combo", "mistakes", "falseAlarms", "penaltyMs", "outcome"] as const;
  for (const field of fields) {
    if (actual[field] !== expected[field]) {
      return `${field}: engine ${String(actual[field])}, reference ${String(expected[field])}`;
    }
  }
  const a = [...actual.removed].sort(compareIds).join(",");
  const e = [...expected.removed].sort(compareIds).join(",");
  return a === e ? null : `removed: engine [${a}], reference [${e}]`;
}
