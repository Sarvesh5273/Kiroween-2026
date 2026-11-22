/**
 * Progress strip: seven chips in pipeline order. Each chip shows the stage name, a text state and
 * the elapsed milliseconds in monospace (Requirements 5.6, 6.5, 16.2).
 */
import type { ReactElement } from "react";
import { useAppState } from "../state/AppStateProvider";
import { selectProgressStrip, type StageDisplay } from "../state/selectors";

const STATE_TEXT: Record<StageDisplay["state"], string> = {
  pending: "pending",
  started: "running",
  completed: "done",
  skipped: "skipped",
};

/** Whole milliseconds with a unit, or an en dash when the stage has no timing. */
export function formatElapsed(elapsedMs: number | null): string {
  return elapsedMs === null ? "\u2013" : `${Math.round(elapsedMs)} ms`;
}

function chipClass(state: StageDisplay["state"]): string {
  // `skipped` uses the base chip, which is already drawn dashed and muted.
  if (state === "started" || state === "completed" || state === "pending") {
    return `gf-progress__chip gf-progress__chip--${state}`;
  }
  return "gf-progress__chip";
}

export function ProgressStrip(): ReactElement {
  const stages = selectProgressStrip(useAppState());
  return (
    <ol className="gf-progress" aria-label="Solver progress">
      {stages.map((entry) => (
        <li key={entry.stage} className={chipClass(entry.state)} data-stage={entry.stage}>
          <span className="gf-progress__name">{entry.stage}</span>
          <span className="gf-progress__state">{STATE_TEXT[entry.state]}</span>
          <span className="gf-progress__ms">{formatElapsed(entry.elapsedMs)}</span>
        </li>
      ))}
    </ol>
  );
}
