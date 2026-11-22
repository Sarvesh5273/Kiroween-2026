import { useState } from "react";
import { combo, score } from "../game/selectors";
import type { GameStore } from "../game/store";
import { useGameEvents, useGameState } from "./useGameStore";

type ComboCueMode = "pulse" | "reset" | null;

interface ComboCue {
  /** Changing the key remounts the badge, which replays its CSS animation. */
  key: number;
  mode: ComboCueMode;
}

const MAX_COMBO = 8;

/**
 * Score and combo badge. The badge pulses when the combo changes (Req 16.2) and
 * flashes crimson on a blocked attempt or a false alarm, which reset it to x1 (Req 12.6).
 */
export function ScoreCombo({ store }: { store: GameStore }) {
  const state = useGameState(store);
  const [cue, setCue] = useState<ComboCue>({ key: 0, mode: null });

  useGameEvents(store, (event) => {
    switch (event.kind) {
      case "part_removed":
        if (event.comboBefore !== event.comboAfter) {
          setCue((prev) => ({ key: prev.key + 1, mode: "pulse" }));
        }
        break;
      case "part_blocked":
      case "false_alarm":
        setCue((prev) => ({ key: prev.key + 1, mode: "reset" }));
        break;
      case "level_loaded":
        setCue((prev) => ({ key: prev.key + 1, mode: null }));
        break;
      default:
        break;
    }
  });

  const value = combo(state);
  const classes = ["bz-combo", "bz-num"];
  if (value >= MAX_COMBO) classes.push("bz-combo--max");
  if (cue.mode === "pulse") classes.push("bz-combo--pulse");
  if (cue.mode === "reset") classes.push("bz-combo--reset");

  return (
    <div className="bz-score">
      <div>
        <p className="bz-score__label">Score</p>
        <span className="bz-score__value bz-num">{score(state)}</span>
      </div>
      <span key={cue.key} className={classes.join(" ")} aria-label={`Combo x${value}`}>
        {`x${value}`}
      </span>
    </div>
  );
}
