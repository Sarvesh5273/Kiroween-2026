/**
 * "Export HTML" button.
 *
 * Enabled when a solved or deadlocked result is ready. A click captures an assembled and an
 * exploded PNG from the viewport (`snapshotRegistry`), builds the manual with the pure
 * `buildOfflineManualHtml`, and downloads it as one `.html` file through a Blob and a temporary
 * link. Nothing is uploaded. The outcome appears as a floating toast in the viewport corner and
 * goes to the live region, so it reads on mute and with a screen reader.
 */
import type { ReactElement } from "react";
import {
  buildManualInput,
  buildOfflineManualHtml,
  canExportManual,
  manualFileName,
} from "../export/manualExporter";
import { useAppDispatch, useAppState } from "../state/AppStateProvider";
import { FileIcon } from "../ui/icons";
import { captureViewportSnapshot } from "../viewport/snapshotRegistry";

export const EXPORT_TOOLTIP = "Export standalone offline HTML manual";

function downloadHtml(fileName: string, html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started by the time the click returns. Release the Blob on the next turn.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportManualButton(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const enabled = canExportManual(state);

  const onExport = (): void => {
    const snapshots = {
      assembled: captureViewportSnapshot({ pose: "assembled" }),
      exploded: captureViewportSnapshot({ pose: "exploded" }),
    };
    const input = buildManualInput(state, snapshots, new Date().toISOString().slice(0, 10));
    if (input === null) {
      dispatch({
        type: "feedback/toastPosted",
        tone: "warn",
        text: "Export is not available until a plan is ready.",
      });
      return;
    }
    const fileName = manualFileName(input.title);
    downloadHtml(fileName, buildOfflineManualHtml(input));
    const missing = snapshots.assembled === null || snapshots.exploded === null;
    dispatch({
      type: "feedback/toastPosted",
      tone: missing ? "warn" : "ok",
      text: missing
        ? "Manual exported without 3D snapshots (the viewport was unavailable)."
        : `Manual exported: ${fileName}`,
    });
  };

  return (
    <div className="gf-header__group">
      <button
        type="button"
        className="gf-btn gf-btn--primary"
        disabled={!enabled}
        title={enabled ? EXPORT_TOOLTIP : `${EXPORT_TOOLTIP} (available when a plan is ready)`}
        onClick={onExport}
      >
        <FileIcon className="gf-icon" />
        <span>Export HTML</span>
      </button>
    </div>
  );
}
