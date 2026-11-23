import { useEffect, useState, useSyncExternalStore } from "react";
import type { HintSession } from "../modules/ghostHint";

/** How long the hint banner stays on screen. */
export const HINT_BANNER_MS = 6000;

function useHintSnapshot(hints: HintSession) {
  return useSyncExternalStore(hints.subscribe, hints.getSnapshot, hints.getSnapshot);
}

/** Accessible name of the hint counter: "1 hint used", "2 hints used". */
export function hintsUsedLabel(count: number): string {
  return `${count} ${count === 1 ? "hint" : "hints"} used`;
}

/** The brass "Hint (H)" button. `inPlay` is false while no level is running. */
export function HintButton({
  hints,
  inPlay,
  onAsk,
}: {
  hints: HintSession;
  inPlay: boolean;
  onAsk: () => void;
}) {
  const { hintsUsed } = useHintSnapshot(hints);
  return (
    <button
      type="button"
      className="bz-button bz-hint-button"
      disabled={!inPlay}
      aria-keyshortcuts="H"
      onClick={onAsk}
    >
      <span className="bz-hint-button__label">Hint (H)</span>
      <span className="bz-hint-button__cost">Max 2 stars</span>
      {hintsUsed > 0 ? (
        <span className="bz-hint-button__count" aria-label={hintsUsedLabel(hintsUsed)}>
          {hintsUsed}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Text banner that repeats the hint, so a player on mute or without the 3D ghost still gets it.
 * It is a polite live region, so a screen reader announces it too.
 */
export function HintBanner({ hints }: { hints: HintSession }) {
  const { banner, hintsUsed, firstMove } = useHintSnapshot(hints);
  const [dismissedId, setDismissedId] = useState<number | null>(null);
  const bannerId = banner?.id ?? null;
  useEffect(() => {
    if (bannerId === null) return undefined;
    const timer = window.setTimeout(() => {
      setDismissedId(bannerId);
    }, HINT_BANNER_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [bannerId]);
  const visible = banner !== null && dismissedId !== banner.id;
  return (
    <div role="status" aria-live="polite">
      {visible ? (
        <div
          className={
            banner.kind === "deadlock" ? "bz-hint-banner bz-hint-banner--deadlock" : "bz-hint-banner"
          }
        >
          <p className="bz-hint-banner__text">{banner.text}</p>
          <p className="bz-hint-banner__meta">
            Hints used this run: {hintsUsed}. Each hint costs the 3-star rating.
          </p>
        </div>
      ) : firstMove !== null ? (
        <div className="bz-hint-banner">
          <p className="bz-hint-banner__text">Click the highlighted lid screw to remove it.</p>
        </div>
      ) : null}
    </div>
  );
}
