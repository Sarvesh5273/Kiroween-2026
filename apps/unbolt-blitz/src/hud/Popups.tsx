import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameStore } from "../game/store";
import { FALSE_ALARM_POPUP_TEXT, popupsFromEvent } from "./hudModel";
import type { Popup } from "./hudModel";
import { useGameEvents } from "./useGameStore";

/** How long a popup stays mounted. The CSS animation fades it out over this time. */
export const POPUP_LIFETIME_MS = 1200;

interface PopupItem extends Popup {
  /** Index within the event's batch. Stacks popups of one event vertically. */
  slot: number;
  /** Deterministic horizontal offset in pixels, so consecutive popups do not overlap. */
  offsetX: number;
}

function popupClass(popup: Popup): string {
  if (popup.text === FALSE_ALARM_POPUP_TEXT) return "bz-popup bz-popup--alarm";
  return popup.tone === "score" ? "bz-popup bz-popup--gain" : "bz-popup bz-popup--penalty";
}

/**
 * Floating `+N`, `+3s` and `FALSE ALARM -250` text (Req 11.5, 12.5, 14.4, 16.1, 16.3, 16.4).
 * Each popup removes itself after `POPUP_LIFETIME_MS`.
 */
export function Popups({ store }: { store: GameStore }) {
  const [items, setItems] = useState<readonly PopupItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useGameEvents(store, (event) => {
    if (event.kind === "level_loaded") {
      setItems([]);
      return;
    }
    const batch = popupsFromEvent(event);
    if (batch.length === 0) return;

    const added: PopupItem[] = batch.map((popup, slot) => {
      const id = nextId.current;
      nextId.current += 1;
      return { ...popup, key: `popup-${id}`, slot, offsetX: ((id % 5) - 2) * 28 };
    });
    const addedKeys = new Set(added.map((popup) => popup.key));
    setItems((prev) => [...prev, ...added]);

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      timers.current.delete(timer);
      setItems((prev) => prev.filter((popup) => !addedKeys.has(popup.key)));
    }, POPUP_LIFETIME_MS);
    timers.current.add(timer);
  });

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return (
    <div className="bz-popups" aria-hidden="true">
      {items.map((popup) => {
        const style = {
          "--popup-x": `calc(50% + ${popup.offsetX}px)`,
          "--popup-y": `calc(38% + ${popup.slot * 44}px)`,
        } as CSSProperties;
        return (
          <span key={popup.key} className={popupClass(popup)} style={style}>
            {popup.text}
          </span>
        );
      })}
    </div>
  );
}
