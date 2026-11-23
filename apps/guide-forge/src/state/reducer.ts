/**
 * Root reducer: a pure function of the previous `AppState` and one `AppAction` (Requirement 4.5).
 *
 * It composes the slice reducers. Each slice reducer receives the previous complete state read-only
 * (for example, the view slice reads `previous.solve.result` to know N). When no slice changes, the
 * same state object is returned, so React skips the re-render.
 *
 * After the slices, `reconcileMoveCheck` drops a move-check verdict or pending check whose move no
 * longer matches the current model, Part, direction, distance or present Parts.
 *
 * This module imports no React, no DOM and no three symbol, so tests run it in Node (Requirement 4.6).
 */
import { authoringReducer, initialAuthoringSlice } from "./authoringSlice";
import { feedbackReducer, initialFeedbackSlice } from "./feedbackSlice";
import { initialMoveCheckSlice, moveCheckReducer, reconcileMoveCheck } from "./moveCheck";
import { initialSolveSlice, solveReducer } from "./solveSlice";
import type { AppAction, AppState } from "./types";
import { initialViewSlice, viewReducer } from "./viewSlice";

export const initialState: AppState = {
  solve: initialSolveSlice,
  view: initialViewSlice,
  feedback: initialFeedbackSlice,
  authoring: initialAuthoringSlice,
  moveCheck: initialMoveCheckSlice,
};

export function rootReducer(state: AppState, action: AppAction): AppState {
  const solve = solveReducer(state.solve, action, state);
  const view = viewReducer(state.view, action, state);
  const feedback = feedbackReducer(state.feedback, action, state);
  const authoring = authoringReducer(state.authoring, action, state);
  const moveCheck = moveCheckReducer(state.moveCheck, action, state);
  if (
    solve === state.solve &&
    view === state.view &&
    feedback === state.feedback &&
    authoring === state.authoring &&
    moveCheck === state.moveCheck
  ) {
    return state;
  }
  return reconcileMoveCheck({ solve, view, feedback, authoring, moveCheck });
}
