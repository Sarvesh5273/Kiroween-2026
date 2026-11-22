/**
 * Status callout (Requirement 15.9): one of Verified, Not Verified, Interlocked or Obstructed, each
 * with an icon and a text label, so the status reads without colour or sound.
 *
 * The state comes from the oracle and naive reports in the Solve_Result, never from `plan.status`
 * alone (Requirement 9.4). Only `plan.status === "deadlocked"` is read directly, because a
 * deadlocked plan has no oracle report to consult.
 */
import type { ReactElement } from "react";
import type { SolveResult } from "../protocol";
import { selectDeadlockModel } from "../state/selectors";
import type { Mode } from "../state/types";
import { ICONS, type IconName } from "../ui/icons";

export type CalloutKind = "verified" | "not-verified" | "interlocked" | "obstructed";

export interface CalloutModel {
  kind: CalloutKind;
  /** Visible label: Verified, Not Verified, Interlocked or Obstructed. */
  label: string;
  /** Short explanation with the numbers behind the label. */
  detail: string;
  tone: "ok" | "bad" | "warn";
  icon: IconName;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Pure. `null` when there is no usable plan (no result, or an error plan). */
export function selectCalloutModel(result: SolveResult | null, mode: Mode): CalloutModel | null {
  if (result === null || result.plan.status === "error") return null;

  if (mode === "naive" && result.naive !== null && result.naive.totalClashes > 0) {
    const obstructed = result.naive.perPart.filter((entry) => entry.clashCount > 0).length;
    return {
      kind: "obstructed",
      label: "Obstructed",
      detail: `Naive radial explode: ${plural(result.naive.totalClashes, "clash", "clashes")}, ${plural(obstructed, "part", "parts")} obstructed.`,
      tone: "bad",
      icon: "warn",
    };
  }

  if (result.plan.status === "deadlocked") {
    const locked = selectDeadlockModel(result)?.lockedCount ?? 0;
    return {
      kind: "interlocked",
      label: "Interlocked",
      detail: `No valid removal sequence. ${plural(locked, "part is", "parts are")} locked.`,
      tone: "warn",
      icon: "interlock",
    };
  }

  const oracle = result.oracle;
  if (oracle === null) {
    return {
      kind: "not-verified",
      label: "Not Verified",
      detail: "No independent clash check is available for this plan.",
      tone: "bad",
      icon: "warn",
    };
  }
  if (oracle.totalClashes > 0) {
    return {
      kind: "not-verified",
      label: "Not Verified",
      detail: `The independent clash check found ${plural(oracle.totalClashes, "clash", "clashes")}.`,
      tone: "bad",
      icon: "warn",
    };
  }
  return {
    kind: "verified",
    label: "Verified",
    detail: `0 clashes across ${plural(oracle.perStep.length, "step", "steps")} (independent clash check).`,
    tone: "ok",
    icon: "check",
  };
}

export interface StatusCalloutProps {
  result: SolveResult | null;
  mode: Mode;
}

export function StatusCallout({ result, mode }: StatusCalloutProps): ReactElement | null {
  const model = selectCalloutModel(result, mode);
  if (model === null) return null;
  const Icon = ICONS[model.icon];
  return (
    <div className={`gf-callout gf-callout--${model.tone}`} data-status={model.kind}>
      <Icon className="gf-icon gf-callout__icon" />
      <p className="gf-callout__text">
        <span>{model.label}</span> <span className="gf-callout__detail">{model.detail}</span>
      </p>
    </div>
  );
}
