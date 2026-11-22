/**
 * Keyboard shortcuts of Part 2: H = hint, M = mute toggle, R = replay (only after a level ends).
 *
 * `resolveShortcut` is pure, so Node tests can check it. Keys are ignored while the player types in
 * an input, select or text area, with a modifier held, or when the key is auto-repeating.
 */
import { useEffect, useRef } from "react";

export type ShortcutAction = "hint" | "mute" | "replay";

export interface ShortcutKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  target?: EventTarget | { tagName?: string; isContentEditable?: boolean } | null;
}

const TEXT_TAGS: ReadonlySet<string> = new Set(["INPUT", "SELECT", "TEXTAREA"]);

export function isTextEntryTarget(target: ShortcutKeyEvent["target"]): boolean {
  if (target === null || target === undefined) return false;
  const { tagName, isContentEditable } = target as { tagName?: unknown; isContentEditable?: unknown };
  if (isContentEditable === true) return true;
  return typeof tagName === "string" && TEXT_TAGS.has(tagName.toUpperCase());
}

export function resolveShortcut(event: ShortcutKeyEvent, state: { completed: boolean }): ShortcutAction | null {
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return null;
  if (event.repeat === true) return null;
  if (isTextEntryTarget(event.target)) return null;
  switch (event.key.toLowerCase()) {
    case "h":
      return "hint";
    case "m":
      return "mute";
    case "r":
      return state.completed ? "replay" : null;
    default:
      return null;
  }
}

/** Listens on `window` for the shortcuts. The latest handlers and state are used without re-subscribing. */
export function useGlobalShortcuts(
  handlers: Record<ShortcutAction, () => void>,
  state: { completed: boolean },
): void {
  const latest = useRef({ handlers, state });
  useEffect(() => {
    latest.current = { handlers, state };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = resolveShortcut(event, latest.current.state);
      if (action === null) return;
      event.preventDefault();
      latest.current.handlers[action]();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
