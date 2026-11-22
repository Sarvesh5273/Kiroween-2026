/**
 * Naive Radial Explode travel (Requirements 13.1, 13.2, 14.10).
 *
 * Every Part moves along the `direction` of its `perPart` entry by `s * NAIVE_TRAVEL_DISTANCE`,
 * where `s` is the Explode_Slider value. All Parts share one travel distance.
 *
 * Why 0.65: Parts live in normalized coordinates (the assembly spans at most 1 along its longest
 * axis). A travel of 0.65 moves every Part far enough that a blocked Part visibly drives into its
 * neighbour, yet the whole exploded pose stays within about 2.3 units, so the camera can frame it
 * with the clashing Parts still large and legible. The earlier sqrt(3) travel threw Parts clear of
 * the envelope and shrank them to specks once the camera pulled back to fit them.
 *
 * Pure functions on plain arrays. No React, no three, no DOM.
 */
import type { Vec3 } from "@unboltkit/core";

/** The single travel distance, in normalized units, shared by every Part at `s = 1`. */
export const NAIVE_TRAVEL_DISTANCE = 0.65;

/**
 * Translation of a Part at Explode_Slider value `s` along the unit `direction`:
 * `s * NAIVE_TRAVEL_DISTANCE * direction`. At `s = 0` every component is `+0`, so the Part stays
 * at its assembled position.
 */
export const naiveOffset = (s: number, direction: Vec3): Vec3 => [
  // `+ 0` turns -0 (from 0 * negative) into +0, so the offset at s = 0 is exactly zero.
  s * NAIVE_TRAVEL_DISTANCE * direction[0] + 0,
  s * NAIVE_TRAVEL_DISTANCE * direction[1] + 0,
  s * NAIVE_TRAVEL_DISTANCE * direction[2] + 0,
];
