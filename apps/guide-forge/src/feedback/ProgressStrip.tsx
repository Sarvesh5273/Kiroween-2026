/**
 * Pipeline telemetry in the viewport corner (Requirements 5.6, 6.5, 16.2).
 *
 * - While a solve runs: a thin animated strip across the top of the viewport and a label chip with
 *   the active stage, for example `Stage 2: Building Swept-Ray DBG...`.
 * - Once the solve is done: the strip collapses into a compact `Pipeline · 5.1s` pill. Clicking it
 *   opens the full seven-stage breakdown (`stage0` to `naive`) with the duration of every stage in
 *   milliseconds, so the timing stays inspectable without taking space from the 3D view.
 *
 * Every stage state also appears as text (`running`, `skipped`, a duration), not as colour alone.
 */
import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from "react";
import type { StageName } from "../protocol";
import { useAppState } from "../state/AppStateProvider";
import {
  formatDuration,
  formatStageMs,
  selectPipelineTelemetry,
  type PipelineTelemetry,
  type StageDisplay,
} from "../state/selectors";
import { ChevronDownIcon } from "../ui/icons";

const STAGE_TITLES: Readonly<Record<StageName, string>> = {
  stage0: "Scene parse",
  stage1: "Normalize parts",
  stage2: "Swept-ray DBG",
  stage3: "Peel order",
  stage4: "Compile motion",
  oracle: "Oracle clash check",
  naive: "Naive baseline",
};

function stageValueText(entry: StageDisplay): string {
  switch (entry.state) {
    case "completed":
      return formatStageMs(entry.durationMs);
    case "started":
      return "running";
    case "skipped":
      return "skipped";
    case "pending":
      return "\u2013";
  }
}

function RunningStrip({ telemetry }: { telemetry: PipelineTelemetry }): ReactElement {
  const percent = Math.round(telemetry.fraction * 100);
  const fillStyle: CSSProperties = { width: `${percent}%` };
  return (
    <>
      <div
        className="gf-pipeline__bar"
        role="progressbar"
        aria-label="Solver progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={telemetry.label}
      >
        <span className="gf-pipeline__fill" style={fillStyle} />
      </div>
      <p className="gf-pipeline__chip" aria-hidden="true" data-testid="pipeline-active">
        <span className="gf-pipeline__spinner" />
        <span>{telemetry.label}</span>
      </p>
    </>
  );
}

function StageBreakdown({ telemetry }: { telemetry: PipelineTelemetry }): ReactElement {
  const longest = Math.max(1, ...telemetry.stages.map((entry) => entry.durationMs ?? 0));
  return (
    <>
      <ol className="gf-pipeline__stages" aria-label="Solver stages">
        {telemetry.stages.map((entry) => {
          const share = entry.durationMs === null ? 0 : Math.max(2, (entry.durationMs / longest) * 100);
          const barStyle: CSSProperties = { width: `${share}%` };
          return (
            <li
              key={entry.stage}
              className="gf-pipeline__stage"
              data-stage={entry.stage}
              data-state={entry.state}
            >
              <span className="gf-pipeline__stage-id">{entry.stage}</span>
              <span className="gf-pipeline__stage-name">{STAGE_TITLES[entry.stage]}</span>
              <span className="gf-pipeline__stage-ms">{stageValueText(entry)}</span>
              <span className="gf-pipeline__stage-bar" aria-hidden="true">
                <span style={barStyle} />
              </span>
            </li>
          );
        })}
      </ol>
      <p className="gf-pipeline__total">
        <span>Total</span>
        <span>{formatStageMs(telemetry.totalMs)}</span>
      </p>
    </>
  );
}

function PipelinePill({ telemetry }: { telemetry: PipelineTelemetry }): ReactElement {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="gf-pipeline__pill-wrap" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="gf-pipeline__pill"
        aria-expanded={open}
        aria-controls={panelId}
        title="Show the timing of every pipeline stage"
        onClick={() => setOpen((value) => !value)}
      >
        <span>Pipeline · {formatDuration(telemetry.totalMs)}</span>
        <ChevronDownIcon size={14} className="gf-pipeline__chevron" />
      </button>
      <div id={panelId} className="gf-pipeline__panel" hidden={!open}>
        <StageBreakdown telemetry={telemetry} />
      </div>
    </div>
  );
}

export function ProgressStrip(): ReactElement | null {
  const telemetry = selectPipelineTelemetry(useAppState());
  const running = telemetry.phase === "running";

  // A new solve starts collapsed. The pill is unmounted while the strip runs, so its state resets.
  if (telemetry.phase === "idle") return null;
  return (
    <div className="gf-pipeline" data-phase={telemetry.phase}>
      {running ? <RunningStrip telemetry={telemetry} /> : <PipelinePill telemetry={telemetry} />}
    </div>
  );
}
