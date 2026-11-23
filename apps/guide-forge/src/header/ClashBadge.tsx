/**
 * Clash_Badge (Requirements 2.2, 10.3 to 10.6, 9.5): monospace telemetry with a leading SVG status
 * icon and the text from `selectClashBadge`. The icon shape and the words carry the status, so it
 * never depends on colour alone. The text shrinks with an ellipsis before it can push the header
 * past the right edge, and `title` always carries the full wording.
 */
import type { ReactElement } from "react";
import { useAppState } from "../state/AppStateProvider";
import { selectClashBadge, type ClashBadgeModel } from "../state/selectors";
import { CheckIcon, EmptyIcon, InterlockIcon, WarnIcon } from "../ui/icons";

const TONE_BY_ICON: Record<ClashBadgeModel["icon"], string> = {
  check: "gf-clash--ok",
  warn: "gf-clash--bad",
  interlock: "gf-clash--warn",
  unverified: "gf-clash--warn",
  none: "gf-clash--idle",
};

function StatusIcon({ icon }: { icon: ClashBadgeModel["icon"] }): ReactElement {
  switch (icon) {
    case "check":
      return <CheckIcon className="gf-clash__icon" />;
    case "warn":
    case "unverified":
      return <WarnIcon className="gf-clash__icon" />;
    case "interlock":
      return <InterlockIcon className="gf-clash__icon" />;
    case "none":
      return <EmptyIcon className="gf-clash__icon" />;
  }
}

export function ClashBadge(): ReactElement {
  const state = useAppState();
  const badge = selectClashBadge(state.solve.result, state.view.mode);

  return (
    <div
      className={`gf-clash ${TONE_BY_ICON[badge.icon]}`}
      role="status"
      aria-label={`Clash summary: ${badge.text}`}
      title={badge.text}
      data-testid="clash-badge"
    >
      <StatusIcon icon={badge.icon} />
      <span className="gf-clash__text">{badge.text}</span>
    </div>
  );
}
