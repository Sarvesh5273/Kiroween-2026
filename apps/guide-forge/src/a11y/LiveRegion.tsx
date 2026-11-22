/**
 * Announcement output for assistive technology (Requirements 16.2, 16.3).
 *
 * `LiveRegion` is visually hidden and read by screen readers (`role="status"`, polite). It renders
 * `feedback.announcement.text`, so every state change is spoken. The sighted counterpart is the
 * short floating toast in `feedback/ToastHost`, which appears only for actions and mode switches
 * and fades out, instead of a permanent text strip above the canvas.
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
