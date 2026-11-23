/**
 * Game_Events (Req 8.3, 8.4): plain serializable data with a `kind` discriminant.
 *
 * Every event carries `seq` (strictly increasing within a level) and `at`
 * (milliseconds, supplied by the action that produced the event). A combo change
 * shows up as `comboBefore !== comboAfter` on `part_removed`, `part_blocked` and
 * `false_alarm`, so no separate combo event exists.
 *
 * Type-only imports: no DOM, React or Three.js module.
 */
import type { TrajectoryStep } from "@unboltkit/core";
import type { LevelOutcome } from "./blitzEngine";
/**
 * What decided a removal or a block. `blocking_graph`: the normal click, or an explicit helical
 * unscrew, decided from the solver's blocking graph (not an independent check). `checked_straight`:
 * an explicit straight attempt decided by Core's `verifyLinearMove` on the exact move played.
 */
export type DecisionBasis = "blocking_graph" | "checked_straight";
/** `cancelled`: the player changed the attempt axis (or chose Auto) before the check answered. */
export type UnresolvedReason = "unverified" | "stale" | "not_extracted" | "error" | "cancelled";

export interface CompletionSummary {
  score: number;
  elapsedMs: number;
  mistakes: number;
  falseAlarms: number;
  removed: number;
  total: number;
}

export type GameEvent =
  | { kind: "level_loaded"; seq: number; at: number; epoch: number; label: string; totalParts: number }
  | { kind: "level_started"; seq: number; at: number; epoch: number }
  | {
      kind: "part_removed";
      seq: number;
      at: number;
      partId: string;
      step: TrajectoryStep;
      basis: DecisionBasis;
      /** The candidate axis the part left along. */
      axisIndex: number;
      points: number;
      fastenerBonus: number;
      awarded: number;
      comboBefore: number;
      comboAfter: number;
      scoreAfter: number;
      removed: number;
      total: number;
    }
  | {
      kind: "part_blocked";
      seq: number;
      at: number;
      partId: string;
      blockerIds: string[];
      basis: DecisionBasis;
      /** The candidate axis that was tried (or, for the normal click, the least blocked one). */
      axisIndex: number;
      comboBefore: number;
      comboAfter: 1;
      penaltyMs: 3000;
      mistakes: number;
      scoreAfter: number;
    }
  | {
      kind: "click_rejected";
      seq: number;
      at: number;
      partId: string;
      reason: "unknown_part" | "not_live" | "level_complete" | "attempt_pending";
    }
  | {
      /** A straight explicit attempt is being checked. Nothing has moved or scored yet. */
      kind: "attempt_checking";
      seq: number;
      at: number;
      partId: string;
      axisIndex: number;
      travel: number;
      staticPartIds: string[];
    }
  | {
      /** A straight explicit attempt ended without a usable verdict: no removal, no score, no mistake. */
      kind: "attempt_unresolved";
      seq: number;
      at: number;
      partId: string;
      axisIndex: number;
      reason: UnresolvedReason;
      detail: string;
    }
  | { kind: "trap_flagged"; seq: number; at: number; sccs: string[][]; bonus: 1000; scoreAfter: number }
  | {
      kind: "false_alarm";
      seq: number;
      at: number;
      penaltyApplied: number;
      comboBefore: number;
      scoreAfter: number;
      penaltyMs: 3000;
      falseAlarms: number;
    }
  | {
      kind: "level_completed";
      seq: number;
      at: number;
      outcome: LevelOutcome;
      summary: CompletionSummary;
      sccs: string[][];
    };

export type GameEventKind = GameEvent["kind"];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event before the reducer stamps `seq` and `at` on it. */
export type GameEventDraft = DistributiveOmit<GameEvent, "seq" | "at">;
