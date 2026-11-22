import { useEffect, useState } from "react";
import type { GameStore } from "../game/store";
import { calloutReducer } from "./hudModel";
import type { Callout } from "./hudModel";
import { displayNamesOf, useGameEvents } from "./useGameStore";

/**
 * "BLOCKED BY: A, B" (Req 12.4). Visible for 3000 ms from the latest part_blocked event.
 * A new blocked event replaces the text and restarts the window (Req 12.7, 12.8).
 * Event times come from `performance.now()` in the dispatching code, so they compare
 * directly with `performance.now()` here.
 */
export function BlockerCallout({ store }: { store: GameStore }) {
  const [callout, setCallout] = useState<Callout | null>(null);

  useGameEvents(store, (event) => {
    const names = displayNamesOf(store.getState());
    setCallout((prev) => calloutReducer(prev, event, names));
  });

  useEffect(() => {
    if (callout === null) return undefined;
    const remaining = Math.max(0, callout.expiresAt - performance.now());
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setCallout((current) => (current === callout ? null : current));
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [callout]);

  if (callout === null) return null;

  return (
    <div key={callout.expiresAt} className="bz-callout">
      <p className="bz-callout__text">{callout.text}</p>
    </div>
  );
}
