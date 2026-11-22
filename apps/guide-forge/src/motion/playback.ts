/**
 * Playback constants and the per-frame advance rule (Requirement 11.8).
 *
 * Pure functions on numbers. No React, no three, no DOM.
 */

/** Constant playback rate: timeline steps advanced per second. */
export const PLAYBACK_STEPS_PER_SECOND = 1;

/**
 * Longest frame delta, in seconds, that one tick may apply. A long frame (for example after a tab
 * switch) cannot jump the timeline by more than `PLAYBACK_STEPS_PER_SECOND * MAX_TICK_SECONDS`.
 */
export const MAX_TICK_SECONDS = 0.1;

/**
 * Timeline position after one playback tick: `min(n, p + rate * min(deltaSeconds, MAX_TICK_SECONDS))`.
 * A non-positive or non-finite delta leaves `p` unchanged, so the position never moves backwards.
 */
export const advancePlayback = (p: number, n: number, deltaSeconds: number): number => {
  if (!(deltaSeconds > 0)) return p;
  const next = p + PLAYBACK_STEPS_PER_SECOND * Math.min(deltaSeconds, MAX_TICK_SECONDS);
  return Math.min(n, next);
};
