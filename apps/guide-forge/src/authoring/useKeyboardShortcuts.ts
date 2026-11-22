/**
 * Global keyboard shortcuts.
 *
 * `J` / `ArrowRight` next step, `K` / `ArrowLeft` previous step, `Space` play or pause, `M` toggle
 * DBG and Naive mode, `1` `2` `3` `F` Iso, Front, Top and Fit camera.
 *
 * Shortcuts are ignored while focus is in an `<input>`, `<textarea>`, `<select>` or a
 * `contentEditable` element, and while Ctrl, Meta or Alt is held. Space is also left alone when a
 * button or link has focus, because the browser already activates that control with Space.
 *
 * `resolveShortcut` and `nextStepIndex` are pure and tested in Node. The hook only wires them to
 * `keydown` and to the dispatcher.
 */
import { useEffect, useRef } from "react";
import { useAppDispatch, useAppState } from "../state/AppStateProvider";
import { selectModeToggleEnabled } from "../state/selectors";
import type { AppState, CameraKind } from "../state/types";

export type ShortcutCommand =
  | { kind: "step"; direction: 1 | -1 }
  | { kind: "playPause" }
  | { kind: "toggleMode" }
  | { kind: "camera"; camera: Extract<CameraKind, "iso" | "front" | "top" | "fit"> };

/** The parts of a `KeyboardEvent` that `resolveShortcut` reads. */
export interface ShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

/** The parts of an event target that `isEditableTarget` reads. */
export interface ShortcutTarget {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

export const SHORTCUT_LEGEND: readonly { keys: string; label: string }[] = [
  { keys: "J / →", label: "next step" },
  { keys: "K / ←", label: "previous step" },
  { keys: "Space", label: "play / pause" },
  { keys: "M", label: "DBG / Naive" },
  { keys: "1 2 3 F", label: "Iso / Front / Top / Fit" },
];

const TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const ACTIVATABLE_TAGS = new Set(["BUTTON", "A"]);

/** True when typing in the target must not trigger a shortcut. */
export function isEditableTarget(target: ShortcutTarget | null): boolean {
  if (target === null) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (TEXT_ENTRY_TAGS.has(tag)) return true;
  if (target.isContentEditable === true) return true;
  const attribute = target.getAttribute?.("contenteditable");
  return attribute !== null && attribute !== undefined && attribute !== "false";
}

function isActivatableTarget(target: ShortcutTarget | null): boolean {
  if (target === null) return false;
  if (ACTIVATABLE_TAGS.has((target.tagName ?? "").toUpperCase())) return true;
  return target.getAttribute?.("role") === "button";
}

/** The command for a key press, or `null` when the key is not a shortcut in this context. */
export function resolveShortcut(
  event: ShortcutKeyEvent,
  target: ShortcutTarget | null,
): ShortcutCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isEditableTarget(target)) return null;
  switch (event.key) {
    case "j":
    case "J":
    case "ArrowRight":
      return { kind: "step", direction: 1 };
    case "k":
    case "K":
    case "ArrowLeft":
      return { kind: "step", direction: -1 };
    case " ":
    case "Spacebar":
      if (event.repeat || isActivatableTarget(target)) return null;
      return { kind: "playPause" };
    case "m":
    case "M":
      return event.repeat ? null : { kind: "toggleMode" };
    case "1":
      return { kind: "camera", camera: "iso" };
    case "2":
      return { kind: "camera", camera: "front" };
    case "3":
      return { kind: "camera", camera: "top" };
    case "f":
    case "F":
      return { kind: "camera", camera: "fit" };
    default:
      return null;
  }
}

/**
 * Index to select after moving one step. From no selection, next goes to the first step and
 * previous stays unselected. The result is clamped to `[0, count - 1]`. `null` means no change.
 */
export function nextStepIndex(current: number | null, count: number, direction: 1 | -1): number | null {
  if (count <= 0) return null;
  if (current === null) return direction === 1 ? 0 : null;
  const next = Math.min(count - 1, Math.max(0, current + direction));
  return next === current ? null : next;
}

function planStepCount(state: AppState): number {
  const plan = state.solve.result?.plan;
  return plan === undefined || plan.status === "error" ? 0 : plan.steps.length;
}

export function useKeyboardShortcuts(): void {
  const state = useAppState();
  const dispatch = useAppDispatch();
  // The listener is attached once and reads the latest state through the ref.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const target = event.target as ShortcutTarget | null;
      const command = resolveShortcut(event, target);
      if (command === null) return;
      const current = stateRef.current;
      switch (command.kind) {
        case "step": {
          event.preventDefault();
          const index = nextStepIndex(
            current.view.selectedStepIndex,
            planStepCount(current),
            command.direction,
          );
          if (index !== null) dispatch({ type: "view/stepSelected", index });
          return;
        }
        case "playPause":
          event.preventDefault();
          dispatch({ type: current.view.playing ? "view/pauseRequested" : "view/playRequested" });
          return;
        case "toggleMode":
          if (!selectModeToggleEnabled(current)) return;
          dispatch({ type: "view/modeSet", mode: current.view.mode === "dbg" ? "naive" : "dbg" });
          return;
        case "camera":
          dispatch({ type: "view/cameraRequested", kind: command.camera });
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);
}
