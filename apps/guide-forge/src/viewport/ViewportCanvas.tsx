/**
 * React wrapper around the imperative `SceneController` (Requirements 3.10, 3.11, 4.7).
 *
 * - The controller is created in an effect, so React StrictMode's mount, cleanup and second mount
 *   dispose the first controller and build a second one without leaking WebGL resources.
 * - State is read through the context and pushed into the controller with `update()` in a second
 *   effect that runs after creation. The controller never writes state.
 * - When the controller reports that WebGL is unavailable (creation failed or the context was
 *   lost), the canvas host is replaced by `WebglUnavailable`.
 * - The snapshot capture of the controller is registered in `snapshotRegistry` for the manual
 *   exporter. It renders a fresh frame on demand, so the renderer keeps its default drawing buffer.
 * - Anything the controller throws, for example a primitive `pose` failure, propagates out of the
 *   effect to the `ViewportErrorBoundary` instead of being hidden.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useAppState } from "../state/AppStateProvider";
import { SceneController, type SceneViewModel } from "./sceneController";
import { registerSnapshotCapture } from "./snapshotRegistry";
import { WebglUnavailable } from "./WebglUnavailable";

export function ViewportCanvas(): ReactElement {
  const state = useAppState();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const controller = new SceneController({
      container: host,
      onUnavailable: (reason) => setUnavailableReason(reason),
    });
    controllerRef.current = controller;
    const unregister = registerSnapshotCapture((options) => controller.captureSnapshot(options));
    return () => {
      unregister();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  const { result, status } = state.solve;
  const { mode, timelineP, naiveExplode, selectedStepIndex, reducedMotion, cameraCommand } =
    state.view;
  const { visibilityMode } = state.authoring;

  useEffect(() => {
    const viewModel: SceneViewModel = {
      result,
      mode,
      timelineP,
      naiveExplode,
      selectedStepIndex,
      reducedMotion,
      cameraCommand,
      visibilityMode,
    };
    controllerRef.current?.update(viewModel);
    // The creation effect above runs first on every mount, so the controller exists here.
  }, [
    result,
    mode,
    timelineP,
    naiveExplode,
    selectedStepIndex,
    reducedMotion,
    cameraCommand,
    visibilityMode,
  ]);

  const unavailable = unavailableReason !== null;
  const loading = status === "loading" || (status === "idle" && result === null);

  return (
    <div className="gf-viewport__stage" data-testid="viewport-stage">
      {/* The controller appends its canvas here. React renders no children into this node. */}
      <div ref={hostRef} className="gf-viewport__canvas" />
      {unavailable ? <WebglUnavailable reason={unavailableReason} /> : null}
      {loading && !unavailable ? (
        <p className="gf-viewport__loading" role="status">
          Loading assembly… the solver is running in the background.
        </p>
      ) : null}
    </div>
  );
}
