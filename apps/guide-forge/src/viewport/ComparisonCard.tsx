/**
 * Comparison telemetry card, bottom-left of the 3D view.
 *
 * Puts the product claim next to its baseline for a solved plan:
 * `UnboltKit DBG: 0 clashes (Verified)` against
 * `Naive Explode: X clashes (Y/N parts obstructed)`.
 *
 * Both numbers come from `selectComparison`, which reads the independent oracle report and the
 * naive baseline report in the Solve_Result. The card follows the active mode: the cell of the mode
 * on screen is emphasised. Status is carried by an icon and by the words, not by colour alone.
 */
import type { ReactElement } from "react";
import { useAppState } from "../state/AppStateProvider";
import { selectComparison } from "../state/selectors";
import { CheckIcon, WarnIcon } from "../ui/icons";

export function ComparisonCard(): ReactElement | null {
  const state = useAppState();
  const comparison = selectComparison(state.solve.result);
  if (comparison === null) return null;
  const { dbg, naive } = comparison;
  const mode = state.view.mode;

  return (
    <aside className="gf-compare" aria-label="UnboltKit DBG compared with Naive Radial Explode" data-testid="comparison-card">
      <div
        className="gf-compare__cell gf-compare__cell--dbg"
        role="group"
        aria-label={`${dbg.label}: ${dbg.text}`}
        data-active={mode === "dbg"}
        data-verified={dbg.verified}
      >
        <span className="gf-compare__label">
          {dbg.verified ? <CheckIcon size={14} /> : <WarnIcon size={14} />}
          <span>{dbg.label}</span>
        </span>
        <span className="gf-compare__value">{dbg.text}</span>
      </div>
      <span className="gf-compare__vs" aria-hidden="true">
        vs
      </span>
      <div
        className="gf-compare__cell gf-compare__cell--naive"
        role="group"
        aria-label={`${naive.label}: ${naive.text}`}
        data-active={mode === "naive"}
      >
        <span className="gf-compare__label">
          <WarnIcon size={14} />
          <span>{naive.label}</span>
        </span>
        <span className="gf-compare__value">{naive.text}</span>
      </div>
    </aside>
  );
}
