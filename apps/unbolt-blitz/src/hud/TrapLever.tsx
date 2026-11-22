import { useState } from "react";
import { outcome } from "../game/selectors";
import type { GameStore } from "../game/store";
import { useGameEvents, useGameState } from "./useGameStore";

/**
 * The "Flag Interlock Trap" lever (Req 13.6, 14.1). It stays enabled for the whole
 * time a level is in play, including while every remaining part is blocked, and shows
 * no special state then (Req 14.8). It shakes briefly after a false alarm.
 */
export function TrapLever({ store }: { store: GameStore }) {
  const state = useGameState(store);
  const [shaking, setShaking] = useState(false);

  useGameEvents(store, (event) => {
    if (event.kind === "false_alarm") setShaking(true);
    if (event.kind === "level_loaded") setShaking(false);
  });

  const inPlay = state.engine !== null && outcome(state) === null;

  return (
    <button
      type="button"
      className={shaking ? "bz-lever bz-lever--shake" : "bz-lever"}
      disabled={!inPlay}
      onClick={() => {
        store.dispatch({ type: "TRAP_FLAGGED", at: performance.now() });
      }}
      onAnimationEnd={() => {
        setShaking(false);
      }}
    >
      <span className="bz-lever__knob" aria-hidden="true" />
      <span className="bz-lever__label">Flag Interlock Trap</span>
    </button>
  );
}
