import { EXPLICIT_AXES } from "../game/blitzEngine";
import type { ExplicitAxis } from "../game/blitzEngine";
import type { GameStore } from "../game/store";
import { AXIS_LABELS } from "./hudModel";
import { useGameState } from "./useGameStore";

export interface AttemptAxisController {
  setAttemptAxis(axis: ExplicitAxis | null): void;
}

/**
 * "Try along" control. "Auto · puzzle rules" is the normal game: a click lets the engine pick the
 * exit from the solver's blocking graph, with no move check. Choosing an axis makes every click an
 * explicit attempt along exactly that axis, checked in the worker, until Auto is chosen again.
 * Choosing a different axis or Auto cancels an attempt that is still being checked.
 * The pressed chip and its label carry the choice, so it reads without colour or sound.
 */
export function AttemptAxisControl({ store, controller }: { store: GameStore; controller: AttemptAxisController }) {
  const state = useGameState(store);
  const axis = state.attemptAxis;
  const checking = state.pendingAttempt !== null;
  return (
    <div className="bz-axis" role="group" aria-label="Try along axis" data-testid="attempt-axis">
      <span className="bz-axis__label">{checking ? "Checking\u2026" : "Try along"}</span>
      <button
        type="button"
        className="bz-chip bz-axis__chip"
        aria-pressed={axis === null}
        title="Normal game: the puzzle's blocking rules decide each click. Moves are not checked."
        onClick={() => controller.setAttemptAxis(null)}
      >
        Auto · puzzle rules
      </button>
      {EXPLICIT_AXES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          className="bz-chip bz-axis__chip"
          aria-pressed={axis === candidate}
          onClick={() => controller.setAttemptAxis(candidate)}
        >
          {AXIS_LABELS[candidate]}
        </button>
      ))}
    </div>
  );
}
