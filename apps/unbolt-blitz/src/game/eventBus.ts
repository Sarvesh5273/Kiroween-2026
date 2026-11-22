/**
 * Game_Event bus (Req 8.5): synchronous, ordered publish/subscribe.
 *
 * Listener errors are not caught. They propagate out of `publish`, so a faulty
 * module is visible in development and tests. Pure TypeScript: no DOM, React or
 * Three.js module.
 */
import type { GameEvent } from "./events";

export type GameEventListener = (event: GameEvent) => void;

export interface GameEventBus {
  /** Returns an unsubscribe function. Unsubscribing twice is harmless. */
  subscribe(listener: GameEventListener): () => void;
  publish(event: GameEvent): void;
}

export function createEventBus(): GameEventBus {
  const listeners = new Set<GameEventListener>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    publish(event) {
      // Iterate a snapshot so (un)subscribing inside a listener cannot disturb this
      // delivery, but skip listeners that were unsubscribed earlier in the same pass.
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) listener(event);
      }
    },
  };
}
