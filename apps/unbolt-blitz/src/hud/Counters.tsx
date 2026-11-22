import { useState } from "react";
import { falseAlarms, mistakes } from "../game/selectors";
import type { GameStore } from "../game/store";
import { useGameEvents, useGameState } from "./useGameStore";

interface ShakeKeys {
  mistakes: number;
  falseAlarms: number;
}

function counterClass(value: number, shakeKey: number): string {
  const classes = ["bz-counter"];
  if (value > 0) classes.push("bz-counter--bad");
  if (shakeKey > 0) classes.push("bz-counter--shake");
  return classes.join(" ");
}

/** Mistakes and false alarms, shown as two separate counters (Req 13.5). */
export function Counters({ store }: { store: GameStore }) {
  const state = useGameState(store);
  const [shake, setShake] = useState<ShakeKeys>({ mistakes: 0, falseAlarms: 0 });

  useGameEvents(store, (event) => {
    switch (event.kind) {
      case "part_blocked":
        setShake((prev) => ({ ...prev, mistakes: prev.mistakes + 1 }));
        break;
      case "false_alarm":
        setShake((prev) => ({ ...prev, falseAlarms: prev.falseAlarms + 1 }));
        break;
      case "level_loaded":
        setShake({ mistakes: 0, falseAlarms: 0 });
        break;
      default:
        break;
    }
  });

  const mistakeCount = mistakes(state);
  const falseAlarmCount = falseAlarms(state);

  return (
    <div className="bz-counters">
      <div key={`m${shake.mistakes}`} className={counterClass(mistakeCount, shake.mistakes)}>
        <p className="bz-counter__label">Mistakes</p>
        <span className="bz-counter__value bz-num">{mistakeCount}</span>
      </div>
      <div key={`f${shake.falseAlarms}`} className={counterClass(falseAlarmCount, shake.falseAlarms)}>
        <p className="bz-counter__label">False alarms</p>
        <span className="bz-counter__value bz-num">{falseAlarmCount}</span>
      </div>
    </div>
  );
}
