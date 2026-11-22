/**
 * Scoring and motion constants for the Blitz engine.
 *
 * There is no aligned-fastener angle constant here on purpose. Whether a
 * fastener unscrews is decided by Core's primitive registry through
 * `DEFAULT_SOLVER_CONFIG.helicalAngularToleranceDeg` (5 degrees), which the
 * engine reaches through its injected `PrimitiveContext`.
 */

/** Points for a Legal_Unbolt, multiplied by the Combo in force before the increment. */
export const BASE_POINTS = 100;
/** Flat bonus for removing a fastener, unaffected by Combo. */
export const FASTENER_BONUS = 50;
/** Highest Combo multiplier. */
export const COMBO_CAP = 8;
/** Points for a correct Flag Interlock Trap. */
export const TRAP_BONUS = 1000;
/** Points lost on a False_Alarm (the score is floored at 0). */
export const FALSE_ALARM_PENALTY = 250;
/** Time_Penalty in milliseconds, added by a Blocked_Attempt or a False_Alarm. */
export const TIME_PENALTY_MS = 3000;
/** Minimum exit travel in normalized units, so the last live part still visibly moves (D5). */
export const EXIT_TRAVEL_FLOOR = 0.12;
/** Escape_Distance tolerance for axis ties, the same value Core uses. */
export const ESCAPE_TIE_TOLERANCE = 1e-9;
