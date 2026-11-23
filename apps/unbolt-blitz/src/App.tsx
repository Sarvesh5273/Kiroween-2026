/**
 * Composition root of the game UI.
 *
 * The `AppController` is created in an effect and disposed in its cleanup, so React StrictMode's
 * mount, cleanup, mount sequence ends with exactly one live controller (and one worker). Children
 * mount in the render after the controller exists; `start()` runs in a later effect of the same
 * commit, so the Arena is already listening when the Lockbox request begins.
 *
 * Layout: ArenaView (canvas), Hud (which also renders the loading plate, completion overlay and live
 * region), the Recovery_Screen when the screen state is `recovery`, a hidden file input shared by the
 * level selector and the recovery screens, and a window-wide drop handler.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { createAppController } from "./appController";
import type { AppController } from "./appController";
import { Hud } from "./hud/Hud";
import type { HoverState } from "./hud/NamePill";
import { useGameState } from "./hud/useGameStore";
import { hintSession } from "./modules/registry";
import { RecoveryScreen } from "./recovery/RecoveryScreen";
import { attachDropTarget } from "./upload/dropTarget";
import { ArenaView } from "./viewport/ArenaView";

function Game({ controller }: { controller: AppController }) {
  const { store } = controller;
  const state = useGameState(store);
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [fatal, setFatal] = useState<Error | null>(null);

  // A rejected load promise is rethrown during render so the error boundary shows the unexpected screen.
  if (fatal !== null) throw fatal;

  const loadFile = useCallback(
    (file: File) => {
      controller.loadFile(file).catch((thrown: unknown) => {
        setFatal(thrown instanceof Error ? thrown : new Error(String(thrown)));
      });
    },
    [controller],
  );

  useEffect(
    () =>
      controller.bindFilePicker(() => {
        inputRef.current?.click();
      }),
    [controller],
  );

  useEffect(() => attachDropTarget(loadFile), [loadFile]);

  const onHover = useCallback((partId: string | null, clientX: number, clientY: number) => {
    setHover(partId === null ? null : { partId, clientX, clientY });
  }, []);

  const onFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.item(0) ?? null;
    // Clear the value so choosing the same file again fires another change event.
    input.value = "";
    if (file !== null) loadFile(file);
  };

  return (
    <>
      <ArenaView store={store} hints={hintSession} onHover={onHover} onPartClick={controller.clickPart} />
      <Hud store={store} controller={controller} hover={hover} />
      {state.screen.kind === "recovery" ? (
        <RecoveryScreen
          cause={state.screen.cause}
          onLoadLockbox={controller.loadLockbox}
          onTryAnotherFile={controller.openFilePicker}
        />
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept=".glb,.gltf"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={onFileChosen}
      />
    </>
  );
}

export function App() {
  const [controller, setController] = useState<AppController | null>(null);

  useEffect(() => {
    const created = createAppController();
    setController(created);
    return () => {
      created.dispose();
    };
  }, []);

  // Runs after the children of this commit have mounted their effects, so the Arena is connected first.
  useEffect(() => {
    controller?.start();
  }, [controller]);

  return (
    <div className="bz-app">
      {controller === null ? null : (
        <AppErrorBoundary onLoadLockbox={controller.loadLockbox} onTryAnotherFile={controller.openFilePicker}>
          <Game controller={controller} />
        </AppErrorBoundary>
      )}
    </div>
  );
}
