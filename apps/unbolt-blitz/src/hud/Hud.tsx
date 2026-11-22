import { useCallback, useRef, useState } from "react";
import { outcome } from "../game/selectors";
import type { GameStore } from "../game/store";
import { campaignStore, hintSession, soundModule } from "../modules/registry";
import type { BundledLevelId } from "../protocol";
import { BlockerCallout } from "./BlockerCallout";
import { CampaignButton, CampaignDrawer } from "./CampaignDrawer";
import { CompletionOverlay } from "./CompletionOverlay";
import { Counters } from "./Counters";
import { HintBanner, HintButton } from "./HintControls";
import { LevelSelector } from "./LevelSelector";
import type { HudController } from "./LevelSelector";
import { LiveRegion } from "./LiveRegion";
import { LoadingPlate } from "./LoadingPlate";
import { NamePill } from "./NamePill";
import type { HoverState } from "./NamePill";
import { OverBudgetNotice } from "./OverBudgetNotice";
import { Popups } from "./Popups";
import { ProgressBar } from "./ProgressBar";
import { useGlobalShortcuts } from "./shortcuts";
import { ScoreCombo } from "./ScoreCombo";
import { SoundToggle } from "./SoundToggle";
import { Stopwatch } from "./Stopwatch";
import { TrapLever } from "./TrapLever";
import { useGameState } from "./useGameStore";

export interface HudProps {
  store: GameStore;
  controller: HudController;
  /** Hovered part from the Arena's `onHover`, or null. Drives the name pill. */
  hover: HoverState | null;
}

/**
 * Floating HUD laid over the Arena. A hover, click, popup loop with bevelled plates:
 * no panel layout, manifest list or step timeline (Req 15.6).
 *
 * `.bz-hud` sets `pointer-events: none` and children inherit it. Elements that must
 * receive the pointer (name pill, popups, loading plate, completion overlay, live region)
 * are siblings of `.bz-hud`, not children, so they never inherit that value.
 */
export function Hud({ store, controller, hover }: HudProps) {
  const state = useGameState(store);
  const selectorRef = useRef<HTMLElement>(null);
  const [hiddenOverlayEpoch, setHiddenOverlayEpoch] = useState<number | null>(null);

  const epoch = state.screen.kind === "level" ? state.screen.loaded.epoch : null;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const inPlay = state.engine !== null && outcome(state) === null;
  const completed = state.engine !== null && outcome(state) !== null;
  const askHint = useCallback(() => {
    const current = store.getState();
    if (current.screen.kind !== "level") return;
    hintSession.request(current.engine, current.screen.loaded.displayNames);
  }, [store]);
  useGlobalShortcuts(
    {
      hint: askHint,
      mute: () => {
        soundModule.toggleMuted();
      },
      replay: () => {
        store.dispatch({ type: "REPLAY", at: performance.now() });
      },
    },
    { completed },
  );
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);
  const launchStage = (levelId: BundledLevelId) => {
    setDrawerOpen(false);
    controller.selectLevel(levelId);
  };
  const chooseLevel = () => {
    setHiddenOverlayEpoch(epoch);
    selectorRef.current?.querySelector("button")?.focus();
  };

  return (
    <>
      <div className="bz-hud">
        <div className="bz-hud__top-left">
          <LevelSelector store={store} controller={controller} rootRef={selectorRef} />
          <div className="bz-chips">
            <CampaignButton
              campaign={campaignStore}
              open={drawerOpen}
              onToggle={() => {
                setDrawerOpen((open) => !open);
              }}
            />
            <SoundToggle sound={soundModule} />
          </div>
        </div>
        <div className="bz-hud__top-center">
          <Stopwatch store={store} />
        </div>
        <div className="bz-hud__top-right">
          <ScoreCombo store={store} />
          <ProgressBar store={store} />
          <Counters store={store} />
        </div>
        <div className="bz-hud__bottom-left">
          <OverBudgetNotice store={store} />
        </div>
        <div className="bz-hud__notices">
          <BlockerCallout store={store} />
          <HintBanner hints={hintSession} />
        </div>
        <div className="bz-hud__bottom-right">
          <HintButton hints={hintSession} inPlay={inPlay} onAsk={askHint} />
          <TrapLever store={store} />
        </div>
      </div>
      <Popups store={store} />
      <NamePill store={store} hover={hover} />
      <LoadingPlate store={store} />
      {epoch !== null && hiddenOverlayEpoch === epoch ? null : (
        <CompletionOverlay
          store={store}
          campaign={campaignStore}
          onChooseLevel={chooseLevel}
          onNextStage={launchStage}
        />
      )}
      {drawerOpen ? (
        <CampaignDrawer campaign={campaignStore} state={state} onClose={closeDrawer} onLaunch={launchStage} />
      ) : null}
      <LiveRegion store={store} />
    </>
  );
}
