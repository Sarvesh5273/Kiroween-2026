/**
 * Visible and `aria-live` message text for each state change (Requirements 16.2, 16.3).
 *
 * Pure string builders. The text feeds the live region, and `toastModeChange` feeds the floating toast.
 * No React, no DOM, no three, and no audio of any kind.
 */
import { KIT_TITLES } from "../kits";
import type { SolveLabel, SolveResult, StageName, StageProgressEvent } from "../protocol";
import { selectClashBadge } from "./selectors";
import type { DeadlockModel } from "./selectors";
import type { Mode } from "./types";

const STAGE_LABELS: Readonly<Record<StageName, string>> = {
  stage0: "Stage 0 scene parse",
  stage1: "Stage 1 prepare",
  stage2: "Stage 2 blocking graph",
  stage3: "Stage 3 peel",
  stage4: "Stage 4 compile",
  oracle: "Oracle clash check",
  naive: "Naive baseline",
};

export const MODE_LABELS: Readonly<Record<Mode, string>> = {
  dbg: "UnboltKit DBG",
  naive: "Naive Radial Explode",
};

function labelName(label: SolveLabel): string {
  if (label.kind === "file") return label.fileName;
  const titles: Readonly<Record<string, string>> = KIT_TITLES;
  return titles[label.kitName] ?? label.kitName;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** Load started. */
export function announceLoadStarted(label: SolveLabel): string {
  return `Loading ${labelName(label)}. Running the solver.`;
}

/** One pipeline stage finished. Uses the elapsed milliseconds of the event. */
export function announceStageCompleted(event: StageProgressEvent): string {
  return `${STAGE_LABELS[event.stage]} completed at ${Math.round(event.elapsedMs)} ms.`;
}

/** Solve finished. The clash wording comes from the same badge model the header shows. */
export function announceSolveFinished(result: SolveResult): string {
  const plan = result.plan;
  if (plan.status === "error") {
    return "Solve finished. This model could not be processed. See the recovery card for next steps.";
  }
  if (plan.status === "deadlocked") {
    return `Solve finished. Interlock detected: no valid sequence. ${plural(plan.steps.length, "step")} peeled before the deadlock.`;
  }
  const badge = selectClashBadge(result, "dbg");
  return `Solve finished. ${plural(plan.steps.length, "step")} planned. ${badge.text}.`;
}

/** A recovery card or notice appeared. */
export function announceRecovery(card: { heading: string; body: string }): string {
  return `${card.heading}. ${card.body}`;
}

/** The plan is deadlocked. */
export function announceDeadlock(model: DeadlockModel): string {
  return (
    `Unsolvable Interlock Detected. ${plural(model.cycles.length, "cycle")}, ` +
    `${plural(model.lockedCount, "locked part")}, ` +
    `${plural(model.peeledCount, "step")} peeled before the deadlock.`
  );
}

/** The user switched the Hero_Toggle. */
export function announceModeChange(mode: Mode): string {
  return `Mode changed to ${MODE_LABELS[mode]}.`;
}

/**
 * Short transient toast text for a mode switch. Switching to Naive names the clash total from the
 * naive report, so the cost of the naive plan is visible the moment the parts burst apart.
 */
export function toastModeChange(mode: Mode, result: SolveResult | null): string {
  if (mode === "naive" && result !== null && result.naive !== null) {
    return `Switched to ${MODE_LABELS.naive} \u00b7 ${plural(result.naive.totalClashes, "clash")}`;
  }
  return `Switched to ${MODE_LABELS[mode]}`;
}
