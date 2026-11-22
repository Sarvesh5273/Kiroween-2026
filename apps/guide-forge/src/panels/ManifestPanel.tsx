/**
 * Step and BOM Manifest_Panel (Requirements 15.1 to 15.10, 13.4, 14.1 to 14.7).
 *
 * Reads App_State through the context and changes it only by dispatching App_Actions:
 * - a Step row dispatches `view/stepSelected`, which selects the Step, sets the timeline position
 *   and focuses the camera (Requirement 15.4);
 * - the Step Notes card edits the selected step's annotations (`authoring/*` actions). It is pinned
 *   below the list, and the step list scrolls inside the space between the metric strip and the card;
 * - a Part name in the Interlock_Banner or the Locked Parts list dispatches `view/cameraRequested`
 *   with `kind: "focus"` (Requirement 14.6).
 *
 * Layout, top to bottom: header, status callout and metric strip, the scrolling step list (with the
 * Locked Parts list under it for a deadlocked plan), the pinned Step Notes card.
 */
import type { ReactElement } from "react";
import {
  selectBom,
  selectLockedPartRows,
  selectManifestRows,
} from "../state/selectors";
import { useAppDispatch, useAppState } from "../state/AppStateProvider";
import { StepAuthoringPanel } from "../authoring/StepAuthoringPanel";
import { BomSummary } from "./BomSummary";
import { InterlockBanner } from "./InterlockBanner";
import { LockedParts } from "./LockedParts";
import { StatusCallout } from "./StatusCallout";
import { StepRow } from "./StepRow";

export function ManifestPanel(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { result, status } = state.solve;

  const selectStep = (index: number): void => {
    dispatch({ type: "view/stepSelected", index });
  };
  const focusPart = (partId: string): void => {
    dispatch({ type: "view/cameraRequested", kind: "focus", partId });
  };

  const hasPlan = result !== null && result.plan.status !== "error";
  const rows = hasPlan ? selectManifestRows(state) : [];

  let body: ReactElement;
  let pinned: ReactElement | null = null;
  if (result === null || result.plan.status === "error") {
    body =
      status === "loading" ? (
        <p className="gf-manifest__empty" role="status">
          Solving the assembly. Steps and the bill of materials appear here when the solve finishes.
        </p>
      ) : (
        <p className="gf-manifest__empty">
          No disassembly plan yet. Choose a sample kit in the Kit selector in the header, or use the
          Upload control to open your own .glb or .gltf file.
        </p>
      );
  } else {
    const lockedRows = selectLockedPartRows(state);
    const deadlocked = result.plan.status === "deadlocked";
    body = (
      <>
        <div className="gf-manifest__summary">
          <StatusCallout result={result} mode={state.view.mode} />
          {deadlocked ? <InterlockBanner result={result} onFocusPart={focusPart} /> : null}
          <BomSummary bom={selectBom(result)} />
        </div>
        <section className="gf-manifest__steps" aria-labelledby="gf-steps-heading">
          <h3 id="gf-steps-heading" className="gf-manifest__heading">
            <span>{deadlocked ? "Peeled Steps" : "Steps"}</span>
            <span className="gf-manifest__count">{rows.length}</span>
          </h3>
          <div className="gf-steps-scroll" tabIndex={-1}>
            {rows.length === 0 ? (
              <p className="gf-manifest__empty">
                {deadlocked ? "No step could be peeled before the deadlock." : "This plan has no steps."}
              </p>
            ) : (
              <ol className="gf-steps">
                {rows.map((row) => (
                  <li key={row.partId}>
                    <StepRow row={row} onSelect={selectStep} />
                  </li>
                ))}
              </ol>
            )}
            <LockedParts rows={lockedRows} onFocusPart={focusPart} />
          </div>
        </section>
      </>
    );
    // Pinned below the list so the notes card is reachable however many steps there are.
    pinned = rows.length > 0 ? <StepAuthoringPanel /> : null;
  }

  return (
    <aside className="gf-manifest" aria-label="Step and bill of materials manifest">
      <div className="gf-manifest__header">
        <h2 className="gf-manifest__title">Manifest</h2>
      </div>
      <div className="gf-manifest__body">{body}</div>
      {pinned !== null ? <div className="gf-manifest__pinned">{pinned}</div> : null}
    </aside>
  );
}
