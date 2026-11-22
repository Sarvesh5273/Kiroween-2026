/**
 * Shared action buttons for the Recovery_Card and the poly-budget notice (Requirements 8.7, 8.8).
 *
 * - `load-sample-kit` dispatches `recovery/dismissed`, then starts a solve of the default kit
 *   (`mechanical-keyboard-65`).
 * - `open-file-picker` opens the header's hidden file input through `header/filePicker`.
 */
import type { ReactElement } from "react";
import { openFilePicker } from "../header/filePicker";
import { DEFAULT_KIT_NAME } from "../kits";
import { useAppDispatch, useSolver } from "../state/AppStateProvider";
import type { RecoveryAction } from "../state/types";

export interface FeedbackActionsProps {
  actions: readonly RecoveryAction[];
  /** Class name of the wrapper, so the card and the notice keep their own layout classes. */
  className: string;
}

export function FeedbackActions({ actions, className }: FeedbackActionsProps): ReactElement {
  const dispatch = useAppDispatch();
  const { solveKit } = useSolver();

  const run = (action: RecoveryAction): void => {
    if (action.id === "load-sample-kit") {
      dispatch({ type: "recovery/dismissed" });
      solveKit(DEFAULT_KIT_NAME);
      return;
    }
    // Returns false when the header's upload control is not mounted. Then there is no picker to
    // open and the user still has the sample-kit action.
    openFilePicker();
  };

  return (
    <div className={className}>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={
            action.id === "load-sample-kit" ? "gf-btn gf-btn--primary" : "gf-btn"
          }
          onClick={() => run(action)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
