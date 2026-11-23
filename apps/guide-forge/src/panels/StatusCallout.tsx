/**
 * Status callout (Requirement 15.9): one of Full guide not verified, Interlocked or Obstructed,
 * each with an icon and a text label, so the status reads without colour or sound.
 *
 * No state claims the guide is verified: the legacy ray count is a diagnostic, and a single
 * checked move does not verify the guide. Obstructed comes from the naive report and Interlocked
 * from `plan.status === "deadlocked"`.
 */
import type { ReactElement, ReactNode } from "react";
import type { SolveResult } from "../protocol";
import { GUIDE_NOT_VERIFIED_TEXT, legacyRayHitsText, selectDeadlockModel } from "../state/selectors";
import type { Mode } from "../state/types";
import { ICONS, type IconName } from "../ui/icons";

export type CalloutKind = "unverified" | "interlocked" | "obstructed";

export interface CalloutModel {
  kind: CalloutKind;
  /** Visible label: Full guide not verified, Interlocked or Obstructed. */
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

  // A solved plan. No full-guide check has run, so the guide is not verified. The legacy ray
  // count is shown as a diagnostic only: zero hits is not proof that a move is clear.
  const oracle = result.oracle;
  const diagnostic =
    oracle === null
      ? "No legacy ray count is available."
      : `Legacy ray check (diagnostic only): ${legacyRayHitsText(oracle.totalClashes)} across ${plural(oracle.perStep.length, "step", "steps")}.`;
  return {
    kind: "unverified",
    label: GUIDE_NOT_VERIFIED_TEXT,
    detail: `${diagnostic} Use Check this move to test one move against the parts present.`,
    tone: "warn",
    icon: "warn",
  };
}
export interface StatusCalloutProps {
  result: SolveResult | null;
  mode: Mode;
  children?: ReactNode;
}

export function StatusCallout({ result, mode, children }: StatusCalloutProps): ReactElement | null {
  const model = selectCalloutModel(result, mode);
  if (model === null) return null;
  const Icon = ICONS[model.icon];
  return (
    <details className={`gf-guide-details gf-callout--${model.tone}`} data-status={model.kind}>
      <summary>
        <Icon className="gf-icon" />
        <strong>{model.label}</strong>
        <span className="gf-guide-details__action">Details</span>
      </summary>
      <div className="gf-guide-details__body">
        <p>{model.detail}</p>
        {children}
      </div>
    </details>
  );
}
