import { useState } from "react";
import type { GameStore } from "../game/store";
import { describeEvent } from "./hudModel";
import { displayNamesOf, useGameEvents } from "./useGameStore";

interface Message {
  id: number;
  text: string;
}

/**
 * Visually hidden `aria-live` region (Req 12.9, 16.6). Every part_removed, part_blocked,
 * false_alarm, trap_flagged and level_completed event is posted as text. Each message
 * renders in a fresh element, so a repeated identical message is announced again.
 */
export function LiveRegion({ store }: { store: GameStore }) {
  const [message, setMessage] = useState<Message | null>(null);

  useGameEvents(store, (event) => {
    const text = describeEvent(event, displayNamesOf(store.getState()));
    if (text.length === 0) return;
    setMessage((prev) => ({ id: (prev?.id ?? 0) + 1, text }));
  });

  return (
    <div className="bz-live" role="status" aria-live="polite" aria-atomic="true">
      {message === null ? null : <span key={message.id}>{message.text}</span>}
    </div>
  );
}
