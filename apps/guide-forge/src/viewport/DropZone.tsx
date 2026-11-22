/**
 * Drop target around the viewport (Requirements 7.2, 7.3).
 *
 * Drag enter and leave events fire for every nested element, so a counter tracks how many are
 * open. The outline and label show while the counter is above zero. A drop passes the first file
 * to `solveFile`, which parses it on the Main_Thread and raises a Recovery_Card for any problem.
 */
import { useCallback, useRef, useState, type DragEvent, type ReactElement, type ReactNode } from "react";
import { buildFailureCard } from "../state/recovery";
import { useAppDispatch, useSolver } from "../state/AppStateProvider";

export const DROP_LABEL_TEXT = "Drop a .glb or .gltf file to load it";

function carriesFiles(event: DragEvent<HTMLElement>): boolean {
  const types = event.dataTransfer?.types;
  return types !== undefined && Array.from(types).includes("Files");
}

export function DropZone({ children }: { children: ReactNode }): ReactElement {
  const solver = useSolver();
  const dispatch = useAppDispatch();
  const counter = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    counter.current += 1;
    setDragging(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!carriesFiles(event)) return;
    // Without preventDefault the browser refuses the drop.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!carriesFiles(event)) return;
    counter.current = Math.max(0, counter.current - 1);
    if (counter.current === 0) setDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      counter.current = 0;
      setDragging(false);
      const file = event.dataTransfer.files.item(0);
      if (file === null) return;
      solver.solveFile(file).catch((thrown: unknown) => {
        // `solveFile` reports its own failures as cards. This covers an unexpected rejection.
        const failure =
          thrown instanceof Error
            ? { name: thrown.name, code: null, message: thrown.message }
            : { name: "NonErrorThrown", code: null, message: String(thrown) };
        dispatch({ type: "recovery/raised", card: buildFailureCard(failure) });
      });
    },
    [solver, dispatch],
  );

  return (
    <div
      className={dragging ? "gf-dropzone gf-dropzone--active" : "gf-dropzone"}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-testid="dropzone"
    >
      {children}
      <div className="gf-dropzone__label" aria-hidden={!dragging}>
        {DROP_LABEL_TEXT}
      </div>
    </div>
  );
}
