/**
 * Announcement outputs (Requirements 16.2, 16.3). Both components render the same
 * `feedback.announcement.text`:
 * - `LiveRegion` is visually hidden and read by assistive technology (`role="status"`, polite).
 * - `StatusLine` is the visible text line, so every state change also reads without a screen reader.
 */
import type { ReactElement } from "react";
import { useAppState } from "../state/AppStateProvider";

export function LiveRegion(): ReactElement {
  const { text } = useAppState().feedback.announcement;
  return (
    <div className="gf-sr-only" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}

export function StatusLine(): ReactElement {
  const { text } = useAppState().feedback.announcement;
  // The live region carries the announcement, so this copy is hidden from the accessibility tree
  // to avoid a double read.
  return (
    <p className="gf-status-line" aria-hidden="true" data-testid="status-line">
      {text.length > 0 ? text : "\u00a0"}
    </p>
  );
}
