import { useEffect, useRef, useSyncExternalStore } from "react";
import type { GameState, LevelRef } from "../game/gameState";
import { CAMPAIGN_STAGES, MAX_CAMPAIGN_STARS } from "../modules/campaignStore";
import type { CampaignStore } from "../modules/campaignStore";
import type { BundledLevelId } from "../protocol";
import { StarRow } from "./StarRow";
import { formatElapsed } from "./hudModel";

function useCampaign(campaign: CampaignStore) {
  return useSyncExternalStore(campaign.subscribe, campaign.getSnapshot, campaign.getSnapshot);
}

/** Integer with comma thousands separators. Locale independent. */
function formatScore(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The compact "Campaign (X/15 ★)" button of the top HUD. */
export function CampaignButton({
  campaign,
  open,
  onToggle,
}: {
  campaign: CampaignStore;
  open: boolean;
  onToggle: () => void;
}) {
  const { totalStars } = useCampaign(campaign);
  return (
    <button
      type="button"
      className="bz-chip"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onToggle}
    >
      Campaign ({totalStars}/{MAX_CAMPAIGN_STARS} ★)
    </button>
  );
}

function activeLevelId(state: GameState): BundledLevelId | null {
  const ref: LevelRef | null =
    state.screen.kind === "level" ? state.screen.loaded.ref : state.screen.kind === "loading" ? state.screen.ref : null;
  return ref !== null && ref.kind === "bundled" ? ref.levelId : null;
}

/**
 * Dark-brass stage picker: the five stages in order, with stars, best time, best score and a launch button.
 * Escape, the Close button and a click on the dimmed backdrop scrim dismiss it. Launching a stage closes it.
 */
export function CampaignDrawer({
  campaign,
  state,
  onClose,
  onLaunch,
}: {
  campaign: CampaignStore;
  state: GameState;
  onClose: () => void;
  onLaunch: (levelId: BundledLevelId) => void;
}) {
  const { records, totalStars } = useCampaign(campaign);
  const closeRef = useRef<HTMLButtonElement>(null);
  const active = activeLevelId(state);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);
  return (
    <>
    <div className="bz-drawer-scrim" aria-hidden="true" onClick={onClose} />
    <aside className="bz-drawer" role="dialog" aria-label="Clockwork campaign">
      <header className="bz-drawer__header">
        <div>
          <h2 className="bz-drawer__title">Clockwork Campaign</h2>
          <p className="bz-drawer__total">
            {totalStars}/{MAX_CAMPAIGN_STARS} ★ earned
          </p>
        </div>
        <button ref={closeRef} type="button" className="bz-button bz-button--ghost bz-button--small" onClick={onClose}>
          Close
        </button>
      </header>
      <ol className="bz-drawer__stages">
        {CAMPAIGN_STAGES.map((stage) => {
          const record = records[stage.levelId];
          const isActive = active === stage.levelId;
          return (
            <li key={stage.levelId} className={isActive ? "bz-stage bz-stage--active" : "bz-stage"}>
              <div className="bz-stage__head">
                <span className="bz-stage__number bz-num">{stage.stage}</span>
                <span className="bz-stage__title">{stage.title}</span>
                <StarRow stars={record?.bestStars ?? 0} size="sm" />
              </div>
              <p className="bz-stage__subtitle">
                <span
                  className={`bz-badge bz-badge--${stage.difficulty.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                >
                  {stage.difficulty}
                </span>{" "}
                {stage.subtitle}
              </p>
              <div className="bz-stage__foot">
                <span className="bz-stage__best bz-num">
                  {record === undefined
                    ? "Not cleared yet"
                    : `Best ${formatElapsed(record.bestTimeMs)} · ${formatScore(record.bestScore)} pts`}
                </span>
                <button
                  type="button"
                  className="bz-button bz-button--small"
                  onClick={() => {
                    onLaunch(stage.levelId);
                  }}
                >
                  {isActive ? "Restart" : record === undefined ? "Launch" : "Play again"}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
    </>
  );
}
