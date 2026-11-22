/**
 * Small key-value storage seam for the Part 2 modules (mute flag, campaign records).
 *
 * `defaultStorage()` wraps `localStorage` and falls back to memory when it is missing (Node, tests)
 * or blocked (private mode, disabled cookies). A write that fails keeps the value in memory for the
 * rest of the session and logs a warning, so a full or blocked disk never breaks the game.
 */
export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A storage that lives and dies with the session. */
export function createMemoryStorage(initial: Readonly<Record<string, string>> = {}): StorageAdapter {
  const values = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `localStorage` when this environment has a working one, otherwise null. */
function probeLocalStorage(): WebStorageLike | null {
  // Node 25 prints a warning when `localStorage` is touched without a backing file, so only look in a browser.
  if (typeof (globalThis as { window?: unknown }).window === "undefined") return null;
  try {
    const candidate = (globalThis as { localStorage?: WebStorageLike }).localStorage;
    if (candidate === undefined || typeof candidate.getItem !== "function") return null;
    candidate.getItem("unbolt-blitz:probe");
    return candidate;
  } catch (error) {
    // Reading `localStorage` throws when storage is blocked. Memory is the documented fallback.
    console.warn("Unbolt Blitz: localStorage is blocked, progress will not be saved.", error);
    return null;
  }
}

export function defaultStorage(): StorageAdapter {
  const web = probeLocalStorage();
  const memory = createMemoryStorage();
  if (web === null) return memory;
  return {
    getItem(key) {
      const mirrored = memory.getItem(key);
      if (mirrored !== null) return mirrored;
      try {
        return web.getItem(key);
      } catch (error) {
        console.warn("Unbolt Blitz: could not read saved progress.", error);
        return null;
      }
    },
    setItem(key, value) {
      memory.setItem(key, value);
      try {
        web.setItem(key, value);
      } catch (error) {
        console.warn("Unbolt Blitz: could not save progress.", error);
      }
    },
  };
}
