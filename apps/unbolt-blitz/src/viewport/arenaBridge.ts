/**
 * Arena event bridge: the only place that maps `GameEvent`s onto Arena calls
 * (design: "Arena", Req 11.1, 11.4, 11.8, 12.1, 12.2, 12.3, 14.3, 16.1, 16.3).
 *
 *   part_removed                         -> arena.removePart(partId, step, event.at)
 *   part_blocked                         -> arena.blockPart(partId, blockerIds, event.at)
 *   trap_flagged                         -> arena.showInterlock(every SCC part)
 *   level_completed (interlock_exposed)  -> arena.showInterlock(every SCC part)
 *   level_loaded                         -> arena.loadParts(parts of the loaded level, epoch)
 *   screen becomes "loading"             -> arena.clear()   (LEVEL_REQUESTED has no event, so the
 *                                           bridge watches the store state for it)
 *
 * The reverse direction (an Arena click) is `createPartClickHandler`, which
 * dispatches `PART_CLICKED`. The Arena takes its `onPartClick` option at
 * construction, so `ArenaView` passes this handler when it creates the Arena.
 *
 * Shudder and exit animation: `blockPart` starts a shudder that takes over the
 * mesh matrix. `Arena.removePart` calls `effects.cancelShudder(partId)` before it
 * starts the exit animation, and the bridge always goes through `removePart`
 * and never touches the mesh, so a shudder in progress can never fight an exit
 * animation on the same part (Req 11.6, 12.1).
 *
 * Errors thrown by the Arena (for example a part that is not live) propagate
 * through the bus. They are never swallowed.
 *
 * Imports no React. Only types from the Arena and the store.
 */
import type { GameEvent } from "../game/events";
import type { GameStore } from "../game/store";
import type { PartRenderData } from "../protocol";
import type { Arena } from "./Arena";

/** The slice of the Arena that the bridge drives. A real `Arena` satisfies it. */
export type BridgedArena = Pick<Arena, "loadParts" | "clear" | "removePart" | "blockPart" | "showInterlock">;

/** Parts of the level that the store currently shows, or null when no level is shown. */
function loadedParts(
  store: GameStore,
  epoch: number,
): readonly PartRenderData[] | null {
  const screen = store.getState().screen;
  if (screen.kind !== "level" || screen.loaded.epoch !== epoch) return null;
  return screen.loaded.parts;
}

/** Every part id in the SCCs, without duplicates, in first-seen order. */
function sccPartIds(sccs: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  for (const scc of sccs) {
    for (const partId of scc) seen.add(partId);
  }
  return [...seen];
}

/** Applies one game event to the Arena. Exported so tests can drive it without a bus. */
export function applyEventToArena(arena: BridgedArena, store: GameStore, event: GameEvent): void {
  switch (event.kind) {
    case "level_loaded": {
      const parts = loadedParts(store, event.epoch);
      // A newer level has replaced this one before the event arrived: nothing to show.
      if (parts === null) return;
      arena.loadParts(parts, event.epoch);
      return;
    }

    case "part_removed":
      arena.removePart(event.partId, event.step, event.at);
      return;

    case "part_blocked":
      arena.blockPart(event.partId, event.blockerIds, event.at);
      return;

    case "trap_flagged":
      arena.showInterlock(sccPartIds(event.sccs));
      return;

    case "level_completed":
      if (event.outcome === "interlock_exposed") arena.showInterlock(sccPartIds(event.sccs));
      return;

    case "level_started":
    case "click_rejected":
    case "false_alarm":
      // No Arena feedback: the HUD shows these.
      return;
  }
}

/**
 * Subscribes the Arena to the store's event bus. Returns an unsubscribe function
 * that `ArenaView` calls before `arena.dispose()`.
 *
 * If a level is already shown when the bridge starts (the Arena was created
 * after `level_loaded` was published), the current level is loaded at once.
 */
export function connectArenaBridge(arena: BridgedArena, store: GameStore): () => void {
  const unsubscribeEvents = store.bus.subscribe((event) => applyEventToArena(arena, store, event));

  // A new request (LEVEL_REQUESTED) puts the screen into "loading". Empty the Arena at that moment,
  // so the previous kit is not shown behind the loading plate while the worker solves.
  let wasLoading = store.getState().screen.kind === "loading";
  const unsubscribeState = store.subscribe(() => {
    const loading = store.getState().screen.kind === "loading";
    if (loading && !wasLoading) arena.clear();
    wasLoading = loading;
  });

  const screen = store.getState().screen;
  if (screen.kind === "level") arena.loadParts(screen.loaded.parts, screen.loaded.epoch);

  return () => {
    unsubscribeState();
    unsubscribeEvents();
  };
}

/**
 * Handler for `ArenaOptions.onPartClick`. `atMs` is on the Arena's clock
 * (`performance.now()`), which is the clock that `PART_CLICKED.at` uses.
 */
export function createPartClickHandler(store: GameStore): (partId: string, atMs: number) => void {
  return (partId, atMs) => {
    store.dispatch({ type: "PART_CLICKED", partId, at: atMs });
  };
}
