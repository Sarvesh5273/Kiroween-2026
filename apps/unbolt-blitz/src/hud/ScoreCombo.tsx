import { useState } from "react";
import { combo, score } from "../game/selectors";
import type { GameStore } from "../game/store";
import { comboTier } from "./hudModel";
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
 * Its look escalates with the multiplier through `comboTier`: brass border at x1, amber glow at
 * x2 to x3, golden halo at x4 to x6 and spectral teal halo at x7 to x8. The number stays in the
 * badge text and in its accessible name, so the tier is never the only carrier of the value.
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
  const tier = comboTier(value);
  const classes = ["bz-combo", "bz-num", `bz-combo--${tier}`];
  if (value >= MAX_COMBO) classes.push("bz-combo--max");
  if (cue.mode === "pulse") classes.push("bz-combo--pulse");
  if (cue.mode === "reset") classes.push("bz-combo--reset");

  return (
    <div className="bz-score">
      <div>
        <p className="bz-score__label">Score</p>
        <span className="bz-score__value bz-num">{score(state)}</span>
      </div>
      <span key={cue.key} className={classes.join(" ")} data-tier={tier} aria-label={`Combo x${value}`}>
        {`x${value}`}
      </span>
    </div>
  );
}
