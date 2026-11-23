/**
 * "Check this move": slice reducer, staleness rule and selectors.
 *
 * The user picks a Part, one of six model axes and a finite travel. The move is checked against
 * the Parts still present at the current step of the plan: every Part, minus the Parts whose
 * steps the timeline has completed. A deadlocked plan has no timeline, so every Part is present.
 * Nothing here substitutes another axis, another distance or another static set for the one the
 * user chose.
 *
 * A check result is kept with the key of the exact move it answers. `reconcileMoveCheck` runs after
 * every action and drops a pending check or an outcome whose key no longer matches the current
 * move, so a change of model, Part, direction, distance or present Parts discards the old verdict,
 * and a late worker answer, whose `checkId` is no longer pending, changes nothing.
 *
 * Pure. No React, no DOM and no three import.
 */
import type { MoveReason, MoveVerdict, PairVerification, Vec3 } from "@unboltkit/core";
import type { MoveCheckRequest, SolveResult } from "../protocol";
import { SERVICE_RING } from "../examples/serviceRing";
import { partDisplayName } from "./selectors";
import type { AppState, AxisDirection, MoveCheckSlice, SliceReducer } from "./types";

export const initialMoveCheckSlice: MoveCheckSlice = {
  partId: null,
  direction: null,
  distanceText: "",
  pending: null,
  outcome: null,
};

export const AXIS_DIRECTIONS: readonly { id: AxisDirection; label: string; vector: Vec3 }[] = [
  { id: "+y", label: "+Y (up)", vector: [0, 1, 0] },
  { id: "-y", label: "\u2212Y (down)", vector: [0, -1, 0] },
  { id: "+x", label: "+X", vector: [1, 0, 0] },
  { id: "-x", label: "\u2212X", vector: [-1, 0, 0] },
  { id: "+z", label: "+Z", vector: [0, 0, 1] },
  { id: "-z", label: "\u2212Z", vector: [0, 0, -1] },
];

export function axisDirection(id: AxisDirection): { id: AxisDirection; label: string; vector: Vec3 } {
  const entry = AXIS_DIRECTIONS.find((axis) => axis.id === id);
  if (entry === undefined) throw new RangeError(`Unknown axis direction ${String(id)}`);
  return entry;
}

const DECIMAL = /^(\d+(\.\d*)?|\.\d+)$/;

/** A plain decimal greater than 0, or `null`. Exponents, signs and hex are not accepted. */
export function parseTravel(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export const moveCheckReducer: SliceReducer<MoveCheckSlice> = (slice, action, previous) => {
  switch (action.type) {
    case "solve/started":
      // A new model: nothing chosen for the old one carries over.
      return initialMoveCheckSlice;
    case "solve/succeeded": {
      if (previous.solve.label?.kind !== "example" || previous.solve.status !== "loading" ||
          previous.solve.activeRequestId !== action.requestId || action.result.plan.status === "error") return slice;
      const ring = action.result.parts.find(part => part.nodeName === SERVICE_RING.nodeName);
      return ring ? { ...initialMoveCheckSlice, partId: ring.partId, direction: SERVICE_RING.direction, distanceText: SERVICE_RING.distanceText } : slice;
    }
    case "moveCheck/partSelected":
      return action.partId === slice.partId ? slice : { ...slice, partId: action.partId };
    case "moveCheck/directionSelected":
      return action.direction === slice.direction ? slice : { ...slice, direction: action.direction };
    case "moveCheck/distanceSet":
      return action.text === slice.distanceText ? slice : { ...slice, distanceText: action.text };
    case "moveCheck/started":
      if (action.requestId !== previous.solve.activeRequestId) return slice;
      return { ...slice, pending: { checkId: action.checkId, key: action.key } };
    case "moveCheck/completed":
    case "moveCheck/failed": {
      const pending = slice.pending;
      if (pending === null || pending.checkId !== action.checkId || action.requestId !== previous.solve.activeRequestId) {
        return slice;
      }
      const outcome: MoveCheckSlice["outcome"] =
        action.type === "moveCheck/completed"
          ? { checkId: action.checkId, key: pending.key, kind: "result", result: action.result }
          : { checkId: action.checkId, key: pending.key, kind: "failure", failure: action.failure };
      return { ...slice, pending: null, outcome };
    }
    default:
      return slice;
  }
};

// ---------------------------------------------------------------------------
// Present Parts and the current move
// ---------------------------------------------------------------------------

export type PresentParts = { ok: true; partIds: string[]; removedPartIds: string[] } | { ok: false; reason: string };

function ascending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The Parts present at the current step: every Part, minus the Parts of the plan steps the
 * timeline has completed. Between two steps a Part is part-way along its path, so no present set
 * is claimed there.
 */
export function selectPresentParts(state: AppState): PresentParts {
  const result = state.solve.result;
  if (state.solve.status !== "ready" || result === null || result.plan.status === "error") {
    return { ok: false, reason: "Open a model first." };
  }
  const plan = result.plan;
  const p = plan.status === "solved" ? state.view.timelineP : 0;
  if (!Number.isInteger(p)) {
    return { ok: false, reason: "The timeline is between two steps. Select a step, or let playback finish, to fix which parts are present." };
  }
  const removed = plan.steps.slice(0, p).map((step) => step.partId);
  const removedSet = new Set(removed);
  const partIds = result.parts.map((part) => part.partId).filter((partId) => !removedSet.has(partId)).sort(ascending);
  return { ok: true, partIds, removedPartIds: removed };
}

export type CurrentMove =
  | { ok: true; request: MoveCheckRequest; key: string }
  | { ok: false; reason: string };

/** The exact move the form describes, with its staleness key, or why there is none yet. */
export function selectCurrentMove(state: AppState): CurrentMove {
  const present = selectPresentParts(state);
  if (!present.ok) return present;
  const { partId, direction, distanceText } = state.moveCheck;
  if (partId === null) return { ok: false, reason: "Choose the part to move." };
  if (!present.partIds.includes(partId)) {
    return { ok: false, reason: "The chosen part has already been removed at this step. Choose a part that is still present." };
  }
  if (direction === null) return { ok: false, reason: "Choose a direction." };
  const distance = parseTravel(distanceText);
  if (distance === null) return { ok: false, reason: "Enter a travel distance greater than 0, in model units." };
  const dir = axisDirection(direction).vector;
  const staticPartIds = present.partIds.filter((id) => id !== partId);
  const request: MoveCheckRequest = { partId, dir: [dir[0], dir[1], dir[2]], distance, staticPartIds };
  const key = JSON.stringify([state.solve.activeRequestId, partId, direction, distance, staticPartIds]);
  return { ok: true, request, key };
}

/** Drops a pending check or an outcome that no longer describes the current move. */
export function reconcileMoveCheck(state: AppState): AppState {
  const { pending, outcome } = state.moveCheck;
  if (pending === null && outcome === null) return state;
  const current = selectCurrentMove(state);
  const key = current.ok ? current.key : null;
  const keepPending = pending !== null && pending.key === key;
  const keepOutcome = outcome !== null && outcome.key === key;
  if (keepPending === (pending !== null) && keepOutcome === (outcome !== null)) return state;
  return {
    ...state,
    moveCheck: { ...state.moveCheck, pending: keepPending ? pending : null, outcome: keepOutcome ? outcome : null },
  };
}

// ---------------------------------------------------------------------------
// Display model
// ---------------------------------------------------------------------------

/** Plain-language reason for an Unverified pair. */
export const UNVERIFIED_REASON_TEXT: Readonly<Partial<Record<MoveReason, string>>> = {
  open_mesh: "a mesh has holes, so the inside of the part is not defined",
  invalid_orientation: "a mesh is inside out (its faces point inward)",
  nested_at_start: "one part sits inside the other at the start",
  initial_separation_unknown: "the parts may already overlap at the start, and the check could not rule that out",
  contact_unresolved: "the parts touch during the move, and the check could not tell touching from overlapping",
  iteration_cap: "the check reached its step limit before it could show the parts stay apart",
  unsupported_primitive: "the motion is not a straight move",
};

export type MoveCheckStatus = "unavailable" | "ready" | "checking" | "clear" | "blocked" | "unverified" | "failed";

export interface MoveCheckView {
  status: MoveCheckStatus;
  /** Why the check cannot run yet. `null` when it can. */
  unavailableReason: string | null;
  /** The move the form describes, when it is complete. */
  request: MoveCheckRequest | null;
  key: string | null;
  /** Parts still present at this step, display names in Part_ID order. */
  present: { partId: string; name: string }[];
  /** Short verdict text: Checking, Clear, Blocked or Unverified. */
  headline: string;
  detail: string;
  /** Display names of the blocking Parts. Empty unless Blocked. */
  blockerNames: string[];
  /** Worker time of the shown check. */
  elapsedMs: number | null;
}

function nameLookup(result: SolveResult): (partId: string) => string {
  const byId = new Map(result.parts.map((part) => [part.partId, part.nodeName]));
  return (partId) => partDisplayName(byId.get(partId) ?? "", partId);
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] as string}`;
}

const ONE_MOVE_ONLY = "Only this move was checked. The full guide is not verified.";

function verdictText(
  verdict: MoveVerdict,
  pairs: readonly PairVerification[],
  name: (partId: string) => string,
  scale: number,
): { headline: string; detail: string; blockerNames: string[] } {
  if (verdict === "blocked") {
    const blockers = pairs.filter((pair) => pair.verdict === "blocked");
    const blockerNames = blockers.map((pair) => name(pair.staticPartId));
    const travel = blockers[0]?.evidence.travel;
    const at = typeof travel === "number" && scale > 0 ? ` The first overlap found is at ${(travel / scale).toFixed(2)} model units of travel.` : "";
    return {
      headline: `Blocked by ${listNames(blockerNames)}`,
      detail: `The moving part would pass through ${listNames(blockerNames)}.${at}`,
      blockerNames,
    };
  }
  if (verdict === "unverified") {
    const reasons = pairs
      .filter((pair) => pair.verdict === "unverified")
      .map((pair) => `${name(pair.staticPartId)}: ${UNVERIFIED_REASON_TEXT[pair.reason] ?? pair.reason.replace(/_/g, " ")}`);
    return {
      headline: "Unverified",
      detail: `The check could not decide this move. ${reasons.join("; ")}.`,
      blockerNames: [],
    };
  }
  return {
    headline: "Clear",
    detail: `The moving part stays out of every present part over the whole travel. ${ONE_MOVE_ONLY}`,
    blockerNames: [],
  };
}

export function selectMoveCheckView(state: AppState): MoveCheckView {
  const result = state.solve.result;
  const presentParts = selectPresentParts(state);
  const name = result !== null ? nameLookup(result) : (partId: string) => `Part ${partId}`;
  const present = presentParts.ok ? presentParts.partIds.map((partId) => ({ partId, name: name(partId) })) : [];
  const current = selectCurrentMove(state);
  const base = {
    request: current.ok ? current.request : null,
    key: current.ok ? current.key : null,
    present,
    blockerNames: [] as string[],
    elapsedMs: null as number | null,
  };
  if (!current.ok) {
    return { ...base, status: "unavailable", unavailableReason: current.reason, headline: "Not checked", detail: current.reason };
  }
  const { pending, outcome } = state.moveCheck;
  if (pending !== null && pending.key === current.key) {
    return { ...base, status: "checking", unavailableReason: null, headline: "Checking\u2026", detail: "Checking this exact move against the present parts." };
  }
  if (outcome !== null && outcome.key === current.key) {
    if (outcome.kind === "failure") {
      return {
        ...base,
        status: "failed",
        unavailableReason: null,
        headline: "Unverified",
        detail: `The check did not finish: ${outcome.failure.message}`,
      };
    }
    const { verification, elapsedMs } = outcome.result;
    const scale = result !== null && result.plan.status !== "error" ? result.plan.normalization.scale : 0;
    const text = verdictText(verification.verdict, verification.pairs, name, scale);
    return { ...base, status: verification.verdict, unavailableReason: null, elapsedMs, ...text };
  }
  return { ...base, status: "ready", unavailableReason: null, headline: "Not checked", detail: "Press Check this move." };
}
