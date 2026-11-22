/**
 * Recovery_Card: icon, heading, body, details and actions (Requirements 8.7, 8.9, 8.10).
 *
 * The card takes keyboard focus whenever a new card is shown. `tabIndex={-1}` makes it focusable
 * by script without adding it to the tab order.
 */
import { useEffect, useId, useRef, type ReactElement } from "react";
import { ICONS } from "../ui/icons";
import type { RecoveryCard } from "../state/types";
import { FeedbackActions } from "./feedbackActions";

export interface RecoveryCardViewProps {
  card: RecoveryCard;
}

export function RecoveryCardView({ card }: RecoveryCardViewProps): ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const headingId = useId();
  const Icon = ICONS[card.icon];

  // Re-runs for every new card object, so a replacement card also receives focus.
  useEffect(() => {
    ref.current?.focus();
  }, [card]);

  return (
    <section
      ref={ref}
      className="gf-recovery"
      tabIndex={-1}
      aria-labelledby={headingId}
      data-recovery-kind={card.kind}
    >
      <span className="gf-recovery__icon">
        <Icon size={32} />
      </span>
      <h2 id={headingId} className="gf-recovery__heading">
        {card.heading}
      </h2>
      <p className="gf-recovery__body">{card.body}</p>
      {card.details.length > 0 ? (
        <ul className="gf-recovery__details">
          {card.details.map((detail, index) => (
            <li key={`${index}:${detail}`}>{detail}</li>
          ))}
        </ul>
      ) : null}
      <FeedbackActions actions={card.actions} className="gf-recovery__actions" />
    </section>
  );
}
