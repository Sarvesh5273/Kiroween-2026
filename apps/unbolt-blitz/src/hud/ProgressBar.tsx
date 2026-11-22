import type { CSSProperties } from "react";
import { progress } from "../game/selectors";
import type { GameStore } from "../game/store";
import { useGameState } from "./useGameStore";

/** Removed / Total progress bar with the numeric counts (Req 13.4). */
export function ProgressBar({ store }: { store: GameStore }) {
  const { removed, total } = progress(useGameState(store));
  const ratio = total > 0 ? Math.min(1, removed / total) : 0;
  const fillStyle = { "--progress": ratio } as CSSProperties;

  return (
    <div className="bz-progress">
      <p className="bz-progress__label">Removed</p>
      <span className="bz-progress__count bz-num">{`${removed} / ${total}`}</span>
      <div
        className="bz-progress__track"
        role="progressbar"
        aria-label="Parts removed"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={removed}
      >
        <span className="bz-progress__fill" style={fillStyle} />
      </div>
    </div>
  );
}
