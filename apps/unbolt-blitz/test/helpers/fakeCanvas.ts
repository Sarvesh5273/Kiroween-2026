import { vi } from "vitest";

/** One fake 2D context. Drawing calls are recorded as no-ops, and `getImageData` returns a real pixel buffer. */
export interface FakeContext2d {
  /** Pixel buffer last handed to `putImageData`, or null before any call. */
  putPixels: Uint8ClampedArray | null;
  /** Value every pixel starts with when `getImageData` is called. */
  basePixel: number;
}

export interface FakeCanvasEnvironment {
  contexts: FakeContext2d[];
}

/**
 * Stubs `globalThis.document` with a `createElement("canvas")` that returns a canvas with a fake 2D
 * context, so code that draws procedural textures can run in Node. Undo it with `vi.unstubAllGlobals()`.
 *
 * Every method of the context is a no-op that returns an object with `addColorStop`, except
 * `getImageData` (a real RGBA buffer of the requested size, filled with `basePixel`) and
 * `putImageData` (which stores the buffer in `putPixels`).
 */
export function installFakeCanvasDocument(basePixel = 100): FakeCanvasEnvironment {
  const contexts: FakeContext2d[] = [];
  const createContext = (): CanvasRenderingContext2D => {
    const record: FakeContext2d = { putPixels: null, basePixel };
    contexts.push(record);
    const values = new Map<string | symbol, unknown>();
    const handler: ProxyHandler<object> = {
      get(_target, property) {
        if (property === "getImageData") {
          return (_x: number, _y: number, width: number, height: number) => {
            const data = new Uint8ClampedArray(width * height * 4).fill(record.basePixel);
            return { data, width, height };
          };
        }
        if (property === "putImageData") {
          return (image: { data: Uint8ClampedArray }) => {
            record.putPixels = image.data;
          };
        }
        if (values.has(property)) return values.get(property);
        return () => ({ addColorStop: () => undefined });
      },
      set(_target, property, value) {
        values.set(property, value);
        return true;
      },
    };
    return new Proxy({}, handler) as CanvasRenderingContext2D;
  };
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`fake document only creates canvases, got "${tag}"`);
      const context = createContext();
      return { width: 0, height: 0, getContext: () => context };
    },
  });
  return { contexts };
}
