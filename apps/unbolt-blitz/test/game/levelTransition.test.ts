/**
 * Level transitions: the stopwatch starts at zero on ARENA_READY and never counts solve time, and
 * the Arena bridge empties the Arena the moment a new level is requested.
 */
import { describe, expect, it } from "vitest";
import { createEngineDeps } from "../../src/engineDeps";
import { createEngineLevel } from "../../src/game/blitzEngine";
import type { GameAction, LevelRef, LoadedLevel } from "../../src/game/gameState";
import { loadedLevelFromSolve } from "../../src/game/gameState";
import { toEngineLevelInput } from "../../src/game/levelData";
import { elapsedMs } from "../../src/game/selectors";
import { createGameStore } from "../../src/game/store";
import { hintsUsedLabel } from "../../src/hud/HintControls";
import { connectArenaBridge } from "../../src/viewport/arenaBridge";
import type { BridgedArena } from "../../src/viewport/arenaBridge";
import { requireSolveResult, solvedLockbox } from "../helpers/solved";

const LOCKBOX_REF: LevelRef = { kind: "bundled", levelId: "lockbox" };
const SOLVE_MS = 7700;

function loadedAction(requestId: number, epoch: number, at: number): GameAction {
  const result = requireSolveResult(solvedLockbox(2));
  const loaded: LoadedLevel = loadedLevelFromSolve(result, LOCKBOX_REF, "Lockbox", epoch);
  const engineLevel = createEngineLevel(toEngineLevelInput(result), createEngineDeps());
  return { type: "LEVEL_LOADED", requestId, loaded, engineLevel, at };
}

describe("level stopwatch", () => {
  it("reads 0:00.0 when ARENA_READY fires, however long the solve took", () => {
    const store = createGameStore();
    store.dispatch({ type: "LEVEL_REQUESTED", ref: LOCKBOX_REF, label: "Lockbox", requestId: 1, at: 0 });
    store.dispatch(loadedAction(1, 1, SOLVE_MS));
    expect(elapsedMs(store.getState(), SOLVE_MS)).toBe(0);
    store.dispatch({ type: "ARENA_READY", epoch: 1, at: SOLVE_MS + 40 });
    expect(elapsedMs(store.getState(), SOLVE_MS + 40)).toBe(0);
    expect(elapsedMs(store.getState(), SOLVE_MS + 140)).toBe(100);
  });

  it("restarts from zero after a second level whose solve is slower than the first", () => {
    const store = createGameStore();
    store.dispatch({ type: "LEVEL_REQUESTED", ref: LOCKBOX_REF, label: "Lockbox", requestId: 1, at: 0 });
    store.dispatch(loadedAction(1, 1, 500));
    store.dispatch({ type: "ARENA_READY", epoch: 1, at: 520 });
    expect(elapsedMs(store.getState(), 30_000)).toBe(29_480);

    store.dispatch({ type: "LEVEL_REQUESTED", ref: LOCKBOX_REF, label: "Keyboard", requestId: 2, at: 30_000 });
    expect(elapsedMs(store.getState(), 37_700)).toBe(0);
    store.dispatch(loadedAction(2, 2, 37_700));
    expect(elapsedMs(store.getState(), 37_700)).toBe(0);
    store.dispatch({ type: "ARENA_READY", epoch: 2, at: 37_720 });
    expect(elapsedMs(store.getState(), 37_720)).toBe(0);
  });

  it("ignores ARENA_READY for an old epoch and while a level is loading", () => {
    const store = createGameStore();
    store.dispatch({ type: "LEVEL_REQUESTED", ref: LOCKBOX_REF, label: "Lockbox", requestId: 1, at: 0 });
    store.dispatch({ type: "ARENA_READY", epoch: 1, at: 10 });
    expect(store.getState().clock.runningSince).toBeNull();
    store.dispatch(loadedAction(1, 2, 100));
    store.dispatch({ type: "ARENA_READY", epoch: 1, at: 110 });
    expect(store.getState().clock.runningSince).toBeNull();
    store.dispatch({ type: "ARENA_READY", epoch: 2, at: 120 });
    expect(store.getState().clock).toEqual({ accruedMs: 0, runningSince: 120 });
  });
});

describe("arena bridge level transitions", () => {
  function fakeArena(): { arena: BridgedArena; calls: string[] } {
    const calls: string[] = [];
    const arena: BridgedArena = {
      loadParts: (_parts, epoch) => {
        calls.push(`load:${epoch}`);
      },
      clear: () => {
        calls.push("clear");
      },
      removePart: () => {
        calls.push("remove");
      },
      blockPart: () => {
        calls.push("block");
      },
      showInterlock: () => {
        calls.push("interlock");
      },
    };
    return { arena, calls };
  }

  it("clears the Arena when a level is requested, before the next level loads", () => {
    const store = createGameStore();
    const { arena, calls } = fakeArena();
    const disconnect = connectArenaBridge(arena, store);
    store.dispatch({ type: "LEVEL_REQUESTED", ref: LOCKBOX_REF, label: "Lockbox", requestId: 1, at: 0 });
    store.dispatch(loadedAction(1, 1, 100));
    store.dispatch({ type: "LEVEL_REQUESTED", ref: LOCKBOX_REF, label: "Keyboard", requestId: 2, at: 200 });
    store.dispatch({ type: "LEVEL_REQUESTED", ref: LOCKBOX_REF, label: "Keyboard", requestId: 3, at: 210 });
    store.dispatch(loadedAction(3, 2, 300));
    expect(calls).toEqual(["clear", "load:1", "clear", "load:2"]);
    disconnect();
    store.dispatch({ type: "LEVEL_REQUESTED", ref: LOCKBOX_REF, label: "Lockbox", requestId: 4, at: 400 });
    expect(calls).toHaveLength(4);
  });
});

describe("hint counter label", () => {
  it("uses the singular for one hint and the plural otherwise", () => {
    expect(hintsUsedLabel(1)).toBe("1 hint used");
    expect(hintsUsedLabel(2)).toBe("2 hints used");
  });
});
