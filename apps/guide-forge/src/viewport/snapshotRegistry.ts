/**
 * A tiny registry that lets the header's manual exporter ask the viewport for PNG snapshots.
 *
 * `ViewportCanvas` registers a capture function while its `SceneController` exists, the same way
 * `UploadButton` registers the file picker. The exporter calls `captureViewportSnapshot` and needs
 * no reference to the viewport or to three.
 *
 * No React and no DOM type beyond the data URL string the owner returns.
 */
import type { SnapshotOptions } from "./sceneController";

export type SnapshotCapture = (options?: SnapshotOptions) => string | null;

let activeCapture: SnapshotCapture | null = null;

/**
 * Registers the capture function. Returns an unregister function that only clears the
 * registration if it still belongs to the caller, so a StrictMode remount keeps the live one.
 */
export function registerSnapshotCapture(capture: SnapshotCapture): () => void {
  activeCapture = capture;
  return () => {
    if (activeCapture === capture) activeCapture = null;
  };
}

/** A PNG data URL of the viewport, or `null` when no viewport is mounted or WebGL is unavailable. */
export function captureViewportSnapshot(options?: SnapshotOptions): string | null {
  return activeCapture === null ? null : activeCapture(options);
}
