import type { Ref } from "react";
import { BUNDLED_LEVELS } from "../levels";
import type { GameState, LevelRef } from "../game/gameState";
import type { GameStore } from "../game/store";
import type { BundledLevelId } from "../protocol";
import { useGameState } from "./useGameStore";

/** What the level selector needs from the app shell. */
export interface HudController {
  /** Loads a bundled level and resets the HUD counters (Req 13.13). */
  selectLevel(levelId: BundledLevelId): void;
  /** Opens the hidden file input of the shell (Req 13.11). */
  openFilePicker(): void;
}

export const CUSTOM_LEVEL_LABEL = "Custom .glb drop/upload";

/** The level that is loaded or loading, or null on the idle and recovery screens. */
function currentRef(state: GameState): LevelRef | null {
  switch (state.screen.kind) {
    case "level":
      return state.screen.loaded.ref;
    case "loading":
      return state.screen.ref;
    default:
      return null;
  }
}

/**
 * Six entries: the five bundled levels and "Custom .glb drop/upload" (Req 13.1).
 * The last entry opens the file picker.
 */
export function LevelSelector({
  store,
  controller,
  rootRef,
}: {
  store: GameStore;
  controller: HudController;
  rootRef?: Ref<HTMLElement>;
}) {
  const active = currentRef(useGameState(store));

  return (
    <nav className="bz-levels" aria-label="Level selector" ref={rootRef}>
      <p className="bz-levels__title">Levels</p>
      <ul className="bz-levels__list">
        {BUNDLED_LEVELS.map((level) => {
          const isActive = active !== null && active.kind === "bundled" && active.levelId === level.id;
          return (
            <li key={level.id}>
              <button
                type="button"
                className={isActive ? "bz-levels__item bz-levels__item--active" : "bz-levels__item"}
                aria-current={isActive ? "true" : undefined}
                onClick={() => {
                  controller.selectLevel(level.id);
                }}
              >
                {level.label}
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className={
              active !== null && active.kind === "custom"
                ? "bz-levels__item bz-levels__item--upload bz-levels__item--active"
                : "bz-levels__item bz-levels__item--upload"
            }
            aria-current={active !== null && active.kind === "custom" ? "true" : undefined}
            onClick={() => {
              controller.openFilePicker();
            }}
          >
            {CUSTOM_LEVEL_LABEL}
          </button>
        </li>
      </ul>
    </nav>
  );
}
