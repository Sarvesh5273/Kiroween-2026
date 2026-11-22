/** The part of `Window` the drop handling needs. */
export interface DropHost {
  addEventListener(type: "dragover" | "drop", listener: (event: DragEvent) => void): void;
  removeEventListener(type: "dragover" | "drop", listener: (event: DragEvent) => void): void;
}

/** First file of a drop, or null when the drop carries no file. */
export function firstDroppedFile(transfer: DataTransfer | null): File | null {
  if (transfer === null || transfer.files.length === 0) return null;
  return transfer.files.item(0);
}

function carriesFiles(transfer: DataTransfer | null): boolean {
  return transfer !== null && Array.from(transfer.types).includes("Files");
}

/**
 * Treats a file dropped anywhere on the window as a Custom_Upload and forwards the first file.
 * Returns a function that removes the listeners.
 */
export function attachDropTarget(onFile: (file: File) => void, host: DropHost = window): () => void {
  const onDragOver = (event: DragEvent): void => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Cancelling dragover is what allows the drop to happen.
    event.preventDefault();
  };
  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    const file = firstDroppedFile(event.dataTransfer);
    if (file !== null) onFile(file);
  };
  host.addEventListener("dragover", onDragOver);
  host.addEventListener("drop", onDrop);
  return () => {
    host.removeEventListener("dragover", onDragOver);
    host.removeEventListener("drop", onDrop);
  };
}
