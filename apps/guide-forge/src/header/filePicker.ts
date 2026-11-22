/**
 * A tiny registry that lets any component open the header's file picker.
 *
 * `UploadButton` registers a function that clicks its hidden `<input type="file">` while it is
 * mounted. Recovery cards and the oversize notice call `openFilePicker()` for their
 * `open-file-picker` action (Requirements 7.10, 7.11, 8.7), so they need no reference to the header.
 *
 * No React, no DOM type beyond the callback the owner registers.
 */

type PickerOpener = () => void;

let activeOpener: PickerOpener | null = null;

/**
 * Registers the function that opens the file picker. Returns an unregister function. The cleanup
 * only clears the registration if it still belongs to the caller, so a StrictMode remount
 * (cleanup of the first mount after the second mount registered) does not drop the live opener.
 */
export function registerFilePicker(open: PickerOpener): () => void {
  activeOpener = open;
  return () => {
    if (activeOpener === open) {
      activeOpener = null;
    }
  };
}

/** Opens the file picker. Returns `false` when no picker is mounted. */
export function openFilePicker(): boolean {
  if (activeOpener === null) return false;
  activeOpener();
  return true;
}
