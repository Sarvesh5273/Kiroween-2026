/**
 * View slice reducer: mode, Step_Timeline position, Explode_Slider value, selected step, playback,
 * reduced-motion flag and camera commands.
 *
 * Rules (Requirements 4.5, 10.2, 10.8, 11.1, 11.8, 11.9, 11.10, 13.7, 14.9, 15.4):
 * - `view/modeSet` is gated by `selectModeToggleEnabled` and never touches the solve slice.
 * - The timeline and the Explode_Slider share one position `p`, so `selectedStepIndex` always equals
 *   `activeStepIndex(p, N)` after a timeline or slider change, and `stepSelected(i)` sets `p = i + 1`.
 * - `playing` implies `p < N`, DBG mode, an enabled timeline and no reduced-motion request.
 *
 * Pure. No React, no DOM and no three import.
 */
import { advancePlayback } from "../motion/playback";
import { activeStepIndex, sliderToTimeline } from "../motion/timeline";
import { selectControlEnablement, selectModeToggleEnabled } from "./selectors";
import type { AppState, CameraCommand, CameraKind, SliceReducer, ViewSlice } from "./types";

export const initialViewSlice: ViewSlice = {
  mode: "dbg",
  timelineP: 0,
  naiveExplode: 0,
  selectedStepIndex: null,
  playing: false,
  reducedMotion: false,
  cameraCommand: null,
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Number of steps N that the timeline spans. Zero unless the plan is solved. */
function timelineStepCount(state: AppState): number {
  const plan = state.solve.result?.plan;
  return plan !== undefined && plan.status === "solved" ? plan.steps.length : 0;
}

/** Same value as the plan step list length for solved and deadlocked plans, zero otherwise. */
function planStepCount(state: AppState): number {
  const plan = state.solve.result?.plan;
  return plan !== undefined && plan.status !== "error" ? plan.steps.length : 0;
}

function nextCameraCommand(slice: ViewSlice, kind: CameraKind, partId?: string): CameraCommand {
  const seq = (slice.cameraCommand?.seq ?? 0) + 1;
  return partId === undefined ? { seq, kind } : { seq, kind, partId };
}

/** New timeline position. Selection follows `p`, and playback stops once `p` reaches N. */
function withTimeline(slice: ViewSlice, p: number, n: number): ViewSlice {
  const selectedStepIndex = activeStepIndex(p, n);
  const playing = slice.playing && p < n;
  if (
    p === slice.timelineP &&
    selectedStepIndex === slice.selectedStepIndex &&
    playing === slice.playing
  ) {
    return slice;
  }
  return { ...slice, timelineP: p, selectedStepIndex, playing };
}

export const viewReducer: SliceReducer<ViewSlice> = (slice, action, previous) => {
  switch (action.type) {
    case "solve/started":
      // A new solve starts from the default view. Reduced motion is an OS fact and is kept.
      return {
        ...initialViewSlice,
        reducedMotion: slice.reducedMotion,
        cameraCommand: slice.cameraCommand,
      };

    case "view/modeSet": {
      if (!selectModeToggleEnabled(previous)) return slice;
      if (action.mode === slice.mode) return slice;
      return { ...slice, mode: action.mode, playing: false };
    }

    case "view/timelineSet": {
      if (!Number.isFinite(action.p)) return slice;
      if (!selectControlEnablement(previous).timeline) return slice;
      const n = timelineStepCount(previous);
      return withTimeline(slice, clamp(action.p, 0, n), n);
    }

    case "view/explodeSet": {
      if (!Number.isFinite(action.s)) return slice;
      if (!selectControlEnablement(previous).explodeSlider) return slice;
      const s = clamp(action.s, 0, 1);
      if (slice.mode === "naive") {
        return s === slice.naiveExplode ? slice : { ...slice, naiveExplode: s };
      }
      const n = timelineStepCount(previous);
      return withTimeline(slice, clamp(sliderToTimeline(s, n), 0, n), n);
    }

    case "view/stepSelected": {
      const count = planStepCount(previous);
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= count) return slice;
      const plan = previous.solve.result?.plan;
      const stepPartId =
        plan !== undefined && plan.status !== "error" ? plan.steps[action.index]?.partId : undefined;
      if (stepPartId === undefined) return slice;

      const camera = nextCameraCommand(slice, "focus", stepPartId);
      const n = timelineStepCount(previous);
      if (n === 0) {
        // Deadlocked plan: no trajectory to scrub, so the row only selects and focuses.
        return { ...slice, selectedStepIndex: action.index, cameraCommand: camera };
      }
      const p = action.index + 1;
      return {
        ...slice,
        timelineP: p,
        selectedStepIndex: activeStepIndex(p, n),
        playing: slice.playing && p < n,
        cameraCommand: camera,
      };
    }

    case "view/playRequested": {
      if (!selectControlEnablement(previous).play) return slice;
      const n = timelineStepCount(previous);
      const p = slice.timelineP >= n ? 0 : slice.timelineP;
      return { ...slice, timelineP: p, selectedStepIndex: activeStepIndex(p, n), playing: true };
    }

    case "view/pauseRequested":
      return slice.playing ? { ...slice, playing: false } : slice;

    case "view/tick": {
      if (!slice.playing) return slice;
      if (!selectControlEnablement(previous).play) return { ...slice, playing: false };
      const n = timelineStepCount(previous);
      const p = advancePlayback(slice.timelineP, n, action.deltaSeconds);
      return {
        ...slice,
        timelineP: p,
        selectedStepIndex: activeStepIndex(p, n),
        playing: p < n,
      };
    }

    case "view/cameraRequested": {
      if (action.kind === "focus" && action.partId === undefined) return slice;
      return { ...slice, cameraCommand: nextCameraCommand(slice, action.kind, action.partId) };
    }

    case "env/reducedMotionChanged": {
      const playing = action.reduced ? false : slice.playing;
      if (action.reduced === slice.reducedMotion && playing === slice.playing) return slice;
      return { ...slice, reducedMotion: action.reduced, playing };
    }

    default:
      return slice;
  }
};
