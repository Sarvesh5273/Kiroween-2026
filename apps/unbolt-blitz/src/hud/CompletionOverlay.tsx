import { useEffect, useRef, useSyncExternalStore } from "react";
import type { GameState } from "../game/gameState";
import type { GameStore } from "../game/store";
import type { CampaignStore } from "../modules/campaignStore";
import type { BundledLevelId } from "../protocol";
import { completionModel } from "./hudModel";
import type { CompletionModel } from "./hudModel";
import { StarRow } from "./StarRow";
import { useGameState } from "./useGameStore";
/** Overlay model from the latest `level_completed` event, or null while the level is in play. */
export function completionOf(state: GameState): CompletionModel | null {
  if (state.engine === null || state.engine.outcome === null) return null;
  for (const event of [...state.events].reverse()) {
    const model = completionModel(event);
    if (model !== null) return model;
  }
  return null;
}
/** Names of the records that the last run set, for the text under the NEW BEST badge. */
function newBestDetail(flags: { score: boolean; time: boolean; stars: boolean }): string {
  const names: string[] = [];
  if (flags.score) names.push("score");
  if (flags.time) names.push("time");
  if (flags.stars) names.push("stars");
  return `New personal best: ${names.join(", ")}`;
}
/**
 * "Victory" or "Interlock Exposed!" with the final stats, the star rating, a NEW BEST badge
 * when a personal record fell, and the Next Stage, Replay and Choose level controls
 * (Req 13.9, 14.2, 14.5, 14.6, 14.7).
 */
export function CompletionOverlay({
  store,
  campaign,
  onChooseLevel,
  onNextStage,
}: {
  store: GameStore;
  campaign: CampaignStore;
  onChooseLevel: () => void;
  onNextStage: (levelId: BundledLevelId) => void;
}) {
  const model = completionOf(useGameState(store));
  const { lastResult } = useSyncExternalStore(campaign.subscribe, campaign.getSnapshot, campaign.getSnapshot);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const visible = model !== null;
  const nextStage = visible && lastResult !== null ? lastResult.next : null;
  useEffect(() => {
    if (visible) primaryRef.current?.focus();
  }, [visible, nextStage]);
  if (model === null) return null;
  const titleClass =
    model.title === "Victory"
      ? "bz-overlay__title bz-overlay__title--victory"
      : "bz-overlay__title bz-overlay__title--interlock";
  return (
    <div className="bz-overlay">
      <div className="bz-overlay__plate" role="dialog" aria-modal="true" aria-labelledby="bz-overlay-title">
        <h2 id="bz-overlay-title" className={titleClass}>
          {model.title}
        </h2>
        {lastResult === null ? null : (
          <div className="bz-rating">
            <StarRow stars={lastResult.stars} size="lg" />
            {lastResult.isNewBest ? (
              <div className="bz-rating__best">
                <span className="bz-badge bz-badge--best">NEW BEST!</span>
                <span className="bz-rating__detail">{newBestDetail(lastResult.newBest)}</span>
              </div>
            ) : null}
            {lastResult.hintsUsed > 0 ? (
              <p className="bz-rating__detail">
                Hints used: {lastResult.hintsUsed}. A run without hints can earn 3 stars.
              </p>
            ) : null}
          </div>
        )}
        <dl className="bz-stats">
          <dt className="bz-stats__label">Score</dt>
          <dd className="bz-stats__value bz-num">{model.score}</dd>
          <dt className="bz-stats__label">Time</dt>
          <dd className="bz-stats__value bz-num">{model.elapsedText}</dd>
          <dt className="bz-stats__label">Mistakes</dt>
          <dd className="bz-stats__value bz-num">{model.mistakes}</dd>
          <dt className="bz-stats__label">False alarms</dt>
          <dd className="bz-stats__value bz-num">{model.falseAlarms}</dd>
        </dl>
        <div className="bz-overlay__actions">
          {nextStage === null ? null : (
            <button
              ref={primaryRef}
              type="button"
              className="bz-button"
              onClick={() => {
                onNextStage(nextStage.levelId);
              }}
            >
              Next Stage →
            </button>
          )}
          <button
            ref={nextStage === null ? primaryRef : undefined}
            type="button"
            className={nextStage === null ? "bz-button" : "bz-button bz-button--ghost"}
            onClick={() => {
              store.dispatch({ type: "REPLAY", at: performance.now() });
            }}
          >
            Replay (R)
          </button>
          <button type="button" className="bz-button bz-button--ghost" onClick={onChooseLevel}>
            Choose level
          </button>
        </div>
      </div>
    </div>
  );
}
