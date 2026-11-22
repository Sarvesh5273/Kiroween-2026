/**
 * Step_Timeline math (Requirements 11.1, 11.2, 11.6, 11.7).
 *
 * The timeline position `p` lies in [0, N], where N is the number of steps. Step `i` (zero-based)
 * has local parameter `clamp(p - i, 0, 1)`, and the Explode_Slider value is `s = p / N`.
 *
 * Pure functions on numbers. No React, no three, no DOM.
 */

/** Local parameter `t` of step `i` at timeline position `p`: `clamp(p - i, 0, 1)`. */
export const localParameter = (p: number, i: number): number => Math.min(1, Math.max(0, p - i));

/** Explode_Slider value `s` in [0, 1] to timeline position `p = s * N`. */
export const sliderToTimeline = (s: number, n: number): number => s * n;

/** Timeline position `p` to Explode_Slider value `s = p / N`. Returns 0 when `N` is 0. */
export const timelineToSlider = (p: number, n: number): number => (n === 0 ? 0 : p / n);

/**
 * Index of the step the timeline is currently working on, or `null` before the first step starts.
 * `activeStepIndex(i + 1, n) === i` for every valid `i`, so selecting a row and scrubbing agree.
 */
export const activeStepIndex = (p: number, n: number): number | null =>
  p <= 0 || n === 0 ? null : Math.min(Math.ceil(p) - 1, n - 1);
