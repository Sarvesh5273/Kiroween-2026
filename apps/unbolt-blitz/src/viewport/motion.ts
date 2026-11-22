/**
 * Reduced-motion policy for the Arena (Req 11.9).
 *
 * Pure data and functions. The only environment read is the optional
 * `matchMedia` lookup in `prefersReducedMotion`, and callers can inject it.
 */

/** Exit animation length in milliseconds under normal motion. */
export const EXIT_DURATION_MS = 600;

/** Exit animation length in milliseconds when the OS asks for reduced motion. */
export const REDUCED_EXIT_DURATION_MS = 150;

/** The unbolt cue: a particle burst, or a single-frame flash under reduced motion. */
export type UnboltEffectKind = "burst" | "flash";

export interface MotionPolicy {
  reduced: boolean;
  exitDurationMs: number;
  unboltEffect: UnboltEffectKind;
  /** False under reduced motion: the blocked-part shudder is skipped. */
  shudder: boolean;
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Policy for a reduced-motion flag. */
export function motionPolicy(reduced: boolean): MotionPolicy {
  return reduced
    ? {
        reduced: true,
        exitDurationMs: REDUCED_EXIT_DURATION_MS,
        unboltEffect: "flash",
        shudder: false,
      }
    : {
        reduced: false,
        exitDurationMs: EXIT_DURATION_MS,
        unboltEffect: "burst",
        shudder: true,
      };
}

type MatchMediaLike = (query: string) => { matches: boolean };

/**
 * Reads the OS reduced-motion preference. Returns false when no `matchMedia`
 * exists (Node, tests). Pass `matchMedia` to inject a lookup.
 */
export function prefersReducedMotion(matchMedia?: MatchMediaLike): boolean {
  const lookup =
    matchMedia ??
    (typeof globalThis.matchMedia === "function"
      ? (globalThis.matchMedia.bind(globalThis) as MatchMediaLike)
      : undefined);
  if (lookup === undefined) return false;
  return lookup(REDUCED_MOTION_QUERY).matches;
}

/** Policy for the current environment. */
export function currentMotionPolicy(matchMedia?: MatchMediaLike): MotionPolicy {
  return motionPolicy(prefersReducedMotion(matchMedia));
}
