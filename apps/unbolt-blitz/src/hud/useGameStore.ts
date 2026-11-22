/**
 * React bindings for the framework-free `GameStore` (design D9).
 *
 * `useGameState` reads the state through `useSyncExternalStore`. `useGameEvents`
 * subscribes to the store's event bus for transient cues (popups, callout, pulses).
 * Events are published once per dispatch, so StrictMode double effects only
 * re-subscribe and never replay events.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { GameEvent } from "../game/events";
import type { GameState } from "../game/gameState";
import type { GameStore } from "../game/store";
import type { NameMap } from "./hudModel";

export function useGameState(store: GameStore): GameState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Calls `handler` for every event published on the store's bus, in order. */
export function useGameEvents(store: GameStore, handler: (event: GameEvent) => void): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => store.bus.subscribe((event) => handlerRef.current(event)), [store]);
}

const NO_NAMES: NameMap = new Map<string, string>();

/** Display names of the loaded level, or an empty map when none is loaded. */
export function displayNamesOf(state: GameState): NameMap {
  return state.screen.kind === "level" ? state.screen.loaded.displayNames : NO_NAMES;
}
