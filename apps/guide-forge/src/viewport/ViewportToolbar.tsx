/**
 * Viewport controls (Requirements 3.6, 11.1, 11.8, 11.9, 11.10, 11.11, 14.9).
 *
 * Two components, both reading App_State through the context and changing it only by dispatching
 * actions. Enablement comes from `selectControlEnablement`. Every disabled control has a visible
 * text reason, so the state does not depend on colour alone (Requirement 16).
 *
 * - `ViewportToolbar` is a pair of frosted-glass pills tucked into the top-left corner of the 3D
 *   view: camera views (Iso, Front, Top, Fit) and view modes (All, Hide Removed, Ghost). It floats
 *   over the canvas, so the canvas keeps the full column height.
 * - `StepTimeline` is the slim bar under the canvas: Prev (K), Play (Space) and Next (J) transport
 *   buttons, a 1x / 3x / 8x playback speed pill right after Play, and one custom blueprint track. In DBG mode the track is the Step_Timeline with
 *   thinned step numbers. In Naive mode the same track is the Explode_Slider, because the timeline
 *   does not apply there and the two never need to be on screen together.
 */
import { useId, type ChangeEvent, type CSSProperties, type ReactElement } from "react";
import { nextStepIndex } from "../authoring/useKeyboardShortcuts";
import { PLAYBACK_SPEEDS } from "../motion/playback";
import type { SolveResult } from "../protocol";
import { useAppDispatch, useAppState } from "../state/AppStateProvider";
import { selectControlEnablement } from "../state/selectors";
import type { AppState, CameraKind, VisibilityMode } from "../state/types";
import { PauseIcon, PlayIcon, StepBackIcon, StepForwardIcon } from "../ui/icons";

const VIEW_BUTTONS: readonly { kind: Extract<CameraKind, "iso" | "front" | "top" | "fit">; label: string; hint: string }[] = [
  { kind: "iso", label: "Iso", hint: "Isometric view of the assembly (1)" },
  { kind: "front", label: "Front", hint: "Front view of the assembly (2)" },
  { kind: "top", label: "Top", hint: "Top view of the assembly (3)" },
  { kind: "fit", label: "Fit", hint: "Frame the whole assembly at its current pose (F)" },
];

const VISIBILITY_BUTTONS: readonly { mode: VisibilityMode; label: string; hint: string }[] = [
  { mode: "all", label: "All", hint: "Show every part" },
  { mode: "hide-removed", label: "Hide Removed", hint: "Hide parts that are already removed, to see the exposed interior" },
  { mode: "ghost-context", label: "Ghost", hint: "Ghost context: fade every part except the current step's part" },
];

const VIEW_MODE_NEEDS_DBG = " (needs UnboltKit DBG mode with a solved plan)";

export const REASON_REDUCED_MOTION = "Autoplay is off (reduced motion)";
export const REASON_INTERLOCKED = "Interlocked assembly: no valid sequence";

/** Number of Steps in the plan. Zero for an error plan or no result. */
export function stepCount(result: SolveResult | null): number {
  if (result === null || result.plan.status === "error") return 0;
  return result.plan.steps.length;
}

/** Visible reason why the Step_Timeline is disabled, or `null` when it is enabled. */
export function timelineDisabledReason(state: AppState): string | null {
  if (selectControlEnablement(state).timeline) return null;
  const { result, status } = state.solve;
  if (result === null) {
    return status === "loading"
      ? "Solving: the timeline is available when the plan is ready"
      : "No plan loaded: choose a kit or a file";
  }
  if (result.plan.status === "error") return "No plan for this file: the timeline is unavailable";
  if (state.view.mode === "naive") return "Step timeline is available in UnboltKit DBG mode";
  if (result.plan.status === "deadlocked") return REASON_INTERLOCKED;
  return "This plan has no steps";
}

/** Visible reason why the Explode_Slider is disabled, or `null` when it is enabled. */
export function explodeDisabledReason(state: AppState): string | null {
  if (selectControlEnablement(state).explodeSlider) return null;
  if (state.view.mode === "dbg") return timelineDisabledReason(state);
  const { result, status } = state.solve;
  if (result === null) {
    return status === "loading"
      ? "Solving: the slider is available when the plan is ready"
      : "No plan loaded: choose a kit or a file";
  }
  return "No naive explode report for this file";
}

/** Largest assembly whose timeline labels every step. */
export const TIMELINE_FULL_LABEL_LIMIT = 20;

/** Label stride for `n` steps: 1 up to 20 steps, 5 for 21 to 50, 20 above 50. */
export function timelineTickStride(n: number): number {
  if (n <= TIMELINE_FULL_LABEL_LIMIT) return 1;
  return n <= 50 ? 5 : 20;
}

/**
 * Step numbers (1-based) that carry a tick label. Every step up to 20 steps. Above that, step 1,
 * every multiple of the stride and step `n`. A multiple closer to `n` than half a stride is dropped
 * so the last label never crowds its neighbour.
 */
export function visibleTickNumbers(n: number): number[] {
  if (n <= 0) return [];
  const stride = timelineTickStride(n);
  if (stride === 1) return Array.from({ length: n }, (_, index) => index + 1);
  const numbers: number[] = [1];
  for (let step = stride; step < n; step += stride) {
    if (n - step >= stride / 2) numbers.push(step);
  }
  if (n !== 1) numbers.push(n);
  return numbers;
}

/** Why Play is unavailable, or `null` when it works or the plan is already playing. */
function playDisabledReason(state: AppState): string | null {
  const enablement = selectControlEnablement(state);
  if (enablement.play || state.view.playing) return null;
  if (state.view.reducedMotion && enablement.timeline) return REASON_REDUCED_MOTION;
  return state.view.mode === "dbg"
    ? timelineDisabledReason(state)
    : "Play is available in UnboltKit DBG mode";
}

export function StepTimeline(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const sliderId = useId();
  const enablement = selectControlEnablement(state);
  const { mode, playing, timelineP, naiveExplode, selectedStepIndex, playbackSpeed } = state.view;
  const n = stepCount(state.solve.result);
  const naive = mode === "naive";

  // One track, two meanings: the timeline position in DBG mode, the explode amount in Naive mode.
  const enabled = enablement.explodeSlider;
  const value = naive ? naiveExplode : timelineP;
  const max = naive ? 1 : Math.max(1, n);
  const shown = enabled ? value : 0;
  // `--fill` is the position as a number from 0 to 1. The stylesheet turns it into the fill stop.
  const trackStyle = { "--fill": String(shown / max) } as CSSProperties;
  const labelled = new Set(naive ? [] : visibleTickNumbers(n));

  const prevIndex = nextStepIndex(selectedStepIndex, n, -1);
  const nextIndex = nextStepIndex(selectedStepIndex, n, 1);
  const explodeReason = explodeDisabledReason(state);
  const playReason = playDisabledReason(state);
  // The speed pill follows Play: it is available exactly when Play or Pause is.
  const playDisabled = !enablement.play && !playing;

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = Number(event.currentTarget.value);
    dispatch(naive ? { type: "view/explodeSet", s: next } : { type: "view/timelineSet", p: next });
  };
  const onStep = (index: number | null): void => {
    if (index !== null) dispatch({ type: "view/stepSelected", index });
  };
  const onPlayPause = (): void => {
    dispatch({ type: playing ? "view/pauseRequested" : "view/playRequested" });
  };

  const readout = naive ? shown.toFixed(2) : n === 0 ? "0 / 0" : `${timelineP.toFixed(2)} / ${n}`;
  const valueText = naive
    ? `${Math.round(shown * 100)} percent exploded`
    : n === 0
      ? "No steps"
      : `Position ${timelineP.toFixed(2)} of ${n} steps`;

  return (
    <section className="gf-timeline" aria-label="Step timeline" data-mode={mode}>
      <div className="gf-transport" role="group" aria-label="Playback">
        <button
          type="button"
          className="gf-transport__btn"
          title="Previous step (K)"
          aria-keyshortcuts="K"
          disabled={prevIndex === null}
          onClick={() => onStep(prevIndex)}
        >
          <StepBackIcon size={14} />
          <span>Prev</span>
          <kbd className="gf-kbd">K</kbd>
        </button>
        <button
          type="button"
          className="gf-transport__btn gf-transport__btn--play"
          title={playing ? "Pause playback (Space)" : "Play the removal sequence (Space)"}
          aria-keyshortcuts="Space"
          disabled={playDisabled}
          onClick={onPlayPause}
        >
          {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
          <span>{playing ? "Pause" : "Play"}</span>
          <kbd className="gf-kbd">Space</kbd>
        </button>
        <div className="gf-speed" role="group" aria-label="Playback speed" data-disabled={playDisabled}>
          {PLAYBACK_SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              className="gf-speed__opt"
              title={`Play the removal sequence at ${speed}x speed`}
              aria-label={`${speed}x speed`}
              aria-pressed={playbackSpeed === speed}
              disabled={playDisabled}
              onClick={() => dispatch({ type: "view/speedSet", speed })}
            >
              {speed}×
            </button>
          ))}
        </div>
        <button
          type="button"
          className="gf-transport__btn"
          title="Next step (J)"
          aria-keyshortcuts="J"
          disabled={nextIndex === null}
          onClick={() => onStep(nextIndex)}
        >
          <span>Next</span>
          <kbd className="gf-kbd">J</kbd>
          <StepForwardIcon size={14} />
        </button>
      </div>

      <div className="gf-timeline__main">
        <div className="gf-timeline__head">
          <label className="gf-timeline__label" htmlFor={sliderId}>
            {naive ? "Explode" : "Step timeline"}
          </label>
          <span className="gf-timeline__value">{readout}</span>
          <span className="gf-timeline__reasons">
            {explodeReason !== null ? (
              <span className="gf-timeline__reason" data-testid="explode-reason" title={explodeReason}>
                {explodeReason}
              </span>
            ) : null}
            {playReason !== null && playReason !== explodeReason ? (
              <span className="gf-timeline__reason" data-testid="play-reason" title={playReason}>
                {playReason}
              </span>
            ) : null}
          </span>
        </div>
        <div className="gf-timeline__track" style={trackStyle}>
          <input
            id={sliderId}
            className="gf-slider gf-slider--blueprint"
            type="range"
            min={0}
            max={max}
            step={naive ? 0.001 : 0.01}
            value={shown}
            disabled={!enabled}
            aria-valuetext={valueText}
            onChange={onChange}
          />
          <ol className="gf-timeline__ticks" aria-label="Steps">
            {naive
              ? null
              : Array.from({ length: n }, (_, index) => (
                  <li key={index} className="gf-timeline__tick">
                    {labelled.has(index + 1) ? (
                      <span className="gf-timeline__tick-label">{index + 1}</span>
                    ) : null}
                  </li>
                ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function ViewportToolbar(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { visibilityMode } = state.authoring;
  // Hide Removed and Ghost read the removal parameter and the active step, so they need DBG mode.
  const viewModesEnabled = selectControlEnablement(state).timeline;

  return (
    <div className="gf-hud gf-hud--top-left" role="toolbar" aria-label="Viewport controls">
      <div className="gf-glass" role="group" aria-label="Camera views">
        {VIEW_BUTTONS.map(({ kind, label, hint }) => (
          <button
            key={kind}
            type="button"
            className="gf-glass__btn"
            title={hint}
            onClick={() => dispatch({ type: "view/cameraRequested", kind })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="gf-glass" role="group" aria-label="View mode">
        {VISIBILITY_BUTTONS.map(({ mode: viewMode, label, hint }) => {
          const disabled = viewMode !== "all" && !viewModesEnabled;
          return (
            <button
              key={viewMode}
              type="button"
              className="gf-glass__btn"
              title={disabled ? `${hint}${VIEW_MODE_NEEDS_DBG}` : hint}
              aria-pressed={visibilityMode === viewMode}
              disabled={disabled}
              onClick={() => dispatch({ type: "authoring/visibilitySet", mode: viewMode })}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
