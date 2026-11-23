/**
 * "Check this move" card in the Manifest_Panel.
 *
 * The user chooses a Part that is still present, one of six model axes and a finite travel in
 * model units, then presses Check this move. The Solver_Worker runs Core `verifyLinearMove` on that
 * exact move against the Parts present at the current step. The card shows Checking, then Clear,
 * Blocked (with the blocking Parts by name) or Unverified (with a plain-language reason), each as
 * an icon and words, so it reads on mute and without colour. It works for solved and deadlocked
 * plans alike, and it never picks another axis or removes a Part on its own.
 *
 * All rules live in `state/moveCheck.ts`. This file only renders and dispatches.
 */
import { useEffect, useId, useRef, type ReactElement } from "react";
import { useAppDispatch, useAppState, useSolver } from "../state/AppStateProvider";
import { SERVICE_RING } from "../examples/serviceRing";
import { AXIS_DIRECTIONS, selectMoveCheckView, type MoveCheckStatus } from "../state/moveCheck";
import { formatDuration, partDisplayName } from "../state/selectors";
import type { AxisDirection } from "../state/types";
import { ICONS, type IconName } from "../ui/icons";

const STATUS_STYLE: Readonly<Record<MoveCheckStatus, { tone: string; icon: IconName | null }>> = {
  unavailable: { tone: "muted", icon: null },
  ready: { tone: "muted", icon: null },
  checking: { tone: "muted", icon: null },
  clear: { tone: "ok", icon: "check" },
  blocked: { tone: "bad", icon: "warn" },
  unverified: { tone: "warn", icon: "warn" },
  failed: { tone: "warn", icon: "warn" },
};

export function MoveCheckPanel(): ReactElement | null {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const solver = useSolver();
  const ids = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const result = state.solve.result;
  const isExample = state.solve.label?.kind === "example";
  // The example action is in the header. Take keyboard users to the task once it has loaded.
  useEffect(() => {
    if (isExample && result !== null) {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [isExample, result]);
  if (result === null || result.plan.status === "error") return null;

  const view = selectMoveCheckView(state);
  const { partId, direction, distanceText } = state.moveCheck;
  const presentIds = new Set(view.present.map((part) => part.partId));
  const style = STATUS_STYLE[view.status];
  const Icon = style.icon === null ? null : ICONS[style.icon];
  const canCheck = view.request !== null && view.key !== null && view.status !== "checking";
  const scale = result.plan.normalization.scale;
  const modelSize = scale > 0 ? Number((1 / scale).toPrecision(4)) : null;
  const exampleRing = isExample && result.parts.find(part => part.nodeName === SERVICE_RING.nodeName);
  const examplePull = exampleRing && partId === exampleRing.partId && presentIds.has(partId) &&
    direction === SERVICE_RING.direction && distanceText === SERVICE_RING.distanceText;
  const exampleQuestion = examplePull && state.view.timelineP === 0
    ? "Can the red ring slide up with the cap in place?"
    : examplePull && state.view.timelineP === 1 ? "With the cap removed, can the red ring slide up?" : null;

  const onCheck = (): void => {
    if (view.request !== null && view.key !== null) solver.checkMove(view.request, view.key);
  };

  return (
    <section className="gf-movecheck" aria-labelledby={`${ids}-heading`} data-testid="move-check">
      <h3 id={`${ids}-heading`} className="gf-movecheck__title" ref={headingRef} tabIndex={-1}>
        Check this move
      </h3>
      {exampleQuestion ? <p className="gf-movecheck__question">{exampleQuestion}</p> : null}
      <div className="gf-movecheck__row">
        <label className="gf-field__label" htmlFor={`${ids}-part`}>
          Part
        </label>
        <select
          id={`${ids}-part`}
          className="gf-select gf-movecheck__control"
          value={partId ?? ""}
          onChange={(event) => dispatch({ type: "moveCheck/partSelected", partId: event.currentTarget.value === "" ? null : event.currentTarget.value })}
        >
          <option value="">Choose a part</option>
          {result.parts.map((part) => (
            <option key={part.partId} value={part.partId} disabled={!presentIds.has(part.partId) && part.partId !== partId}>
              {presentIds.has(part.partId)
                ? partDisplayName(part.nodeName, part.partId)
                : `${partDisplayName(part.nodeName, part.partId)} (removed at this step)`}
            </option>
          ))}
        </select>
      </div>
      <div className="gf-movecheck__row">
        <span className="gf-field__label" id={`${ids}-dir`}>
          Direction
        </span>
        <div className="gf-chips gf-movecheck__control" role="group" aria-labelledby={`${ids}-dir`}>
          {AXIS_DIRECTIONS.map((axis) => (
            <button
              key={axis.id}
              type="button"
              className="gf-chip"
              aria-pressed={direction === axis.id}
              onClick={() =>
                dispatch({ type: "moveCheck/directionSelected", direction: direction === axis.id ? null : (axis.id as AxisDirection) })
              }
            >
              {axis.label}
            </button>
          ))}
        </div>
      </div>
      <div className="gf-movecheck__row">
        <label className="gf-field__label" htmlFor={`${ids}-travel`}>
          Travel
        </label>
        <div className="gf-movecheck__distance">
          <input
            id={`${ids}-travel`}
            className="gf-input gf-movecheck__travel"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={distanceText}
            placeholder="Distance"
            aria-describedby={`${ids}-units`}
            onChange={(event) => dispatch({ type: "moveCheck/distanceSet", text: event.currentTarget.value })}
          />
          <span id={`${ids}-units`} className="gf-notes__hint" title={modelSize !== null ? `Model is ${modelSize} units across` : undefined}>
            model units{modelSize !== null ? ` · ${modelSize} across` : ""}
          </span>
        </div>
      </div>
      <button type="button" className="gf-btn gf-btn--primary gf-movecheck__go" disabled={!canCheck} onClick={onCheck}>
        Check this move
      </button>
      <div
        className={`gf-callout gf-callout--${style.tone}`}
        role="status"
        aria-live="polite"
        data-status={view.status}
        data-testid="move-check-verdict"
      >
        {Icon !== null ? <Icon className="gf-icon gf-callout__icon" /> : null}
        <p className="gf-callout__text">
          <span data-testid="move-check-headline">{view.headline}</span>{" "}
          <span className="gf-callout__detail">
            {view.detail}
            {view.elapsedMs !== null ? ` Checked in ${formatDuration(view.elapsedMs)}.` : ""}
          </span>
        </p>
      </div>
      {view.present.length > 0 ? (
        <details className="gf-movecheck__parts" data-testid="move-check-present">
          <summary>Parts present at this step ({view.present.length})</summary>
          <p>{view.present.map(part => part.name).join(", ")}.</p>
        </details>
      ) : null}
    </section>
  );
}
