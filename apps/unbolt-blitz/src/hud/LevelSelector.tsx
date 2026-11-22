import type { Ref } from "react";
import { findBundledLevel } from "../levels";
import type { GameState, LevelRef } from "../game/gameState";
import type { GameStore } from "../game/store";
import { findStage } from "../modules/campaignStore";
import type { CampaignStore } from "../modules/campaignStore";
import type { BundledLevelId } from "../protocol";
import { CampaignButton } from "./CampaignDrawer";
import { UploadIcon } from "./icons";
import { useGameState } from "./useGameStore";

/** What the level selector needs from the app shell. */
export interface HudController {
  /** Loads a bundled level and resets the HUD counters (Req 13.13). */
  selectLevel(levelId: BundledLevelId): void;
  /** Opens the hidden file input of the shell (Req 13.11). */
  openFilePicker(): void;
}

/** Name of the custom-upload entry. The campaign drawer shows the same action as "Upload Custom .glb". */
export const CUSTOM_LEVEL_LABEL = "Custom .glb drop/upload";

/** The level that is loaded or loading, or null on the idle and recovery screens. */
function currentRef(state: GameState): LevelRef | null {
  switch (state.screen.kind) {
    case "level":
      return state.screen.loaded.ref;
    case "loading":
      return state.screen.ref;
    default:
      return null;
  }
}

/** Two-part label of the active-stage pill. `lead` is null when no level is chosen. */
export interface StageLabel {
  lead: string | null;
  title: string;
}

/** "Stage 1" and "Haunted Clockwork Lockbox" for a bundled level, "Custom" and the file name for an upload. */
export function stageLabel(ref: LevelRef | null): StageLabel {
  if (ref === null) return { lead: null, title: "Choose a stage" };
  if (ref.kind === "custom") return { lead: "Custom", title: ref.fileName };
  const stage = findStage(ref.levelId);
  if (stage !== undefined) return { lead: `Stage ${stage.stage}`, title: stage.title };
  return { lead: null, title: findBundledLevel(ref.levelId)?.label ?? ref.levelId };
}

/** The pill text on one line, for the tooltip and for tests: "Stage 1 · Haunted Clockwork Lockbox". */
export function stageLabelText(label: StageLabel): string {
  return label.lead === null ? label.title : `${label.lead} · ${label.title}`;
}

/**
 * Compact left half of the top-left control bar: the active-stage pill, the Campaign button and the
 * upload icon button. The pill and the Campaign button both open the campaign drawer, which lists the
 * five bundled stages and the "Upload Custom .glb" action. The nav keeps its "Level selector" name.
 */
export function LevelSelector({
  store,
  controller,
  campaign,
  drawerOpen,
  onToggleDrawer,
  rootRef,
}: {
  store: GameStore;
  controller: HudController;
  campaign: CampaignStore;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  rootRef?: Ref<HTMLElement>;
}) {
  const label = stageLabel(currentRef(useGameState(store)));

  return (
    <nav className="bz-bar__nav" aria-label="Level selector" ref={rootRef}>
      <button
        type="button"
        className="bz-stage-pill"
        aria-haspopup="dialog"
        aria-expanded={drawerOpen}
        title={stageLabelText(label)}
        onClick={onToggleDrawer}
      >
        {label.lead === null ? null : (
          <>
            <span className="bz-stage-pill__lead">{label.lead}</span>{" "}
            <span className="bz-stage-pill__dot" aria-hidden="true">
              ·
            </span>{" "}
          </>
        )}
        <span className="bz-stage-pill__title">{label.title}</span>{" "}
        <span className="bz-stage-pill__caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <CampaignButton campaign={campaign} open={drawerOpen} onToggle={onToggleDrawer} />
      <button
        type="button"
        className="bz-icon-button"
        aria-label="Upload custom .glb"
        title="Upload custom .glb"
        onClick={() => {
          controller.openFilePicker();
        }}
      >
        <UploadIcon />
      </button>
    </nav>
  );
}
