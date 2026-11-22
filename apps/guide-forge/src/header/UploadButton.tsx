/**
 * Upload control (Requirement 7.1): a visible button plus a hidden `<input type="file">` that
 * accepts `.glb` and `.gltf`. The chosen file goes to `useSolver().solveFile`, which parses it on
 * the Main_Thread and raises a Recovery_Card for any unusable file (Requirements 7.10, 7.11).
 *
 * The component registers its opener in `filePicker.ts`, so a Recovery_Card's `open-file-picker`
 * action opens the same dialog.
 */
import { useCallback, useEffect, useRef, type ChangeEvent, type ReactElement } from "react";
import { FileIcon } from "../ui/icons";
import { useSolver } from "../state/AppStateProvider";
import { registerFilePicker } from "./filePicker";

export const FILE_ACCEPT = ".glb,.gltf";

export function UploadButton(): ReactElement {
  const solver = useSolver();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = useCallback((): void => {
    inputRef.current?.click();
  }, []);

  useEffect(() => registerFilePicker(openPicker), [openPicker]);

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Clear the value so choosing the same file again still fires `change`.
    input.value = "";
    if (file === undefined) return;
    // `solveFile` reports every failure as a Recovery_Card and does not reject.
    void solver.solveFile(file);
  };

  return (
    <div className="gf-header__group">
      <input
        ref={inputRef}
        className="gf-file-input"
        type="file"
        accept={FILE_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        data-testid="upload-input"
        onChange={onChange}
      />
      <button
        type="button"
        className="gf-btn"
        title="Upload a .glb or .gltf assembly, or drop one on the viewport"
        onClick={openPicker}
      >
        <FileIcon className="gf-icon" />
        <span>Upload</span>
      </button>
    </div>
  );
}
