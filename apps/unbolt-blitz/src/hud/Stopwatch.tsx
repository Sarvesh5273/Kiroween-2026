import { useEffect, useState } from "react";
import { elapsedMs } from "../game/selectors";
import type { GameStore } from "../game/store";
import { formatElapsed } from "./hudModel";
import { useGameState } from "./useGameStore";

/** Re-render interval while the clock runs (Req 13.7 asks for at most 100 ms). */
export const STOPWATCH_INTERVAL_MS = 50;

/**
 * Elapsed_Time as `m:ss.t` (Req 13.2). The value is `elapsedMs(state, performance.now())`.
 * A store change (for example a Time_Penalty) re-renders it at once (Req 13.8).
 */
export function Stopwatch({ store }: { store: GameStore }) {
  const state = useGameState(store);
  const [, setTick] = useState(0);

  const running = state.clock.runningSince !== null && state.finalElapsedMs === null;

  useEffect(() => {
    if (!running) return undefined;
    const id: ReturnType<typeof setInterval> = setInterval(() => {
      setTick((n) => n + 1);
    }, STOPWATCH_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, [running]);

  const stopped = state.finalElapsedMs !== null;

  return (
    <div className={stopped ? "bz-stopwatch bz-stopwatch--stopped" : "bz-stopwatch"}>
      <p className="bz-stopwatch__label">Time</p>
      <span className="bz-stopwatch__value bz-num" role="timer">
        {formatElapsed(elapsedMs(state, performance.now()))}
      </span>
    </div>
  );
}
