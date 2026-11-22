import { useState } from "react";
import type { GameStore } from "../game/store";
import { overBudgetNoticeText } from "./hudModel";
import { useGameState } from "./useGameStore";

/**
 * Non-blocking Over_Budget_Notice (Req 3.4, 3.10, 3.11).
 *
 * Shown while the loaded level carries an `overBudget` warning. The plate sets
 * `pointer-events: none` in CSS, takes no focus, and only its Dismiss button is
 * clickable, so the Arena, hover picking and click picking stay usable. Dismissal
 * is HUD-local state keyed by `loaded.epoch`, so a new load or a replay shows the
 * notice again. Nothing in the reducer or the engine depends on it.
 */
export function OverBudgetNotice({ store }: { store: GameStore }) {
  const state = useGameState(store);
  const [dismissedEpoch, setDismissedEpoch] = useState<number | null>(null);

  if (state.screen.kind !== "level") return null;
  const { overBudget, epoch } = state.screen.loaded;
  if (overBudget === null || dismissedEpoch === epoch) return null;

  return (
    <div className="bz-budget" role="status">
      <p className="bz-budget__text">{overBudgetNoticeText(overBudget)}</p>
      <button
        type="button"
        className="bz-budget__dismiss"
        onClick={() => {
          setDismissedEpoch(epoch);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
