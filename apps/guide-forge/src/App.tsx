/**
 * AppShell: composition only (Requirements 2.4, 6.5, 6.6, 6.7, 17.3).
 *
 * Layout follows the classes in `theme/app.css`: one slim Header_Bar across the top, the optional
 * notice and recovery card, then `gf-main` with the viewport column in the centre and the
 * Manifest_Panel on the right. The 3D canvas is the hero: the camera and view-mode pills, the
 * pipeline telemetry, the comparison card and the toasts all float over it as glass overlays,
 * and the Step timeline with its transport buttons sits in one slim bar under it. Every component
 * reads App_State through the context and changes it by dispatching actions, so this file holds no
 * feature logic.
 */
import type { ReactElement } from "react";
import { StepCaptionBar } from "./authoring/StepCaptionBar";
import { useKeyboardShortcuts } from "./authoring/useKeyboardShortcuts";
import { LiveRegion } from "./a11y/LiveRegion";
import { NoticeBar } from "./feedback/NoticeBar";
import { ProgressStrip } from "./feedback/ProgressStrip";
import { RecoveryCardView } from "./feedback/RecoveryCardView";
import { ToastHost } from "./feedback/ToastHost";
import { HeaderBar } from "./header/HeaderBar";
import { ManifestPanel } from "./panels/ManifestPanel";
import { useAppState } from "./state/AppStateProvider";
import { DropZone } from "./viewport/DropZone";
import { ViewportCanvas } from "./viewport/ViewportCanvas";
import { ViewportErrorBoundary } from "./viewport/ViewportErrorBoundary";
import { StepTimeline, ViewportToolbar } from "./viewport/ViewportToolbar";

export function App(): ReactElement {
  const { feedback } = useAppState();
  useKeyboardShortcuts();
  return (
    <div className="gf-app">
      <HeaderBar />
      <LiveRegion />
      {feedback.notice !== null ? <NoticeBar notice={feedback.notice} /> : null}
      {feedback.recovery !== null ? <RecoveryCardView card={feedback.recovery} /> : null}
      <div className="gf-main">
        <section className="gf-viewport" aria-label="Assembly viewport">
          <ViewportErrorBoundary>
            <DropZone>
              <ViewportCanvas />
              <ViewportToolbar />
              <ProgressStrip />
              <ToastHost />
            </DropZone>
          </ViewportErrorBoundary>
          <StepTimeline />
          <StepCaptionBar />
        </section>
        <ManifestPanel />
      </div>
    </div>
  );
}
