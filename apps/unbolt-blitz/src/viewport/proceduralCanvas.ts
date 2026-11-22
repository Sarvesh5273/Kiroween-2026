/**
 * Helpers for the in-memory canvases behind the procedural textures (studio backdrop, turntable dial,
 * brushed brass). Nothing here touches the DOM at import time. In a headless Node run there is no
 * `document`, so `createCanvas2d` returns null and the callers skip the texture.
 */

export interface Canvas2d {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * A new canvas with a 2D context, or null when there is no `document` (Node, Vitest) or the browser
 * refuses a 2D context. Callers treat null as "no texture" and keep a plain material.
 */
export function createCanvas2d(width: number, height: number): Canvas2d | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  return { canvas, ctx };
}

/**
 * Small seeded PRNG (mulberry32) returning floats in [0, 1). The same seed gives the same texture on
 * every load and on every machine, so the look is reproducible.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
