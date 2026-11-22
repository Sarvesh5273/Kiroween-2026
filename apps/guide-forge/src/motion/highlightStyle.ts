/**
 * Per-Part highlight style. Pure TypeScript: no React, no three, no DOM.
 *
 * The viewport maps the returned value to materials and outlines. This module
 * only decides which emphasis a Part gets and whether it animates.
 *
 * Requirements: 13.3, 13.5, 13.6, 14.4, 14.5, 14.8, 16.6.
 */

export type HighlightMode = "dbg" | "naive";

export type HighlightPlanStatus = "solved" | "deadlocked" | "error";

export type HighlightEmphasis = "none" | "clash" | "deadlocked" | "unassigned";

export type HighlightAnimation = "none" | "steady" | "pulse" | "glow";

export interface PartHighlight {
  /** `#1E3A5F` selection highlight (Requirement 15.5). DBG mode only. */
  selected: boolean;
  emphasis: HighlightEmphasis;
  animation: HighlightAnimation;
}

/**
 * Plain-data description of everything `partHighlight` needs. The caller
 * derives the sets from the Solve_Result:
 * - `clashingPartIds`: Naive_Report `perPart` entries with `clashCount > 0`.
 * - `deadlockedPartIds`: Part_IDs of every `witness.sccs` entry.
 * - `unassignedPartIds`: `witness.unassignedPartIds`, which may include the
 *   deadlocked Parts. A Part in both sets is treated as deadlocked.
 * - `stepPartIds`: the Part_ID of each plan step, in plan order.
 */
export interface HighlightContext {
  mode: HighlightMode;
  planStatus: HighlightPlanStatus;
  stepPartIds: readonly string[];
  selectedStepIndex: number | null;
  clashingPartIds: ReadonlySet<string>;
  deadlockedPartIds: ReadonlySet<string>;
  unassignedPartIds: ReadonlySet<string>;
  reducedMotion: boolean;
}

/** Animation before the reduced-motion downgrade. */
function baseAnimation(emphasis: HighlightEmphasis): HighlightAnimation {
  switch (emphasis) {
    case "clash":
      return "pulse";
    case "deadlocked":
      return "glow";
    case "unassigned":
      return "steady";
    case "none":
      return "none";
  }
}

/**
 * Emphasis precedence: deadlocked, then clash, then unassigned.
 *
 * - `clash` applies only in Naive mode (Requirement 13.3, 13.6).
 * - `deadlocked` and `unassigned` apply only while the plan is deadlocked, in
 *   both modes (Requirement 14.4, 14.5, 14.10). A deadlocked Part keeps its
 *   deadlock highlight in Naive mode (Requirement 14.10).
 * - An unassigned, non-deadlocked Part that also clashes in Naive mode shows
 *   the clash highlight, because the single `emphasis` field cannot carry both.
 */
function emphasisFor(partId: string, ctx: HighlightContext): HighlightEmphasis {
  const deadlockedPlan = ctx.planStatus === "deadlocked";
  if (deadlockedPlan && ctx.deadlockedPartIds.has(partId)) return "deadlocked";
  if (ctx.mode === "naive" && ctx.clashingPartIds.has(partId)) return "clash";
  if (deadlockedPlan && ctx.unassignedPartIds.has(partId)) return "unassigned";
  return "none";
}

function isSelected(partId: string, ctx: HighlightContext): boolean {
  if (ctx.mode !== "dbg" || ctx.selectedStepIndex === null) return false;
  return ctx.stepPartIds[ctx.selectedStepIndex] === partId;
}

export function partHighlight(partId: string, ctx: HighlightContext): PartHighlight {
  const emphasis = emphasisFor(partId, ctx);
  const animation = baseAnimation(emphasis);
  const downgraded: HighlightAnimation =
    ctx.reducedMotion && (animation === "pulse" || animation === "glow") ? "steady" : animation;
  return { selected: isSelected(partId, ctx), emphasis, animation: downgraded };
}
