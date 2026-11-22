/**
 * Playback speed (1x, 3x, 8x) and the small-text floor of the stylesheet.
 *
 * Reducer tests use a solved plan from the real pipeline (`runSolve`). Expected positions are
 * computed from the tick rule `p + rate * delta`, and the plan length N is read from the result, so
 * nothing here names a part id or a step order.
 */
import { checkClashes } from "@unboltkit/core";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  MAX_TICK_SECONDS,
  PLAYBACK_SPEEDS,
  PLAYBACK_STEPS_PER_SECOND,
  advancePlayback,
  playbackRate,
} from "../../src/motion/playback";
import { initialState, rootReducer } from "../../src/state/reducer";
import type { AppAction, AppState, PlaybackSpeed } from "../../src/state/types";
import { runSolve } from "../../src/worker/solvePipeline";

function reduce(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(rootReducer, state);
}

const KIT = "planetary-gearbox-3-stage";
let solved: AppState;
let stepCount: number;

beforeAll(() => {
  const result = runSolve(
    { type: "solve", requestId: 1, source: { kind: "kit", kitName: KIT } },
    { now: () => performance.now(), checkClashes, onProgress: () => undefined },
  );
  solved = reduce(
    initialState,
    { type: "solve/started", requestId: 1, label: { kind: "kit", kitName: KIT } },
    { type: "solve/succeeded", requestId: 1, result },
  );
  stepCount = result.plan.status === "error" ? 0 : result.plan.steps.length;
});

describe("advancePlayback rate", () => {
  it("defaults to the 1x rate", () => {
    expect(advancePlayback(2, 10, 0.05)).toBeCloseTo(2 + PLAYBACK_STEPS_PER_SECOND * 0.05, 10);
  });

  it.each(PLAYBACK_SPEEDS)("advances %ix faster than 1x", (speed) => {
    const rate = playbackRate(speed);
    expect(rate).toBe(PLAYBACK_STEPS_PER_SECOND * speed);
    expect(advancePlayback(2, 100, 0.05, rate)).toBeCloseTo(2 + rate * 0.05, 10);
  });

  it("caps one long frame at rate * MAX_TICK_SECONDS and never passes the last step", () => {
    expect(advancePlayback(0, 100, 5, playbackRate(8))).toBeCloseTo(8 * MAX_TICK_SECONDS, 10);
    expect(advancePlayback(9.9, 10, 0.1, playbackRate(8))).toBe(10);
  });

  it("does not move for a non-positive delta or an unusable rate", () => {
    expect(advancePlayback(3, 10, 0, 8)).toBe(3);
    expect(advancePlayback(3, 10, -1, 8)).toBe(3);
    expect(advancePlayback(3, 10, Number.NaN, 8)).toBe(3);
    expect(advancePlayback(3, 10, 0.05, 0)).toBe(3);
    expect(advancePlayback(3, 10, 0.05, Number.NaN)).toBe(3);
    expect(advancePlayback(3, 10, 0.05, Number.POSITIVE_INFINITY)).toBe(3);
  });
});

describe("view/speedSet", () => {
  it("starts at 1x", () => {
    expect(initialState.view.playbackSpeed).toBe(1);
  });

  it.each([3, 8, 1] as const)("sets %ix", (speed) => {
    const state = reduce(solved, { type: "view/speedSet", speed });
    expect(state.view.playbackSpeed).toBe(speed);
  });

  it("returns the same state object for the speed already set", () => {
    expect(rootReducer(solved, { type: "view/speedSet", speed: 1 })).toBe(solved);
  });

  it("ignores a value that is not 1, 3 or 8", () => {
    const state = reduce(solved, { type: "view/speedSet", speed: 3 });
    for (const bad of [0, 2, 4, 16, -3, Number.NaN, "8"]) {
      const next = rootReducer(state, { type: "view/speedSet", speed: bad as unknown as PlaybackSpeed });
      expect(next).toBe(state);
    }
  });

  it("keeps the speed across a new solve and does not stop playback when it changes", () => {
    const playing = reduce(solved, { type: "view/playRequested" });
    expect(playing.view.playing).toBe(true);
    const faster = reduce(playing, { type: "view/speedSet", speed: 8 });
    expect(faster.view.playing).toBe(true);
    const resolved = reduce(faster, {
      type: "solve/started",
      requestId: 2,
      label: { kind: "kit", kitName: KIT },
    });
    expect(resolved.view.playbackSpeed).toBe(8);
    expect(resolved.view.playing).toBe(false);
    expect(resolved.view.timelineP).toBe(0);
  });
});

describe("view/tick with a playback speed", () => {
  it.each(PLAYBACK_SPEEDS)("advances the timeline by %i x the 1x step", (speed) => {
    expect(stepCount).toBeGreaterThan(1);
    const delta = 0.05;
    const state = reduce(
      solved,
      { type: "view/speedSet", speed },
      { type: "view/playRequested" },
      { type: "view/tick", deltaSeconds: delta },
    );
    expect(state.view.timelineP).toBeCloseTo(PLAYBACK_STEPS_PER_SECOND * speed * delta, 10);
    expect(state.view.playing).toBe(true);
  });

  /** Frames of 60 fps playback needed to reach the end of the plan at one speed. */
  function framesToFinish(speed: PlaybackSpeed): { frames: number; end: AppState } {
    let state = reduce(solved, { type: "view/speedSet", speed }, { type: "view/playRequested" });
    let frames = 0;
    while (state.view.playing && frames < 100_000) {
      state = rootReducer(state, { type: "view/tick", deltaSeconds: 1 / 60 });
      frames += 1;
    }
    return { frames, end: state };
  }

  it("reaches the last step and stops at every speed, in proportionally fewer frames", () => {
    const runs = new Map(PLAYBACK_SPEEDS.map((speed) => [speed, framesToFinish(speed)] as const));
    for (const [, run] of runs) {
      expect(run.end.view.playing).toBe(false);
      expect(run.end.view.timelineP).toBe(stepCount);
    }
    const base = (runs.get(1) as { frames: number }).frames;
    for (const speed of PLAYBACK_SPEEDS) {
      const frames = (runs.get(speed) as { frames: number }).frames;
      // N steps at `speed` steps per second take N / speed seconds, up to one frame of rounding.
      expect(frames).toBeLessThanOrEqual(Math.ceil(base / speed) + 1);
      expect(frames).toBeGreaterThanOrEqual(Math.floor(base / speed) - 1);
    }
  });
});

describe("small text floor in app.css", () => {
  const css = readFileSync(new URL("../../src/theme/app.css", import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const tokens = readFileSync(new URL("../../src/theme/tokens.css", import.meta.url), "utf8");

  it("defines the floor as 0.75rem and the comparison figures as 15px", () => {
    expect(tokens).toMatch(/--fs-min:\s*0\.75rem;/);
    expect(tokens).toMatch(/--fs-metric:\s*0\.9375rem;/);
  });

  it("declares no font-size below 12px", () => {
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((match) => (match[1] as string).trim());
    expect(sizes.length).toBeGreaterThan(20);
    const tooSmall = sizes.filter((size) => {
      const px = /^([0-9.]+)px$/.exec(size);
      if (px !== null) return Number(px[1]) < 12;
      const rem = /^([0-9.]+)rem$/.exec(size);
      if (rem !== null) return Number(rem[1]) * 16 < 12;
      return false;
    });
    expect(tooSmall).toEqual([]);
  });

  it("shows the comparison card figures bold at the metric size", () => {
    const rule = /\.gf-compare__value\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/font-size:\s*var\(--fs-metric\)/);
    expect(rule?.[1]).toMatch(/font-weight:\s*700/);
  });

  it("gives the kit select 28px of right padding and a 220px minimum width", () => {
    expect(css).toMatch(/\.gf-select\s*\{[^}]*padding-right:\s*28px/);
    expect(css).toMatch(/\.gf-header \.gf-select\s*\{[^}]*min-width:\s*220px/);
  });
});
