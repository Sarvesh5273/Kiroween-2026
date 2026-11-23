/**
 * App_State and App_Action types.
 *
 * Types only. No React, no DOM and no three import, so reducers, selectors and tests run in Node.
 * The `authoring` slice (Part 2) holds per-step annotations and the viewport visibility mode.
 */
import type {
  MoveCheckResult,
  SolveFailure,
  SolveLabel,
  SolveResult,
  StageName,
  StageProgressEvent,
} from "../protocol";

export type LoadStatus = "idle" | "loading" | "ready" | "failed";

/** `dbg` is the UnboltKit DBG plan. `naive` is the Naive Radial Explode. */
export type Mode = "dbg" | "naive";

/** Camera command kinds. `focus` carries a `partId`. */
export type CameraKind = "iso" | "front" | "top" | "fit" | "focus";

/** Command with a sequence number, so the viewport reacts once per command. */
export interface CameraCommand {
  seq: number;
  kind: CameraKind;
  partId?: string;
}

export type RecoveryKind =
  | "monolithic"
  | "empty-assembly"
  | "invalid-geometry"
  | "configuration"
  | "unsupported-extension"
  | "load-failure"
  | "worker-failure";

export type RecoveryIcon = "island" | "empty" | "geometry" | "config" | "file" | "worker";

export interface RecoveryAction {
  id: "load-sample-kit" | "open-file-picker";
  label: string;
}

export interface RecoveryCard {
  kind: RecoveryKind;
  icon: RecoveryIcon;
  heading: string;
  /** Plain-language explanation with the specific numbers and paths. */
  body: string;
  /** For example node paths, one per entry. */
  details: string[];
  actions: RecoveryAction[];
}

export interface Notice {
  kind: "poly-budget";
  icon: "warn";
  heading: string;
  body: string;
  actions: RecoveryCard["actions"];
}

export interface SolveSlice {
  status: LoadStatus;
  activeRequestId: number | null;
  label: SolveLabel | null;
  result: SolveResult | null;
  /** Latest event per stage. */
  progress: Partial<Record<StageName, StageProgressEvent>>;
}

/** Playback speed multiplier on the base rate of one timeline step per second. */
export type PlaybackSpeed = 1 | 3 | 8;
export interface ViewSlice {
  mode: Mode;
  /** Step_Timeline position in [0, N]. */
  timelineP: number;
  /** Explode_Slider value in [0, 1] while mode is "naive". */
  naiveExplode: number;
  selectedStepIndex: number | null;
  playing: boolean;
  /** Multiplier applied to the playback rate. A user preference, so a new solve keeps it. */
  playbackSpeed: PlaybackSpeed;
  reducedMotion: boolean;
  cameraCommand: CameraCommand | null;
}

/** Visual weight of a transient toast. The text carries the meaning, the tone only styles it. */
export type ToastTone = "ok" | "info" | "warn";

/**
 * Latest transient message for the floating toast in the viewport corner. `seq` increases with
 * every post, so the view can restart its timer for a repeated message. The slice keeps the last
 * toast; the toast host decides how long it stays visible.
 */
export interface Toast {
  seq: number;
  tone: ToastTone;
  text: string;
}

export interface FeedbackSlice {
  recovery: RecoveryCard | null;
  notice: Notice | null;
  announcement: { seq: number; text: string };
  toast: Toast | null;
}

/** Which parts the viewport draws. `hide-removed` and `ghost-context` apply in DBG mode. */
export type VisibilityMode = "all" | "hide-removed" | "ghost-context";

/** What the author wrote for one step. An empty `tool` means "use the default for the primitive". */
export interface StepAnnotation {
  tool: string;
  torque: string;
  warning: string;
  note: string;
  subassembly: string;
  markFlexible: boolean;
}

export interface AuthoringSlice {
  /** Only parts with at least one non-default field have an entry, keyed by `partId`. */
  annotations: Readonly<Record<string, StepAnnotation>>;
  visibilityMode: VisibilityMode;
  /** Read Aloud preference. The manual stays complete without it. */
  narrationEnabled: boolean;
}

/** One of the six model axes that "Check this move" offers. */
export type AxisDirection = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";
/**
 * "Check this move": the user's choice of Part, direction and travel, plus the check in flight
 * and the latest answer. `pending` and `outcome` carry the key of the exact move they are about
 * (solve, Part, direction, distance and present Parts). The root reducer drops either one as soon
 * as the current key differs, so a verdict never outlives the move it describes.
 */
export interface MoveCheckSlice {
  partId: string | null;
  direction: AxisDirection | null;
  /** The travel field as typed, in model units. */
  distanceText: string;
  pending: { checkId: number; key: string } | null;
  outcome:
    | { checkId: number; key: string; kind: "result"; result: MoveCheckResult }
    | { checkId: number; key: string; kind: "failure"; failure: SolveFailure }
    | null;
}
export interface AppState {
  solve: SolveSlice;
  view: ViewSlice;
  feedback: FeedbackSlice;
  authoring: AuthoringSlice;
  moveCheck: MoveCheckSlice;
}

export type AppAction =
  | { type: "solve/started"; requestId: number; label: SolveLabel }
  | { type: "solve/progress"; requestId: number; event: StageProgressEvent }
  | { type: "solve/succeeded"; requestId: number; result: SolveResult }
  | { type: "solve/failed"; requestId: number; failure: SolveFailure }
  | { type: "recovery/raised"; card: RecoveryCard }
  | { type: "recovery/dismissed" }
  | { type: "feedback/toastPosted"; tone: ToastTone; text: string }
  | { type: "view/modeSet"; mode: Mode }
  | { type: "view/timelineSet"; p: number }
  | { type: "view/explodeSet"; s: number }
  | { type: "view/stepSelected"; index: number }
  | { type: "view/playRequested" }
  | { type: "view/pauseRequested" }
  | { type: "view/speedSet"; speed: PlaybackSpeed }
  | { type: "view/tick"; deltaSeconds: number }
  | { type: "view/cameraRequested"; kind: CameraKind; partId?: string }
  | { type: "env/reducedMotionChanged"; reduced: boolean }
  | { type: "authoring/annotationPatched"; partId: string; patch: Partial<StepAnnotation> }
  | { type: "authoring/annotationCleared"; partId: string }
  | { type: "authoring/visibilitySet"; mode: VisibilityMode }
  | { type: "authoring/narrationSet"; enabled: boolean }
  | { type: "moveCheck/partSelected"; partId: string | null }
  | { type: "moveCheck/directionSelected"; direction: AxisDirection | null }
  | { type: "moveCheck/distanceSet"; text: string }
  | { type: "moveCheck/started"; requestId: number; checkId: number; key: string }
  | { type: "moveCheck/completed"; requestId: number; checkId: number; result: MoveCheckResult }
  | { type: "moveCheck/failed"; requestId: number; checkId: number; failure: SolveFailure };

/** A slice reducer reads the previous complete state read-only and returns the same slice object when nothing changes. */
export type SliceReducer<S> = (slice: S, action: AppAction, previous: AppState) => S;
