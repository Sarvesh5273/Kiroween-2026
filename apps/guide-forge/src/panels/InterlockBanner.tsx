/**
 * Interlock banner (Requirements 14.1, 14.2, 14.3, 14.6).
 *
 * Shows "Unsolvable Interlock Detected", one numbered cycle per `witness.sccs` entry with its Part
 * names and its unique `from → to` blocking pairs (each with a direction count), and the locked and
 * peeled counts. Activating a Part name asks the
 * viewport to focus the camera on that Part. Renders nothing unless the plan is deadlocked.
 */
import type { ReactElement } from "react";
import type { SolveResult } from "../protocol";
import { selectDeadlockModel } from "../state/selectors";
import { InterlockIcon } from "../ui/icons";

export interface InterlockBannerProps {
  result: SolveResult;
  /** Called with the Part_ID when the user activates a Part name. */
  onFocusPart: (partId: string) => void;
}

export function InterlockBanner({ result, onFocusPart }: InterlockBannerProps): ReactElement | null {
  const plan = result.plan;
  const model = selectDeadlockModel(result);
  if (plan.status !== "deadlocked" || model === null) return null;

  const nameOf = (partId: string): string => model.partNameById[partId] ?? `Part ${partId}`;

  return (
    <section className="gf-interlock" aria-labelledby="gf-interlock-heading">
      <h2 id="gf-interlock-heading" className="gf-interlock__heading">
        <InterlockIcon className="gf-icon" />
        <span>Unsolvable Interlock Detected</span>
      </h2>
      <p className="gf-interlock__summary">
        {model.lockedCount} {model.lockedCount === 1 ? "part" : "parts"} locked in {model.cycles.length}{" "}
        interlock {model.cycles.length === 1 ? "cycle" : "cycles"} • {model.peeledCount} {model.peeledCount === 1 ? "step" : "steps"} peeled before the deadlock
      </p>
      <ol className="gf-interlock__cycles">
        {plan.witness.sccs.map((scc, index) => {
          const edgeGroups = model.cycles[index]?.edgeGroups ?? [];
          return (
          <li key={scc.partIds.join("|")} className="gf-interlock__cycle">
            <span className="gf-interlock__parts">
              {scc.partIds.map((partId) => (
                <button
                  key={partId}
                  type="button"
                  className="gf-link-btn"
                  onClick={() => onFocusPart(partId)}
                >
                  {nameOf(partId)}
                </button>
              ))}
            </span>
            {edgeGroups.length > 0 ? (
              <ul className="gf-interlock__edges" aria-label={`Blocking edges of cycle ${index + 1}`}>
                {edgeGroups.map((group) => (
                  <li key={`${group.from}->${group.to}`} className="gf-interlock__edge">
                    {nameOf(group.from)} → {nameOf(group.to)} ({group.directionCount}{" "}
                    {group.directionCount === 1 ? "direction" : "directions"})
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
          );
        })}
      </ol>
    </section>
  );
}
