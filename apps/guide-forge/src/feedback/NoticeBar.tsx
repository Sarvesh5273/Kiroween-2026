/**
 * Warning notice for an oversize model (Requirements 8.5, 8.6, 8.7).
 *
 * It sits above the results and does not replace them, so the Viewport and Manifest_Panel stay
 * visible while the notice is shown.
 */
import type { ReactElement } from "react";
import { ICONS } from "../ui/icons";
import type { Notice } from "../state/types";
import { FeedbackActions } from "./feedbackActions";

export interface NoticeBarProps {
  notice: Notice;
}

export function NoticeBar({ notice }: NoticeBarProps): ReactElement {
  const Icon = ICONS[notice.icon];
  return (
    <section className="gf-notice gf-notice--warn" aria-label={notice.heading} data-notice-kind={notice.kind}>
      <span className="gf-notice__icon">
        <Icon size={18} />
      </span>
      <div className="gf-notice__text">
        <strong>{notice.heading}</strong> {notice.body}
      </div>
      <FeedbackActions actions={notice.actions} className="gf-notice__actions" />
    </section>
  );
}
