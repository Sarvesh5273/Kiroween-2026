/**
 * AppShell: composition only (Requirements 2.4, 6.5, 6.6, 6.7, 17.3).
 *
 * Layout follows the classes in `theme/app.css`: the Header_Bar across the top, the strips under
 * it (progress, status line, notice, recovery card), then `gf-main` with the viewport column in the
 * centre and the Manifest_Panel on the right. Every component reads App_State through the context
 * and changes it by dispatching actions, so this file holds no feature logic. Part 2 adds the
 * Step Caption Bar and the global keyboard shortcuts here, and the export button in the header.
 */
import type { ReactElement } from "react";
import { StepCaptionBar } from "./authoring/StepCaptionBar";
import { useKeyboardShortcuts } from "./authoring/useKeyboardShortcuts";
import { LiveRegion, StatusLine } from "./a11y/LiveRegion";
import { NoticeBar } from "./feedback/NoticeBar";
import { ProgressStrip } from "./feedback/ProgressStrip";
import { RecoveryCardView } from "./feedback/RecoveryCardView";
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
      <ProgressStrip />
      <StatusLine />
      <LiveRegion />
      {feedback.notice !== null ? <NoticeBar notice={feedback.notice} /> : null}
      {feedback.recovery !== null ? <RecoveryCardView card={feedback.recovery} /> : null}
      <div className="gf-main">
        <section className="gf-viewport" aria-label="Assembly viewport">
          <ViewportToolbar showTimeline={false} />
          <ViewportErrorBoundary>
            <DropZone>
              <ViewportCanvas />
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
