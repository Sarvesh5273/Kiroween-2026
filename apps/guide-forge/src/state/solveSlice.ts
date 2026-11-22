/**
 * Solve slice reducer: load status, active request, label, latest result and per-stage progress.
 *
 * Request-id gating (Requirement 5.11): `solve/progress`, `solve/succeeded` and `solve/failed`
 * change nothing unless their `requestId` equals `activeRequestId` and the solve is still loading.
 * A message from a terminated worker therefore cannot overwrite the state of a newer solve.
 *
 * Pure. No React, no DOM and no three import.
 */
import type { AppAction, SliceReducer, SolveSlice } from "./types";

export const initialSolveSlice: SolveSlice = {
  status: "idle",
  activeRequestId: null,
  label: null,
  result: null,
  progress: {},
};

/** True when the message belongs to the solve that is currently loading. */
function isCurrentRequest(slice: SolveSlice, requestId: number): boolean {
  return slice.status === "loading" && slice.activeRequestId === requestId;
}

export const solveReducer: SliceReducer<SolveSlice> = (slice, action: AppAction) => {
  switch (action.type) {
    case "solve/started":
      return {
        status: "loading",
        activeRequestId: action.requestId,
        label: action.label,
        result: null,
        progress: {},
      };

    case "solve/progress":
      if (!isCurrentRequest(slice, action.requestId)) return slice;
      return { ...slice, progress: { ...slice.progress, [action.event.stage]: action.event } };

    case "solve/succeeded":
      if (!isCurrentRequest(slice, action.requestId)) return slice;
      return { ...slice, status: "ready", result: action.result };

    case "solve/failed":
      if (!isCurrentRequest(slice, action.requestId)) return slice;
      return { ...slice, status: "failed", result: null };

    default:
      return slice;
  }
};
