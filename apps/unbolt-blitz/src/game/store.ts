/**
 * `GameStore`: `gameReducer` plus the event bus (design D9, "Store and registration point").
 *
 * `dispatch` reduces, stores the next state, then publishes the events that the
 * action produced, in order. Events are published once per dispatch, so React
 * StrictMode double effects cannot replay them. Listener errors propagate.
 *
 * Pure TypeScript: no DOM, React or Three.js module.
 */
import { createEventBus } from "./eventBus";
import type { GameEventBus } from "./eventBus";
import type { GameEvent } from "./events";
import { initialGameState } from "./gameState";
import type { GameAction, GameState } from "./gameState";
import { gameReducer } from "./reducer";

export interface GameStore {
  getState(): GameState;
  /** Reduce, then publish the events appended by this action, in order. */
  dispatch(action: GameAction): void;
  /** For `useSyncExternalStore`. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  bus: GameEventBus;
}

/** True when `prev` is a reference-equal prefix of `next`. */
function isPrefix(prev: readonly GameEvent[], next: readonly GameEvent[]): boolean {
  if (prev.length > next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i] !== next[i]) return false;
  }
  return true;
}

/**
 * Events that `next` adds over `prev`. When the log was reset (level requested,
 * loaded or replayed) `prev` is not a prefix of `next`, and all of `next` is new.
 */
export function newEvents(prev: readonly GameEvent[], next: readonly GameEvent[]): readonly GameEvent[] {
  if (prev === next) return [];
  return isPrefix(prev, next) ? next.slice(prev.length) : next;
}

export function createGameStore(initial: GameState = initialGameState): GameStore {
  let state = initial;
  const bus = createEventBus();
  const listeners = new Set<() => void>();

  return {
    getState: () => state,

    dispatch(action) {
      const prev = state;
      const next = gameReducer(prev, action);
      if (next === prev) return;
      state = next;

      for (const listener of [...listeners]) {
        if (listeners.has(listener)) listener();
      }
      for (const event of newEvents(prev.events, next.events)) bus.publish(event);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    bus,
  };
}
