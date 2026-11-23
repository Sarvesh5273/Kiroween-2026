/**
 * Pure rules engine for Unbolt Blitz (Req 4 to 7).
 *
 * Every function is a pure function over an immutable `EngineState`. The module
 * holds no DOM, React or Three.js import and only `import type` from
 * `@unboltkit/core`. The primitive registry and context arrive by injection
 * (see `src/engineDeps.ts`), so Core alone decides whether a fastener unscrews.
 */
import type {
  LinearSlideParams,
  PlanStep,
  PrimitiveContext,
  PrimitiveRegistry,
  TrajectoryStep,
  Vec3,
} from "@unboltkit/core";
import { escapeDistance as measureEscapeDistance, TOUCH } from "./axisMath";
import type { Aabb } from "./axisMath";
import {
  BASE_POINTS,
  COMBO_CAP,
  ESCAPE_TIE_TOLERANCE,
  EXIT_TRAVEL_FLOOR,
  FALSE_ALARM_PENALTY,
  FASTENER_BONUS,
  TIME_PENALTY_MS,
  TRAP_BONUS,
} from "./scoring";

export type { Aabb } from "./axisMath";

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

export interface EnginePart {
  partId: string;
  displayName: string;
  isFastener: boolean;
  principalAxis: Vec3;
  obb: { center: Vec3; halfExtents: Vec3 };
  aabb: Aabb;
  candidateAxes: readonly Vec3[];
}

/** `from` is blocked by `to` along candidate axis `dirIndex` of `from`. */
export interface EngineEdge {
  from: string;
  to: string;
  dirIndex: number;
}

export interface EngineLevelInput {
  parts: readonly EnginePart[];
  /** graph.edges united with the witness edges, deduplicated (design D4). */
  edges: readonly EngineEdge[];
  /** plan.witness.sccs[].partIds, or an empty list for a solved plan. */
  deadlockSccs: readonly (readonly string[])[];
}

export interface EngineLevel extends EngineLevelInput {
  readonly partsById: ReadonlyMap<string, EnginePart>;
  /** blockers.get(partId)[dirIndex] = sorted unique ids of the parts that block that axis. */
  readonly blockers: ReadonlyMap<string, readonly (readonly string[])[]>;
  readonly registry: PrimitiveRegistry;
  readonly ctx: PrimitiveContext;
}

export interface EngineDeps {
  registry: PrimitiveRegistry;
  ctx: PrimitiveContext;
}

export type LevelOutcome = "victory" | "interlock_exposed";

export interface EngineState {
  readonly level: EngineLevel;
  readonly removed: ReadonlySet<string>;
  readonly score: number;
  readonly combo: number;
  readonly mistakes: number;
  readonly falseAlarms: number;
  readonly penaltyMs: number;
  readonly outcome: LevelOutcome | null;
}

export type UnboltResult =
  | {
      kind: "legal";
      partId: string;
      axisIndex: number;
      dir: Vec3;
      escapeDistance: number;
      aligned: boolean;
      step: TrajectoryStep;
      points: number;
      fastenerBonus: number;
      awarded: number;
      comboBefore: number;
      comboAfter: number;
      completed: boolean;
    }
  | {
      kind: "blocked";
      partId: string;
      axisIndex: number;
      blockerIds: string[];
      comboBefore: number;
      comboAfter: 1;
      penaltyMs: 3000;
      mistakes: number;
    }
  | { kind: "rejected"; partId: string; reason: "unknown_part" | "not_live" | "level_complete" };

export type TrapResult =
  | { kind: "exposed"; bonus: 1000; sccs: string[][]; scoreAfter: number; completed: true }
  | {
      kind: "false_alarm";
      comboBefore: number;
      scoreBefore: number;
      scoreAfter: number;
      penaltyApplied: number;
      penaltyMs: 3000;
      falseAlarms: number;
    }
  | { kind: "rejected"; reason: "level_complete" };

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Code-unit comparison, so ordering never depends on the runtime locale. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Validates `input` and builds the static indexes.
 * Throws `RangeError` for a duplicate part id, a part without candidate axes,
 * an edge that names an unknown part, or an edge `dirIndex` outside the
 * candidate axes of its `from` part.
 */
export function createEngineLevel(input: EngineLevelInput, deps: EngineDeps): EngineLevel {
  const partsById = new Map<string, EnginePart>();
  for (const part of input.parts) {
    if (partsById.has(part.partId)) {
      throw new RangeError(`Duplicate part id "${part.partId}".`);
    }
    if (part.candidateAxes.length === 0) {
      throw new RangeError(`Part "${part.partId}" has no candidate axes.`);
    }
    partsById.set(part.partId, part);
  }

  const blockerSets = new Map<string, Set<string>[]>();
  for (const part of input.parts) {
    blockerSets.set(
      part.partId,
      part.candidateAxes.map(() => new Set<string>()),
    );
  }
  for (const edge of input.edges) {
    const from = partsById.get(edge.from);
    if (from === undefined) throw new RangeError(`Edge names unknown part "${edge.from}".`);
    if (!partsById.has(edge.to)) throw new RangeError(`Edge names unknown part "${edge.to}".`);
    if (!Number.isInteger(edge.dirIndex) || edge.dirIndex < 0 || edge.dirIndex >= from.candidateAxes.length) {
      throw new RangeError(`Edge dirIndex ${edge.dirIndex} is outside the candidate axes of "${edge.from}".`);
    }
    (blockerSets.get(edge.from) as Set<string>[])[edge.dirIndex]?.add(edge.to);
  }

  const blockers = new Map<string, readonly (readonly string[])[]>();
  for (const [partId, perAxis] of blockerSets) {
    blockers.set(
      partId,
      perAxis.map((ids) => [...ids].sort(compareIds)),
    );
  }

  return {
    parts: input.parts,
    edges: input.edges,
    deadlockSccs: input.deadlockSccs,
    partsById,
    blockers,
    registry: deps.registry,
    ctx: deps.ctx,
  };
}

/** The initial state: score 0, combo 1, no counters, nothing removed, no outcome. */
export function createEngine(level: EngineLevel): EngineState {
  return {
    level,
    removed: new Set<string>(),
    score: 0,
    combo: 1,
    mistakes: 0,
    falseAlarms: 0,
    penaltyMs: 0,
    outcome: null,
  };
}

// ---------------------------------------------------------------------------
// Read-only queries
// ---------------------------------------------------------------------------

/** Ids of the parts that are still in the assembly, ascending. */
export function liveParts(s: EngineState): readonly string[] {
  const ids: string[] = [];
  for (const part of s.level.parts) {
    if (!s.removed.has(part.partId)) ids.push(part.partId);
  }
  return ids.sort(compareIds);
}

/** Edges whose blocker has not been removed yet. */
export function activeEdges(s: EngineState): readonly EngineEdge[] {
  return s.level.edges.filter((edge) => !s.removed.has(edge.to));
}

/** For each candidate axis of `partId`, the sorted ids of its unremoved blockers. Empty for an unknown part. */
export function unremovedBlockers(s: EngineState, partId: string): readonly (readonly string[])[] {
  const perAxis = s.level.blockers.get(partId);
  if (perAxis === undefined) return [];
  return perAxis.map((ids) => ids.filter((id) => !s.removed.has(id)));
}

/** Candidate axis indexes of `partId` that have no unremoved blocker, ascending. */
export function clearAxes(s: EngineState, partId: string): readonly number[] {
  const axes: number[] = [];
  unremovedBlockers(s, partId).forEach((ids, dirIndex) => {
    if (ids.length === 0) axes.push(dirIndex);
  });
  return axes;
}

/** Deadlock SCCs whose members are all still live (a Genuine_Deadlock). */
export function genuineDeadlockSccs(s: EngineState): readonly (readonly string[])[] {
  return s.level.deadlockSccs.filter((scc) => scc.every((id) => !s.removed.has(id)));
}

/** True when at least one part is live and no live part has a Clear_Axis. */
export function allLiveBlocked(s: EngineState): boolean {
  let anyLive = false;
  for (const part of s.level.parts) {
    if (s.removed.has(part.partId)) continue;
    anyLive = true;
    if (clearAxes(s, part.partId).length > 0) return false;
  }
  return anyLive;
}

export function removedCount(s: EngineState): number {
  return s.removed.size;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Escape_Distance along each given axis, measured against the other live parts. */
function escapeDistances(s: EngineState, part: EnginePart, axes: readonly number[]): Map<number, number> {
  const others: Aabb[] = [];
  for (const other of s.level.parts) {
    if (other.partId !== part.partId && !s.removed.has(other.partId)) others.push(other.aabb);
  }
  const distances = new Map<number, number>();
  for (const axis of axes) {
    distances.set(axis, measureEscapeDistance(part.aabb, part.candidateAxes[axis] as Vec3, others));
  }
  return distances;
}

/**
 * The trajectory of `part` along candidate axis `axisIndex` as the Arena animates it: the
 * primitive the registry selects, with a travel of `max(escape, EXIT_TRAVEL_FLOOR)`.
 */
function buildExitStep(state: EngineState, part: EnginePart, axisIndex: number, escape: number): TrajectoryStep {
  const dir = part.candidateAxes[axisIndex] as Vec3;
  const planStep: PlanStep = {
    partId: part.partId,
    dir,
    dirIndex: axisIndex,
    escapeDistance: Math.max(escape, EXIT_TRAVEL_FLOOR),
    secondary: null,
  };
  const info = {
    partId: part.partId,
    isFastener: part.isFastener,
    principalAxis: part.principalAxis,
    obbCenter: part.obb.center,
    obbHalfExtents: part.obb.halfExtents,
  };
  const selected = state.level.registry.select(planStep, info, state.level.ctx);
  if (!selected.ok) throw new RangeError(selected.error.message);
  const primitive = selected.value;
  return {
    partId: part.partId,
    primitive: primitive.name,
    params: primitive.buildParams(planStep, info, state.level.ctx),
  };
}

/**
 * Removes `part` with `step` and scores it: `BASE_POINTS * combo`, plus the fastener bonus, then
 * combo + 1 (capped). The automatic click and a checked explicit attempt both score through here,
 * and the part leaves the live set here, so a part can be scored only once.
 */
function awardRemoval(
  state: EngineState,
  part: EnginePart,
  axisIndex: number,
  escape: number,
  step: TrajectoryStep,
): { state: EngineState; result: Extract<UnboltResult, { kind: "legal" }> } {
  const dir = part.candidateAxes[axisIndex] as Vec3;
  const points = BASE_POINTS * state.combo;
  const fastenerBonus = part.isFastener ? FASTENER_BONUS : 0;
  const removed = new Set(state.removed);
  removed.add(part.partId);
  const completed = removed.size === state.level.parts.length;
  const comboAfter = Math.min(COMBO_CAP, state.combo + 1);
  const next: EngineState = {
    ...state,
    removed,
    score: state.score + points + fastenerBonus,
    combo: comboAfter,
    outcome: completed ? "victory" : null,
  };
  return {
    state: next,
    result: {
      kind: "legal",
      partId: part.partId,
      axisIndex,
      dir: [dir[0], dir[1], dir[2]],
      escapeDistance: escape,
      aligned: step.primitive === "helical_unscrew",
      step,
      points,
      fastenerBonus,
      awarded: points + fastenerBonus,
      comboBefore: state.combo,
      comboAfter,
      completed,
    },
  };
}

/** A blocked attempt: combo 1, one more mistake and the time penalty. */
function blockAttempt(
  state: EngineState,
  partId: string,
  axisIndex: number,
  blockerIds: readonly string[],
): { state: EngineState; result: Extract<UnboltResult, { kind: "blocked" }> } {
  const next: EngineState = {
    ...state,
    combo: 1,
    mistakes: state.mistakes + 1,
    penaltyMs: state.penaltyMs + TIME_PENALTY_MS,
  };
  return {
    state: next,
    result: {
      kind: "blocked",
      partId,
      axisIndex,
      blockerIds: [...blockerIds].sort(compareIds),
      comboBefore: state.combo,
      comboAfter: 1,
      penaltyMs: TIME_PENALTY_MS,
      mistakes: next.mistakes,
    },
  };
}

/** Why a part cannot be attempted at all. `null` when it can. */
function rejectionOf(state: EngineState, partId: string): "unknown_part" | "not_live" | "level_complete" | null {
  if (state.outcome !== null) return "level_complete";
  if (!state.level.partsById.has(partId)) return "unknown_part";
  if (state.removed.has(partId)) return "not_live";
  return null;
}

/**
 * Tries to unbolt `partId`.
 *
 * Legal when some candidate axis has no unremoved blocker. The exit axis is the
 * clear axis with the smallest Escape_Distance, ties to the lowest `dirIndex`.
 * Otherwise the attempt is blocked, reporting the blockers of the axis with the
 * fewest of them. A rejected call returns the identical `state` object.
 */
export function attemptUnbolt(
  state: EngineState,
  partId: string,
): { state: EngineState; result: UnboltResult } {
  const reason = rejectionOf(state, partId);
  if (reason !== null) return { state, result: { kind: "rejected", partId, reason } };
  const part = state.level.partsById.get(partId) as EnginePart;

  const perAxis = unremovedBlockers(state, partId);
  const clear = clearAxes(state, partId);

  if (clear.length === 0) {
    let bestAxis = 0;
    let bestCount = Infinity;
    perAxis.forEach((ids, dirIndex) => {
      if (ids.length < bestCount) {
        bestCount = ids.length;
        bestAxis = dirIndex;
      }
    });
    return blockAttempt(state, partId, bestAxis, perAxis[bestAxis] as readonly string[]);
  }

  const distances = escapeDistances(state, part, clear);
  let minimum = Infinity;
  for (const distance of distances.values()) minimum = Math.min(minimum, distance);
  const axisIndex = clear.find(
    (axis) => (distances.get(axis) as number) <= minimum + ESCAPE_TIE_TOLERANCE,
  ) as number;
  const escape = distances.get(axisIndex) as number;
  return awardRemoval(state, part, axisIndex, escape, buildExitStep(state, part, axisIndex, escape));
}

// ---------------------------------------------------------------------------
// Explicit attempts: the player names the axis
// ---------------------------------------------------------------------------

/** The six model axes a player can name, as candidate-axis indexes 0 to 5 (+X, -X, +Y, -Y, +Z, -Z). */
export const EXPLICIT_AXES = [0, 1, 2, 3, 4, 5] as const;
export type ExplicitAxis = (typeof EXPLICIT_AXES)[number];

export function isExplicitAxis(value: unknown): value is ExplicitAxis {
  return typeof value === "number" && (EXPLICIT_AXES as readonly number[]).includes(value);
}

/**
 * What an explicit attempt along one axis will be. A straight move needs an independent check
 * before it can score; a helical unscrew keeps the blocking-graph rule of the normal game and is
 * not called verified. Either way the axis is the one the player named.
 */
export type ExplicitPlan =
  | {
      kind: "straight";
      partId: string;
      axisIndex: ExplicitAxis;
      dir: Vec3;
      /** Union-AABB Escape_Distance against the live parts. */
      escapeDistance: number;
      /** The animation travel, `max(escapeDistance, EXIT_TRAVEL_FLOOR)`: what the check must cover. */
      travel: number;
      /** A `linear_slide` step whose `params` are the exact move that would play. */
      step: TrajectoryStep;
      /** Every other live part, ascending. */
      staticPartIds: string[];
    }
  | { kind: "helical"; partId: string; axisIndex: ExplicitAxis; escapeDistance: number; step: TrajectoryStep }
  | { kind: "rejected"; partId: string; reason: "unknown_part" | "not_live" | "level_complete" };

/** Builds the move for `partId` along `axisIndex` without changing any state. */
export function planExplicitAttempt(state: EngineState, partId: string, axisIndex: ExplicitAxis): ExplicitPlan {
  const reason = rejectionOf(state, partId);
  if (reason !== null) return { kind: "rejected", partId, reason };
  const part = state.level.partsById.get(partId) as EnginePart;
  const escape = escapeDistances(state, part, [axisIndex]).get(axisIndex) as number;
  const step = buildExitStep(state, part, axisIndex, escape);
  if (step.primitive === "helical_unscrew") {
    return { kind: "helical", partId, axisIndex, escapeDistance: escape, step };
  }
  if (step.primitive !== "linear_slide" || step.params.kind !== "linear_slide") {
    throw new RangeError(`Explicit attempt along axis ${axisIndex} compiled to ${step.primitive}, not a straight move.`);
  }
  // `kind` was checked above. The open member of `PrimitiveParams` stops TypeScript narrowing it.
  const params = step.params as LinearSlideParams;
  const dir = params.dir;
  return {
    kind: "straight",
    partId,
    axisIndex,
    dir: [dir[0], dir[1], dir[2]],
    escapeDistance: escape,
    travel: params.distance,
    step,
    staticPartIds: liveParts(state).filter((id) => id !== partId),
  };
}

/**
 * A helical explicit attempt, decided by the blocking graph on exactly the named axis, as the
 * normal game decides fasteners. Nothing here checks the screw path, so callers must not call
 * the result verified.
 */
export function resolveExplicitHelical(
  state: EngineState,
  plan: Extract<ExplicitPlan, { kind: "helical" }>,
): { state: EngineState; result: UnboltResult } {
  const reason = rejectionOf(state, plan.partId);
  if (reason !== null) return { state, result: { kind: "rejected", partId: plan.partId, reason } };
  const part = state.level.partsById.get(plan.partId) as EnginePart;
  const blockers = unremovedBlockers(state, plan.partId)[plan.axisIndex] ?? [];
  if (blockers.length > 0) return blockAttempt(state, plan.partId, plan.axisIndex, blockers);
  return awardRemoval(state, part, plan.axisIndex, plan.escapeDistance, plan.step);
}

/** The verdict of an independent straight-move check, as the engine needs it. */
export interface StraightCheck {
  verdict: "clear" | "blocked" | "unverified";
  /** The move the check was about, in normalized units. */
  move: { partId: string; dir: Vec3; distance: number; presentPartIds: readonly string[] };
  /** Static parts whose pair was Blocked. */
  blockerIds: readonly string[];
}

export type StraightOutcome =
  | { kind: "removed"; state: EngineState; result: Extract<UnboltResult, { kind: "legal" }> }
  | { kind: "blocked"; state: EngineState; result: Extract<UnboltResult, { kind: "blocked" }> }
  | { kind: "unresolved"; reason: "unverified" | "stale" | "not_extracted" };

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const x = [...a].sort(compareIds);
  const y = [...b].sort(compareIds);
  return x.length === y.length && x.every((id, i) => id === y[i]);
}

/**
 * Applies the check of a straight explicit attempt. The check counts only when it is about this
 * exact move: the same part, direction, travel and live parts as the plan, with nothing removed
 * since. Clear removes and scores the part once, and only when the travel takes its box clear of
 * every live box. Blocked costs a mistake and names the blockers that check found. Unverified,
 * a check about another move, or any change since the plan leaves the state as it was.
 */
export function resolveExplicitStraight(
  state: EngineState,
  plan: Extract<ExplicitPlan, { kind: "straight" }>,
  check: StraightCheck,
): StraightOutcome {
  if (rejectionOf(state, plan.partId) !== null) return { kind: "unresolved", reason: "stale" };
  const live = liveParts(state).filter((id) => id !== plan.partId);
  if (!sameIds(live, plan.staticPartIds)) return { kind: "unresolved", reason: "stale" };
  const { move } = check;
  const sameMove =
    move.partId === plan.partId &&
    move.distance === plan.travel &&
    move.dir[0] === plan.dir[0] &&
    move.dir[1] === plan.dir[1] &&
    move.dir[2] === plan.dir[2] &&
    sameIds(move.presentPartIds, plan.staticPartIds);
  if (!sameMove) return { kind: "unresolved", reason: "stale" };
  if (check.verdict === "unverified") return { kind: "unresolved", reason: "unverified" };
  if (check.verdict === "blocked") {
    const blockers = check.blockerIds.filter((id) => plan.staticPartIds.includes(id));
    if (blockers.length === 0) return { kind: "unresolved", reason: "unverified" };
    return { kind: "blocked", ...blockAttempt(state, plan.partId, plan.axisIndex, blockers) };
  }
  const part = state.level.partsById.get(plan.partId) as EnginePart;
  const others = plan.staticPartIds.map((id) => (state.level.partsById.get(id) as EnginePart).aabb);
  if (!extractedAfter(part.aabb, plan.dir, plan.travel, others)) return { kind: "unresolved", reason: "not_extracted" };
  return { kind: "removed", ...awardRemoval(state, part, plan.axisIndex, plan.escapeDistance, plan.step) };
}

/** True when `box` moved by `travel * dir` overlaps none of `others` (touching is allowed). */
export function extractedAfter(box: Aabb, dir: Vec3, travel: number, others: readonly Aabb[]): boolean {
  const moved: Aabb = {
    min: [box.min[0] + travel * dir[0], box.min[1] + travel * dir[1], box.min[2] + travel * dir[2]],
    max: [box.max[0] + travel * dir[0], box.max[1] + travel * dir[1], box.max[2] + travel * dir[2]],
  };
  return others.every((other) =>
    [0, 1, 2].some(
      (j) =>
        (moved.max[j] as number) <= (other.min[j] as number) + TOUCH ||
        (moved.min[j] as number) >= (other.max[j] as number) - TOUCH,
    ),
  );
}

/**
 * The Flag Interlock Trap action. A fully live deadlock SCC exposes the
 * interlock (+1000, level complete). Otherwise it is a false alarm: combo 1,
 * -250 floored at 0, +3000 ms, and the false-alarm counter rises.
 */
export function flagDeadlockTrap(state: EngineState): { state: EngineState; result: TrapResult } {
  if (state.outcome !== null) {
    return { state, result: { kind: "rejected", reason: "level_complete" } };
  }
  const sccs = genuineDeadlockSccs(state);
  if (sccs.length > 0) {
    const next: EngineState = {
      ...state,
      score: state.score + TRAP_BONUS,
      outcome: "interlock_exposed",
    };
    return {
      state: next,
      result: {
        kind: "exposed",
        bonus: TRAP_BONUS,
        sccs: sccs.map((scc) => [...scc]),
        scoreAfter: next.score,
        completed: true,
      },
    };
  }
  const penaltyApplied = Math.min(FALSE_ALARM_PENALTY, state.score);
  const next: EngineState = {
    ...state,
    combo: 1,
    score: state.score - penaltyApplied,
    falseAlarms: state.falseAlarms + 1,
    penaltyMs: state.penaltyMs + TIME_PENALTY_MS,
  };
  return {
    state: next,
    result: {
      kind: "false_alarm",
      comboBefore: state.combo,
      scoreBefore: state.score,
      scoreAfter: next.score,
      penaltyApplied,
      penaltyMs: TIME_PENALTY_MS,
      falseAlarms: next.falseAlarms,
    },
  };
}
