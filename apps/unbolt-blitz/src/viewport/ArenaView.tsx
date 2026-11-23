/**
 * React host of the Arena (design: "Arena", Req 9.9, 9.10, 10.2, 10.4, 13.10).
 *
 * Owns the canvas. An effect constructs one `Arena` per mount, connects the
 * event bridge and disposes both in its cleanup. Each effect run builds its own
 * Arena and releases it in its own cleanup, so React StrictMode's
 * mount, cleanup, mount sequence ends with exactly one live Arena.
 *
 * - `WebglUnavailableError` from the constructor renders `WebglUnavailable`.
 * - Any other error (constructor, bridge, or render loop) is kept in state and
 *   rethrown during render, so the nearest error boundary receives it.
 * - `onPartsShown(epoch)` dispatches `ARENA_READY`, which starts the stopwatch
 *   once the meshes are on screen (Req 13.10).
 * - Clicks go to the `onPartClick` prop (the controller's `clickPart`, which also handles explicit
 *   attempts), or dispatch `PART_CLICKED` through `createPartClickHandler` when no prop is given.
 * - A hint request from the hint session draws the ghost through `arena.showGhostHint`.
 * - Hover is forwarded to the `onHover` prop for the HUD name pill (Req 10.2).
 */
import { useEffect, useRef, useState } from "react";
import type { GameStore } from "../game/store";
import type { HintSession } from "../modules/ghostHint";
import { WebglUnavailable } from "../recovery/WebglUnavailable";
import { Arena } from "./Arena";
import { connectArenaBridge, createPartClickHandler } from "./arenaBridge";
import { WebglUnavailableError } from "./WebglUnavailableError";

export interface ArenaViewProps {
  store: GameStore;
  /** Source of ghost hints. Without it the Arena never shows a hint. */
  hints?: HintSession | undefined;
  /** Hovered part changed, or the pointer moved over it. Null id: nothing hovered. */
  onHover?: ((partId: string | null, clientX: number, clientY: number) => void) | undefined;
  /** Part click handler. Defaults to dispatching `PART_CLICKED`. */
  onPartClick?: ((partId: string, atMs: number) => void) | undefined;
}

type HostFailure = { kind: "webgl" } | { kind: "error"; error: unknown };

export function ArenaView({ store, hints, onHover, onPartClick }: ArenaViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failure, setFailure] = useState<HostFailure | null>(null);

  // Latest hover callback without recreating the Arena when the prop identity changes.
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const onPartClickRef = useRef(onPartClick);
  onPartClickRef.current = onPartClick;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;

    let arena: Arena;
    try {
      arena = new Arena({
        canvas,
        onPartClick: (() => {
          const fallback = createPartClickHandler(store);
          return (partId: string, atMs: number) => (onPartClickRef.current ?? fallback)(partId, atMs);
        })(),
        onHover: (partId, clientX, clientY) => onHoverRef.current?.(partId, clientX, clientY),
        onPartsShown: (epoch) => {
          store.dispatch({ type: "ARENA_READY", epoch, at: performance.now() });
        },
        onError: (error) => setFailure({ kind: "error", error }),
      });
    } catch (error) {
      setFailure(error instanceof WebglUnavailableError ? { kind: "webgl" } : { kind: "error", error });
      return undefined;
    }

    let disconnect: (() => void) | null = null;
    try {
      disconnect = connectArenaBridge(arena, store);
    } catch (error) {
      arena.dispose();
      setFailure({ kind: "error", error });
      return undefined;
    }

    const stopHints =
      hints?.onShow((request) => {
        arena.showGhostHint(request.partId, request.dir, request.distance, request.mode === "firstMove");
      }) ?? null;
    return () => {
      stopHints?.();
      disconnect?.();
      arena.dispose();
    };
  }, [store, hints]);

  if (failure?.kind === "error") throw failure.error;

  return (
    <div className="bz-arena">
      <canvas ref={canvasRef} hidden={failure !== null} aria-label="Clockwork assembly" />
      {failure?.kind === "webgl" ? <WebglUnavailable /> : null}
    </div>
  );
}
