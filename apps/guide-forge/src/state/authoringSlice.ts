/**
 * Authoring slice reducer: per-step annotations, viewport visibility mode and the Read Aloud flag.
 *
 * - Annotations are keyed by `partId`. Only parts the author changed have an entry, so an untouched
 *   step shows the default tool label that comes from its compiled motion primitive.
 * - `solve/started` clears every annotation, because Part_IDs of the next model are unrelated to
 *   the previous ones. `visibilityMode` resets to `"all"` for the same reason: a pressed "Ghost
 *   context" button must not carry over to a newly loaded kit. `narrationEnabled` is a user
 *   preference and stays.
 * - `authoring/annotationPatched` ignores a `partId` that is not a step of the current plan.
 *
 * Pure. No React, no DOM and no three import.
 */
import type {
  AppAction,
  AppState,
  AuthoringSlice,
  SliceReducer,
  StepAnnotation,
  VisibilityMode,
} from "./types";

export const initialAuthoringSlice: AuthoringSlice = {
  annotations: {},
  visibilityMode: "all",
  narrationEnabled: false,
};

export const EMPTY_ANNOTATION: StepAnnotation = {
  tool: "",
  torque: "",
  warning: "",
  note: "",
  subassembly: "",
  markFlexible: false,
};

/** Longest text a single annotation field may hold. Longer input is cut. */
export const MAX_ANNOTATION_TEXT = 500;

export const VISIBILITY_MODES: readonly VisibilityMode[] = ["all", "hide-removed", "ghost-context"];

/**
 * Default tool label per compiled motion primitive. The key is the primitive name from the
 * trajectory, never a part id or a mesh name.
 */
const DEFAULT_TOOL_BY_PRIMITIVE: Readonly<Record<string, string>> = {
  helical_unscrew: "Hex / Torx Driver",
  linear_slide: "Lift / Spudger",
  two_step_l_slide: "Slide & Release",
};

/** Default tool for a primitive name, or `""` when the step is not compiled or the primitive is unknown. */
export function defaultToolForPrimitive(primitive: string | null): string {
  if (primitive === null) return "";
  return Object.prototype.hasOwnProperty.call(DEFAULT_TOOL_BY_PRIMITIVE, primitive)
    ? (DEFAULT_TOOL_BY_PRIMITIVE[primitive] as string)
    : "";
}

/** The annotation for a part with the default tool filled in when the author left the tool empty. */
export function resolveAnnotation(
  authoring: AuthoringSlice,
  partId: string,
  primitive: string | null,
): StepAnnotation {
  const stored = Object.prototype.hasOwnProperty.call(authoring.annotations, partId)
    ? (authoring.annotations[partId] as StepAnnotation)
    : EMPTY_ANNOTATION;
  const tool = stored.tool.trim() === "" ? defaultToolForPrimitive(primitive) : stored.tool;
  return { ...stored, tool };
}

function isEmptyAnnotation(annotation: StepAnnotation): boolean {
  return (
    annotation.tool === "" &&
    annotation.torque === "" &&
    annotation.warning === "" &&
    annotation.note === "" &&
    annotation.subassembly === "" &&
    !annotation.markFlexible
  );
}

function isStepPart(state: AppState, partId: string): boolean {
  const plan = state.solve.result?.plan;
  if (plan === undefined || plan.status === "error") return false;
  return plan.steps.some((step) => step.partId === partId);
}

const TEXT_FIELDS = ["tool", "torque", "warning", "note", "subassembly"] as const;

function applyPatch(current: StepAnnotation, patch: Partial<StepAnnotation>): StepAnnotation {
  const next: StepAnnotation = { ...current };
  for (const field of TEXT_FIELDS) {
    const value = patch[field];
    if (typeof value === "string") next[field] = value.slice(0, MAX_ANNOTATION_TEXT);
  }
  if (typeof patch.markFlexible === "boolean") next.markFlexible = patch.markFlexible;
  return next;
}

function sameAnnotation(a: StepAnnotation, b: StepAnnotation): boolean {
  return (
    a.tool === b.tool &&
    a.torque === b.torque &&
    a.warning === b.warning &&
    a.note === b.note &&
    a.subassembly === b.subassembly &&
    a.markFlexible === b.markFlexible
  );
}

export const authoringReducer: SliceReducer<AuthoringSlice> = (
  slice,
  action: AppAction,
  previous,
) => {
  switch (action.type) {
    case "solve/started": {
      const hasAnnotations = Object.keys(slice.annotations).length > 0;
      if (!hasAnnotations && slice.visibilityMode === initialAuthoringSlice.visibilityMode) return slice;
      return {
        ...slice,
        annotations: hasAnnotations ? initialAuthoringSlice.annotations : slice.annotations,
        visibilityMode: initialAuthoringSlice.visibilityMode,
      };
    }
    case "authoring/annotationPatched": {
      if (!isStepPart(previous, action.partId)) return slice;
      const has = Object.prototype.hasOwnProperty.call(slice.annotations, action.partId);
      const current = has ? (slice.annotations[action.partId] as StepAnnotation) : EMPTY_ANNOTATION;
      const next = applyPatch(current, action.patch);
      if (sameAnnotation(current, next)) return slice;
      const annotations: Record<string, StepAnnotation> = { ...slice.annotations };
      if (isEmptyAnnotation(next)) delete annotations[action.partId];
      else annotations[action.partId] = next;
      return { ...slice, annotations };
    }
    case "authoring/annotationCleared": {
      if (!Object.prototype.hasOwnProperty.call(slice.annotations, action.partId)) return slice;
      const annotations: Record<string, StepAnnotation> = { ...slice.annotations };
      delete annotations[action.partId];
      return { ...slice, annotations };
    }
    case "authoring/visibilitySet":
      if (!VISIBILITY_MODES.includes(action.mode) || action.mode === slice.visibilityMode) return slice;
      return { ...slice, visibilityMode: action.mode };
    case "authoring/narrationSet":
      return action.enabled === slice.narrationEnabled ? slice : { ...slice, narrationEnabled: action.enabled };
    default:
      return slice;
  }
};
