import { useState } from "react";
import type { GameStore } from "../game/store";
import { edgeFlashTone } from "./hudModel";
import type { EdgeFlashTone } from "./hudModel";
import { useGameEvents } from "./useGameStore";

interface Flash {
  /** Changing the key remounts the element, which replays its CSS animation. */
  key: number;
  tone: EdgeFlashTone | null;
}

/**
 * Brief rim flash at the screen edge: crimson on a blocked attempt or a false alarm, teal on a
 * removed part. It is purely decorative (`aria-hidden`, `pointer-events: none`), and the stylesheet
 * hides it under `prefers-reduced-motion`. The popups, the callout and the live region already
 * carry the same information as text.
 */
export function EdgeFlash({ store }: { store: GameStore }) {
  const [flash, setFlash] = useState<Flash>({ key: 0, tone: null });

  useGameEvents(store, (event) => {
    if (event.kind === "level_loaded") {
      setFlash((prev) => ({ key: prev.key + 1, tone: null }));
      return;
    }
    const tone = edgeFlashTone(event);
    if (tone !== null) setFlash((prev) => ({ key: prev.key + 1, tone }));
  });

  if (flash.tone === null) return null;
  return <div key={flash.key} className={`bz-edge-flash bz-edge-flash--${flash.tone}`} aria-hidden="true" />;
}
