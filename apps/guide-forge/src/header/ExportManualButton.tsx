/**
 * "Export Manual (.html)" button.
 *
 * Enabled when a solved or deadlocked result is ready. A click captures an assembled and an
 * exploded PNG from the viewport (`snapshotRegistry`), builds the manual with the pure
 * `buildOfflineManualHtml`, and downloads it as one `.html` file through a Blob and a temporary
 * link. Nothing is uploaded. The result is reported as visible text, so it reads on mute.
 */
import { useState, type ReactElement } from "react";
import {
  buildManualInput,
  buildOfflineManualHtml,
  canExportManual,
  manualFileName,
} from "../export/manualExporter";
import { useAppState } from "../state/AppStateProvider";
import { FileIcon } from "../ui/icons";
import { captureViewportSnapshot } from "../viewport/snapshotRegistry";

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
  const enabled = canExportManual(state);
  const [message, setMessage] = useState<string>("");

  const onExport = (): void => {
    const snapshots = {
      assembled: captureViewportSnapshot({ pose: "assembled" }),
      exploded: captureViewportSnapshot({ pose: "exploded" }),
    };
    const input = buildManualInput(state, snapshots, new Date().toISOString().slice(0, 10));
    if (input === null) {
      setMessage("Export is not available until a plan is ready.");
      return;
    }
    downloadHtml(manualFileName(input.title), buildOfflineManualHtml(input));
    const missing = snapshots.assembled === null || snapshots.exploded === null;
    setMessage(
      missing
        ? "Manual exported without 3D snapshots (the viewport was unavailable)."
        : `Manual exported: ${manualFileName(input.title)}`,
    );
  };

  return (
    <div className="gf-header__group gf-export">
      <button
        type="button"
        className="gf-btn gf-btn--primary"
        disabled={!enabled}
        title={enabled ? "Download a single-file offline manual" : "Available when a plan is ready"}
        onClick={onExport}
      >
        <FileIcon className="gf-icon" />
        <span>Export Manual (.html)</span>
      </button>
      {message !== "" ? (
        <span className="gf-export__message" role="status" data-testid="export-message">
          {message}
        </span>
      ) : null}
    </div>
  );
}
