/**
 * Ghost Extraction Hint (Part 2, module 1).
 *
 * `pickHintTarget` is a pure function of the engine state. It reads only
 * `liveParts`, `clearAxes` and the part geometry, so it never names a part id.
 * It picks the same exit axis and distance that `attemptUnbolt` would use, so the
 * ghost shows the path the part will actually take.
 *
 * `createHintSession` is a `GameModule` that counts hints per run (reset on every
 * `level_loaded`, which also covers Replay) and carries the text of the hint banner.
 * The Arena draws the 3D ghost. The session reaches it through `onShow`.
 *
 * Type-only imports from the game layer, plus pure helpers: no DOM, React or Three.js.
 */
import type { Vec3 } from "@unboltkit/core";
import { escapeDistance } from "../game/axisMath";
import type { Aabb } from "../game/axisMath";
import { clearAxes, liveParts } from "../game/blitzEngine";
import type { EngineState } from "../game/blitzEngine";
import type { GameEvent } from "../game/events";
import { ESCAPE_TIE_TOLERANCE } from "../game/scoring";
import type { GameModule } from "./types";
import { defaultStorage, type StorageAdapter } from "./storage";

export type HintTarget =
  | { kind: "part"; partId: string; dir: Vec3; distance: number }
  | { kind: "deadlock" };

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Candidate {
  partId: string;
  isFastener: boolean;
  dir: Vec3;
  distance: number;
}

/** Best exit of one removable part: the clear axis with the smallest escape distance, ties to the lowest index. */
function bestExit(state: EngineState, partId: string, axes: readonly number[]): Candidate | null {
  const part = state.level.partsById.get(partId);
  if (part === undefined) return null;
  const others: Aabb[] = [];
  for (const other of state.level.parts) {
    if (other.partId !== partId && !state.removed.has(other.partId)) others.push(other.aabb);
  }
  let chosen: { axis: number; distance: number } | null = null;
  for (const axis of axes) {
    const distance = escapeDistance(part.aabb, part.candidateAxes[axis] as Vec3, others);
    if (chosen === null || distance < chosen.distance - ESCAPE_TIE_TOLERANCE) chosen = { axis, distance };
  }
  if (chosen === null) return null;
  const dir = part.candidateAxes[chosen.axis] as Vec3;
  return {
    partId,
    isFastener: part.isFastener,
    dir: [dir[0], dir[1], dir[2]],
    distance: chosen.distance,
  };
}

/**
 * Recommends the next move.
 *
 * - At least one live part has a clear axis: a removable fastener if there is one,
 *   otherwise the removable part with the shortest escape distance. Ties go to the
 *   lowest part id (ids are compared by code unit, never by locale).
 * - No live part can move: `{ kind: "deadlock" }`.
 * - A finished level, or a level with no live part: `{ kind: "deadlock" }` is not
 *   meaningful there, so the caller must not ask. The function returns `null`.
 */
export function pickHintTarget(state: EngineState): HintTarget | null {
  if (state.outcome !== null) return null;
  const live = liveParts(state);
  if (live.length === 0) return null;
  const candidates: Candidate[] = [];
  for (const partId of live) {
    const axes = clearAxes(state, partId);
    if (axes.length === 0) continue;
    const exit = bestExit(state, partId, axes);
    if (exit !== null) candidates.push(exit);
  }
  if (candidates.length === 0) return { kind: "deadlock" };
  const fasteners = candidates.filter((candidate) => candidate.isFastener);
  const pool = fasteners.length > 0 ? fasteners : candidates;
  let best = pool[0] as Candidate;
  for (const candidate of pool) {
    if (
      candidate.distance < best.distance - ESCAPE_TIE_TOLERANCE ||
      (Math.abs(candidate.distance - best.distance) <= ESCAPE_TIE_TOLERANCE &&
        compareIds(candidate.partId, best.partId) < 0)
    ) {
      best = candidate;
    }
  }
  return { kind: "part", partId: best.partId, dir: best.dir, distance: best.distance };
}

/** Words for a direction in the Arena's world frame: +x right, +y up, +z toward the viewer. */
export function describeDirection(dir: Vec3): string {
  const axes: Array<{ value: number; positive: string; negative: string }> = [
    { value: dir[1], positive: "up", negative: "down" },
    { value: dir[0], positive: "right", negative: "left" },
    { value: dir[2], positive: "toward you", negative: "away from you" },
  ];
  const significant = axes
    .filter((axis) => Math.abs(axis.value) >= 0.35)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 2)
    .map((axis) => (axis.value > 0 ? axis.positive : axis.negative));
  if (significant.length === 0) return "outward";
  return significant.join(" and ");
}

export const HINT_DEADLOCK_TEXT =
  "HINT: Nothing can move. This is an interlock. Pull the Flag Interlock Trap lever.";

export function hintBannerText(target: HintTarget, partName: string): string {
  if (target.kind === "deadlock") return HINT_DEADLOCK_TEXT;
  return `HINT: Unbolt ${partName}. It slides ${describeDirection(target.dir)}.`;
}

export interface HintBanner {
  /** Increases with every hint, so a repeated hint restarts the banner timer. */
  id: number;
  kind: HintTarget["kind"];
  text: string;
}

export interface HintSnapshot {
  hintsUsed: number;
  banner: HintBanner | null;
  firstMove: HintShowRequest | null;
}

export interface HintShowRequest {
  partId: string;
  dir: Vec3;
  distance: number;
  mode?: "firstMove";
}

export interface HintSession extends GameModule {
  getSnapshot(): HintSnapshot;
  getHintsUsed(): number;
  /** For `useSyncExternalStore`. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** The Arena registers here to draw the ghost. Returns an unsubscribe function. */
  onShow(listener: (request: HintShowRequest) => void): () => void;
  /**
   * Asks for a hint. Counts it, publishes the banner and, for a part target, tells the Arena.
   * Returns null (and counts nothing) when no level is in play.
   */
  request(
    engine: EngineState | null,
    displayNames?: ReadonlyMap<string, string>,
  ): HintTarget | null;
  reset(): void;
}

const EMPTY: HintSnapshot = { hintsUsed: 0, banner: null, firstMove: null };
const FIRST_MOVE_SEEN = "unbolt-blitz:first-lockbox-cue:v1";

export function createHintSession(storage: StorageAdapter = defaultStorage()): HintSession {
  let snapshot: HintSnapshot = EMPTY;
  let nextBannerId = 1;
  const listeners = new Set<() => void>();
  const showListeners = new Set<(request: HintShowRequest) => void>();
  const publish = (next: HintSnapshot): void => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    id: "ghost-hint",
    onEvent(event: GameEvent, ctx) {
      switch (event.kind) {
        case "level_loaded":
          if (snapshot !== EMPTY) publish(EMPTY);
          return;
        case "level_started": {
          // Only offer the cue once, after the lockbox meshes can actually be seen.
          const { screen, engine } = ctx.getState();
          if (screen.kind !== "level" || screen.loaded.ref.kind !== "bundled" ||
              screen.loaded.ref.levelId !== "lockbox" || engine === null || storage.getItem(FIRST_MOVE_SEEN)) return;
          storage.setItem(FIRST_MOVE_SEEN, "1");
          if (engine.removed.size !== 0) return;
          const target = pickHintTarget(engine);
          if (target?.kind !== "part") return;
          const firstMove: HintShowRequest = { ...target, mode: "firstMove" };
          publish({ ...snapshot, firstMove });
          for (const listener of [...showListeners]) listener(firstMove);
          return;
        }
        case "part_removed":
        case "trap_flagged":
        case "level_completed":
          if (snapshot.banner !== null || snapshot.firstMove !== null) publish({ ...EMPTY, hintsUsed: snapshot.hintsUsed });
          return;
        default:
          return;
      }
    },
    getSnapshot: () => snapshot,
    getHintsUsed: () => snapshot.hintsUsed,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onShow(listener) {
      showListeners.add(listener);
      return () => {
        showListeners.delete(listener);
      };
    },
    request(engine, displayNames) {
      if (engine === null) return null;
      const target = pickHintTarget(engine);
      if (target === null) return null;
      const name =
        target.kind === "part"
          ? (displayNames?.get(target.partId) ?? engine.level.partsById.get(target.partId)?.displayName ?? target.partId)
          : "";
      const banner: HintBanner = { id: nextBannerId, kind: target.kind, text: hintBannerText(target, name) };
      nextBannerId += 1;
      publish({ ...snapshot, hintsUsed: snapshot.hintsUsed + 1, banner });
      // The first-move pointer already identifies this screw; keep it until a removal.
      if (target.kind === "part" && snapshot.firstMove === null) {
        const request: HintShowRequest = { partId: target.partId, dir: target.dir, distance: target.distance };
        for (const listener of [...showListeners]) listener(request);
      }
      return target;
    },
    reset() {
      if (snapshot !== EMPTY) publish(EMPTY);
    },
    // The session is a long-lived singleton that survives React StrictMode remounts,
    // so dispose clears the run state and keeps the subscriptions.
    dispose() {
      if (snapshot !== EMPTY) publish(EMPTY);
    },
  };
}
