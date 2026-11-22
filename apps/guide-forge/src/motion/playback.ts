/**
 * Playback constants and the per-frame advance rule (Requirement 11.8).
 *
 * Pure functions on numbers. No React, no three, no DOM.
 */
import type { PlaybackSpeed } from "../state/types";

/** Base playback rate at 1x: timeline steps advanced per second. */
export const PLAYBACK_STEPS_PER_SECOND = 1;

/** Selectable speed multipliers, slowest first. The transport bar renders one button per entry. */
export const PLAYBACK_SPEEDS: readonly PlaybackSpeed[] = [1, 3, 8];

/** Playback rate in timeline steps per second for a speed multiplier. */
export const playbackRate = (speed: PlaybackSpeed): number => PLAYBACK_STEPS_PER_SECOND * speed;

/** True when `value` is one of the selectable speeds. Guards actions that arrive untyped. */
export const isPlaybackSpeed = (value: unknown): value is PlaybackSpeed =>
  PLAYBACK_SPEEDS.some((speed) => speed === value);

/**
 * Longest frame delta, in seconds, that one tick may apply. A long frame (for example after a tab
 * switch) cannot jump the timeline by more than `rate * MAX_TICK_SECONDS`, which is 0.1 steps at 1x
 * and 0.8 steps at 8x.
 */
export const MAX_TICK_SECONDS = 0.1;

/**
 * Timeline position after one playback tick: `min(n, p + rate * min(deltaSeconds, MAX_TICK_SECONDS))`.
 * `rate` is in steps per second and defaults to the 1x rate. A non-positive or non-finite delta or
 * rate leaves `p` unchanged, so the position never moves backwards.
 */
export const advancePlayback = (
  p: number,
  n: number,
  deltaSeconds: number,
  rate: number = PLAYBACK_STEPS_PER_SECOND,
): number => {
  if (!(deltaSeconds > 0) || !(rate > 0) || !Number.isFinite(rate)) return p;
  const next = p + rate * Math.min(deltaSeconds, MAX_TICK_SECONDS);
  return Math.min(n, next);
};
