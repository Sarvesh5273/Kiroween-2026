/**
 * Pure HUD model (Req 3.4, 11.5, 12.4, 12.5, 12.7, 12.8, 12.9, 13.2, 14.4, 16.1 to 16.6).
 *
 * Everything here maps plain data to plain data, so Node tests can check it. The module
 * imports no React, DOM or Three.js code, and only types from the game and protocol layers.
 */
import type { GameEvent } from "../game/events";
import type { OverBudgetWarning } from "../protocol";

/** How long the Blocker_Callout stays visible after the latest blocked event (Req 12.7). */
export const CALLOUT_DURATION_MS = 3000;

/** Text of the Time_Penalty popup (Req 12.5, 14.4). */
export const TIME_PENALTY_POPUP_TEXT = "+3s";

/** Text of the false-alarm popup (Req 14.4). */
export const FALSE_ALARM_POPUP_TEXT = "FALSE ALARM -250";

export type PopupTone = "score" | "penalty";

/** One floating popup. `key` is unique per event and index, so a component can key a list on it. */
export interface Popup {
  key: string;
  text: string;
  /** `score` renders teal, `penalty` renders crimson. */
  tone: PopupTone;
  /** Event timestamp in milliseconds. */
  at: number;
}

/** The Blocker_Callout view model. */
export interface Callout {
  text: string;
  /** Timestamp of the blocked event that produced this text. */
  startedAt: number;
  /** `startedAt + CALLOUT_DURATION_MS`. */
  expiresAt: number;
}

/** The Completion_Overlay view model. */
export interface CompletionModel {
  title: "Victory" | "Interlock Exposed!";
  score: number;
  elapsedText: string;
  mistakes: number;
  falseAlarms: number;
}

export type NameMap = ReadonlyMap<string, string>;

function nameOf(partId: string, names: NameMap): string {
  const name = names.get(partId);
  return name !== undefined && name.length > 0 ? name : partId;
}

/** Floating popups for one event. Events without a cue return an empty list. */
export function popupsFromEvent(e: GameEvent): Popup[] {
  switch (e.kind) {
    case "part_removed":
      return [{ key: `${e.seq}:0`, text: `+${e.awarded}`, tone: "score", at: e.at }];
    case "part_blocked":
      return [{ key: `${e.seq}:0`, text: TIME_PENALTY_POPUP_TEXT, tone: "penalty", at: e.at }];
    case "false_alarm":
      return [
        { key: `${e.seq}:0`, text: FALSE_ALARM_POPUP_TEXT, tone: "penalty", at: e.at },
        { key: `${e.seq}:1`, text: TIME_PENALTY_POPUP_TEXT, tone: "penalty", at: e.at },
      ];
    default:
      return [];
  }
}

/** "BLOCKED BY: A, B", with blockers in the given order (Req 12.4). */
export function calloutText(blockerIds: readonly string[], names: NameMap): string {
  return `BLOCKED BY: ${blockerIds.map((id) => nameOf(id, names)).join(", ")}`;
}

/**
 * Next callout state. A blocked event replaces the text and restarts the 3000 ms window
 * (Req 12.8). A new level clears it. Other events leave it unchanged.
 */
export function calloutReducer(prev: Callout | null, e: GameEvent, names: NameMap): Callout | null {
  if (e.kind === "part_blocked") {
    return {
      text: calloutText(e.blockerIds, names),
      startedAt: e.at,
      expiresAt: e.at + CALLOUT_DURATION_MS,
    };
  }
  if (e.kind === "level_loaded") return null;
  return prev;
}

/** True while `now` is inside the display window (Req 12.7). */
export function calloutVisible(c: Callout | null, now: number): boolean {
  return c !== null && now < c.expiresAt;
}

/**
 * `m:ss.t` with the tenths floored from the input (Req 13.2).
 * Negative and non-finite input formats as 0:00.0.
 */
export function formatElapsed(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const tenthsTotal = Math.floor(safe / 100);
  const tenths = tenthsTotal % 10;
  const secondsTotal = Math.floor(tenthsTotal / 10);
  const seconds = secondsTotal % 60;
  const minutes = Math.floor(secondsTotal / 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/** Visual tier of the combo badge. The tier only changes how the badge looks, never the score. */
export type ComboTier = "base" | "amber" | "gold" | "spectral";

/**
 * Tier for a combo multiplier: x1 base, x2 to x3 amber, x4 to x6 gold, x7 and above spectral
 * (the combo is capped at x8). Values below 2, fractions below 2 and NaN map to the base tier.
 */
export function comboTier(value: number): ComboTier {
  const whole = Math.trunc(value);
  if (!(whole >= 2)) return "base";
  if (whole <= 3) return "amber";
  if (whole <= 6) return "gold";
  return "spectral";
}

export type EdgeFlashTone = "crimson" | "teal";

/**
 * Tone of the brief screen-edge flash for an event: crimson for a blocked attempt or a false alarm,
 * teal for a removed part, null for every other event. The flash is decoration. The popups, the
 * callout and the live region carry the same information as text.
 */
export function edgeFlashTone(e: GameEvent): EdgeFlashTone | null {
  switch (e.kind) {
    case "part_blocked":
    case "false_alarm":
      return "crimson";
    case "part_removed":
      return "teal";
    default:
      return null;
  }
}

/** Overlay model for a `level_completed` event, or null for any other event. */
export function completionModel(e: GameEvent): CompletionModel | null {
  if (e.kind !== "level_completed") return null;
  return {
    title: e.outcome === "victory" ? "Victory" : "Interlock Exposed!",
    score: e.summary.score,
    elapsedText: formatElapsed(e.summary.elapsedMs),
    mistakes: e.summary.mistakes,
    falseAlarms: e.summary.falseAlarms,
  };
}

/**
 * Text for the `aria-live` region (Req 12.9, 16.6). Returns a non-empty string for
 * `part_removed`, `part_blocked`, `false_alarm`, `trap_flagged` and `level_completed`,
 * and an empty string for every other kind. The blocked text equals the callout text.
 */
export function describeEvent(e: GameEvent, names: NameMap): string {
  switch (e.kind) {
    case "part_removed":
      return `Unbolted ${nameOf(e.partId, names)}. Plus ${e.awarded} points. Combo x${e.comboAfter}.`;
    case "part_blocked":
      return calloutText(e.blockerIds, names);
    case "false_alarm":
      return "False alarm. Minus 250 points and plus 3 seconds. Combo reset to x1.";
    case "trap_flagged": {
      const parts = Array.from(new Set(e.sccs.flat())).map((id) => nameOf(id, names));
      const detail = parts.length > 0 ? ` Interlocked parts: ${parts.join(", ")}.` : "";
      return `Interlock trap flagged. Plus ${e.bonus} points.${detail}`;
    }
    case "level_completed": {
      const model = completionModel(e);
      if (model === null) return "";
      return (
        `${model.title}. Score ${model.score}. Time ${model.elapsedText}. ` +
        `Mistakes ${model.mistakes}. False alarms ${model.falseAlarms}.`
      );
    }
    default:
      return "";
  }
}

/** Integer with comma thousands separators. Locale independent. */
function formatCount(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Over_Budget_Notice text (Req 3.4). Names the triangle count and the Poly_Budget with
 * thousands separators, and the sampling stride when it is above 1.
 */
export function overBudgetNoticeText(w: OverBudgetWarning): string {
  const head = `OVER BUDGET: ${formatCount(w.totalTriangles)} triangles (budget ${formatCount(w.polyBudget)}).`;
  const stride = Math.trunc(w.stride);
  const tail =
    stride > 1
      ? ` The level is playable, but blocking checks sample every ${ordinal(stride)} triangle.`
      : " The level is playable.";
  return head + tail;
}
