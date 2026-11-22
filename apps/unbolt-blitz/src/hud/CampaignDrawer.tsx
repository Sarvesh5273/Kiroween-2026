import { useEffect, useRef, useSyncExternalStore } from "react";
import type { GameState, LevelRef } from "../game/gameState";
import { CAMPAIGN_STAGES, MAX_CAMPAIGN_STARS } from "../modules/campaignStore";
import type { CampaignStore } from "../modules/campaignStore";
import type { BundledLevelId } from "../protocol";
import { UploadIcon } from "./icons";
import { StarRow } from "./StarRow";
import { formatElapsed } from "./hudModel";

function useCampaign(campaign: CampaignStore) {
  return useSyncExternalStore(campaign.subscribe, campaign.getSnapshot, campaign.getSnapshot);
}

/** Integer with comma thousands separators. Locale independent. */
function formatScore(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Text of the upload action inside the drawer. */
export const UPLOAD_CUSTOM_LABEL = "Upload Custom .glb";

/**
 * The compact "Campaign (X/15 ★)" button of the control bar. On narrow screens the full text is
 * visually hidden but stays in the accessible name, and a short "★ X/15" shows instead.
 */
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
      className="bz-chip bz-chip--campaign"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="bz-chip__long">
        Campaign ({totalStars}/{MAX_CAMPAIGN_STARS} ★)
      </span>
      <span className="bz-chip__short" aria-hidden="true">
        <span className="bz-chip__star">★</span> {totalStars}/{MAX_CAMPAIGN_STARS}
      </span>
    </button>
  );
}

function activeRef(state: GameState): LevelRef | null {
  return state.screen.kind === "level" ? state.screen.loaded.ref : state.screen.kind === "loading" ? state.screen.ref : null;
}

/**
 * Frosted-obsidian stage picker: the five stages in order, with stars, difficulty tag, best time,
 * best score and a launch button, plus the "Upload Custom .glb" action pinned below the list.
 * Escape, the Close button and a click on the dimmed backdrop scrim dismiss it. Launching a stage
 * closes it, and so does the upload action, which opens the file picker.
 */
export function CampaignDrawer({
  campaign,
  state,
  onClose,
  onLaunch,
  onUpload,
}: {
  campaign: CampaignStore;
  state: GameState;
  onClose: () => void;
  onLaunch: (levelId: BundledLevelId) => void;
  onUpload: () => void;
}) {
  const { records, totalStars } = useCampaign(campaign);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ref = activeRef(state);
  const active = ref !== null && ref.kind === "bundled" ? ref.levelId : null;
  const customName = ref !== null && ref.kind === "custom" ? ref.fileName : null;
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
              {totalStars}/{MAX_CAMPAIGN_STARS} <span className="bz-drawer__star">★</span> earned
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
        <footer className="bz-drawer__footer">
          <button type="button" className="bz-upload" onClick={onUpload}>
            <UploadIcon />
            <span>{UPLOAD_CUSTOM_LABEL}</span>
          </button>
          <p className="bz-drawer__hint">
            {customName === null
              ? "Or drop a .glb file anywhere on the workbench."
              : `Loaded: ${customName}. Drop another .glb anywhere to swap it.`}
          </p>
        </footer>
      </aside>
    </>
  );
}
