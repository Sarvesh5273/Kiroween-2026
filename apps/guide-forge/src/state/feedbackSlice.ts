/**
 * Feedback slice reducer: the current Recovery_Card, the oversize notice and the `aria-live` text.
 *
 * - `solve/started` clears the card and the notice.
 * - `solve/succeeded` raises a Recovery_Card for an error plan. For a plan that is not an error and
 *   carries `sampling.polyBudgetExceeded`, it raises the poly-budget notice. The results stay in the
 *   solve slice, so they remain visible beside the notice (Requirements 8.5, 8.6).
 * - `solve/failed` raises a card from the worker failure (Requirement 5.12).
 * - Messages with a stale request id change nothing, like in the solve slice.
 *
 * Every accepted state change also bumps `announcement.seq` with visible text (Requirement 16.2).
 * Pure. No React, no DOM and no three import.
 */
import {
  announceDeadlock,
  announceLoadStarted,
  announceModeChange,
  announceRecovery,
  announceSolveFinished,
} from "./announce";
import { buildFailureCard, buildPolyBudgetNotice, buildRecoveryCard } from "./recovery";
import { selectDeadlockModel, selectModeToggleEnabled } from "./selectors";
import type { FeedbackSlice, Notice, RecoveryCard, SliceReducer } from "./types";

export const initialFeedbackSlice: FeedbackSlice = {
  recovery: null,
  notice: null,
  announcement: { seq: 0, text: "" },
};

function announce(slice: FeedbackSlice, text: string): FeedbackSlice["announcement"] {
  return { seq: slice.announcement.seq + 1, text };
}

export const feedbackReducer: SliceReducer<FeedbackSlice> = (slice, action, previous) => {
  switch (action.type) {
    case "solve/started":
      return { recovery: null, notice: null, announcement: announce(slice, announceLoadStarted(action.label)) };

    case "solve/succeeded": {
      const solve = previous.solve;
      if (solve.status !== "loading" || solve.activeRequestId !== action.requestId) return slice;

      const result = action.result;
      const plan = result.plan;
      const parts: string[] = [announceSolveFinished(result)];
      let recovery: RecoveryCard | null = null;
      let notice: Notice | null = null;

      if (plan.status === "error") {
        recovery = buildRecoveryCard(plan.error);
        parts.push(announceRecovery(recovery));
      } else {
        if (plan.sampling.polyBudgetExceeded) {
          notice = buildPolyBudgetNotice(plan.sampling);
          parts.push(announceRecovery(notice));
        }
        const deadlock = selectDeadlockModel(result);
        if (deadlock !== null) parts.push(announceDeadlock(deadlock));
      }
      return { recovery, notice, announcement: announce(slice, parts.join(" ")) };
    }

    case "solve/failed": {
      const solve = previous.solve;
      if (solve.status !== "loading" || solve.activeRequestId !== action.requestId) return slice;
      const card = buildFailureCard(action.failure);
      return { recovery: card, notice: null, announcement: announce(slice, announceRecovery(card)) };
    }

    case "recovery/raised":
      return { ...slice, recovery: action.card, announcement: announce(slice, announceRecovery(action.card)) };

    case "recovery/dismissed":
      return slice.recovery === null ? slice : { ...slice, recovery: null };

    case "view/modeSet":
      // Announce only a mode change that the view slice accepts.
      if (!selectModeToggleEnabled(previous) || action.mode === previous.view.mode) return slice;
      return { ...slice, announcement: announce(slice, announceModeChange(action.mode)) };

    default:
      return slice;
  }
};
