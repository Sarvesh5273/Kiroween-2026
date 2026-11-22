/**
 * Viewport toolbar: camera views, view modes (All, Hide removed, Ghost context), Explode_Slider, play and pause, and the Step_Timeline
 * (Requirements 3.6, 11.1, 11.8, 11.9, 11.10, 11.11, 14.9).
 *
 * The component reads App_State through the context and changes it only by dispatching actions.
 * Enablement comes from `selectControlEnablement`. Every disabled control has a visible text
 * reason next to it, so the state does not depend on colour alone (Requirement 16).
 *
 * `ViewportToolbar` renders the control row and, unless `showTimeline` is false, the Step_Timeline
 * below it. A layout that wants the timeline under the canvas passes `showTimeline={false}` and
 * renders `StepTimeline` there.
 */
import { useId, type ChangeEvent, type ReactElement } from "react";
import { timelineToSlider } from "../motion/timeline";
import type { SolveResult } from "../protocol";
import { useAppDispatch, useAppState } from "../state/AppStateProvider";
import { selectControlEnablement } from "../state/selectors";
import type { AppState, CameraKind, VisibilityMode } from "../state/types";
import { PauseIcon, PlayIcon } from "../ui/icons";

const VIEW_BUTTONS: readonly { kind: Extract<CameraKind, "iso" | "front" | "top" | "fit">; label: string; hint: string }[] = [
  { kind: "iso", label: "Iso", hint: "Isometric view of the assembly" },
  { kind: "front", label: "Front", hint: "Front view of the assembly" },
  { kind: "top", label: "Top", hint: "Top view of the assembly" },
  { kind: "fit", label: "Fit", hint: "Frame the whole assembly at its current pose" },
];

const VISIBILITY_BUTTONS: readonly { mode: VisibilityMode; label: string; hint: string }[] = [
  { mode: "all", label: "All", hint: "Show every part" },
  { mode: "hide-removed", label: "Hide removed", hint: "Hide parts that are already removed, to see the exposed interior" },
  { mode: "ghost-context", label: "Ghost context", hint: "Fade every part except the current step's part" },
];

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

/** Current Explode_Slider value `s` in [0, 1]. In DBG mode it is `p / N`, the same position as the timeline. */
function sliderValue(state: AppState): number {
  if (state.view.mode === "naive") return state.view.naiveExplode;
  return timelineToSlider(state.view.timelineP, stepCount(state.solve.result));
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

export function StepTimeline(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const sliderId = useId();
  const n = stepCount(state.solve.result);
  const enabled = selectControlEnablement(state).timeline;
  const reason = timelineDisabledReason(state);
  const p = state.view.timelineP;
  const labelled = new Set(visibleTickNumbers(n));

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    dispatch({ type: "view/timelineSet", p: Number(event.currentTarget.value) });
  };

  return (
    <section className="gf-timeline" aria-label="Step timeline">
      <div className="gf-toolbar__group">
        <label className="gf-toolbar__label" htmlFor={sliderId}>
          Step timeline
        </label>
        <span className="gf-toolbar__value">
          {n === 0 ? "0 / 0" : `${p.toFixed(2)} / ${n}`}
        </span>
      </div>
      <div className="gf-timeline__track">
        <input
          id={sliderId}
          className="gf-slider"
          type="range"
          min={0}
          max={Math.max(1, n)}
          step={0.01}
          value={enabled ? p : 0}
          disabled={!enabled}
          aria-valuetext={n === 0 ? "No steps" : `Position ${p.toFixed(2)} of ${n} steps`}
          onChange={onChange}
        />
        <ol className="gf-timeline__ticks" aria-label="Steps">
          {Array.from({ length: n }, (_, index) => (
            <li key={index} className="gf-timeline__tick">
              {labelled.has(index + 1) ? (
                <span className="gf-timeline__tick-label">{index + 1}</span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      <div className="gf-timeline__reason-slot">
        {reason !== null ? (
          <p className="gf-timeline__reason" data-testid="timeline-reason">
            {reason}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export interface ViewportToolbarProps {
  /** Render the Step_Timeline below the control row. Default `true`. */
  showTimeline?: boolean;
}

export function ViewportToolbar({ showTimeline = true }: ViewportToolbarProps): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const explodeId = useId();
  const enablement = selectControlEnablement(state);
  const { mode, playing, reducedMotion } = state.view;
  const { visibilityMode } = state.authoring;
  // Hide removed and Ghost context read the removal parameter and the active step, so they need DBG mode.
  const viewModesEnabled = enablement.timeline;
  const s = sliderValue(state);
  const explodeReason = explodeDisabledReason(state);

  const onExplode = (event: ChangeEvent<HTMLInputElement>): void => {
    dispatch({ type: "view/explodeSet", s: Number(event.currentTarget.value) });
  };

  const onPlayPause = (): void => {
    dispatch({ type: playing ? "view/pauseRequested" : "view/playRequested" });
  };

  const playReason =
    enablement.play || playing
      ? null
      : reducedMotion && enablement.timeline
        ? REASON_REDUCED_MOTION
        : mode === "dbg"
          ? timelineDisabledReason(state)
          : "Play is available in UnboltKit DBG mode";

  return (
    <>
      <div className="gf-toolbar" role="toolbar" aria-label="Viewport controls">
        <div className="gf-toolbar__group" role="group" aria-label="Camera views">
          {VIEW_BUTTONS.map(({ kind, label, hint }) => (
            <button
              key={kind}
              type="button"
              className="gf-btn gf-btn--compact"
              title={hint}
              onClick={() => dispatch({ type: "view/cameraRequested", kind })}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="gf-toolbar__group" role="group" aria-label="View mode">
          {VISIBILITY_BUTTONS.map(({ mode: viewMode, label, hint }) => (
            <button
              key={viewMode}
              type="button"
              className="gf-btn gf-btn--compact"
              title={hint}
              aria-pressed={visibilityMode === viewMode}
              disabled={viewMode !== "all" && !viewModesEnabled}
              onClick={() => dispatch({ type: "authoring/visibilitySet", mode: viewMode })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="gf-toolbar__group gf-toolbar__group--grow">
          <label className="gf-toolbar__label" htmlFor={explodeId}>
            Explode
          </label>
          <input
            id={explodeId}
            className="gf-slider"
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={enablement.explodeSlider ? s : 0}
            disabled={!enablement.explodeSlider}
            aria-valuetext={`${Math.round(s * 100)} percent`}
            onChange={onExplode}
          />
          <span className="gf-toolbar__value">{s.toFixed(2)}</span>
        </div>

        <div className="gf-toolbar__group">
          <button
            type="button"
            className="gf-btn gf-btn--compact"
            title={playing ? "Pause playback" : "Play the removal sequence"}
            disabled={!enablement.play && !playing}
            onClick={onPlayPause}
          >
            {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
            {playing ? "Pause" : "Play"}
          </button>
        </div>

        {/* Fixed one-line slot: toggling DBG and Naive never changes the toolbar height. */}
        <div className="gf-toolbar__reasons">
          {explodeReason !== null ? (
            <p className="gf-timeline__reason" data-testid="explode-reason" title={explodeReason}>
              {explodeReason}
            </p>
          ) : null}
          {playReason !== null && playReason !== explodeReason ? (
            <p className="gf-timeline__reason" data-testid="play-reason" title={playReason}>
              {playReason}
            </p>
          ) : null}
        </div>
      </div>
      {showTimeline ? <StepTimeline /> : null}
    </>
  );
}
