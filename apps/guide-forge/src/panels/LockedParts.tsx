/**
 * "Locked Parts" list for a deadlocked plan (Requirements 14.7, 15.8): each Deadlocked_Part with an
 * "Interlocked" label and icon, then each other unassigned Part. In Naive mode each row also shows
 * its clash count and an "Obstructed" label (Requirement 13.4).
 */
import type { ReactElement } from "react";
import type { LockedPartRow } from "../state/selectors";
import { InterlockIcon, WarnIcon } from "../ui/icons";

export interface LockedPartsProps {
  rows: readonly LockedPartRow[];
  /** Called with the Part_ID when the user activates a Part name. */
  onFocusPart: (partId: string) => void;
}

export function LockedParts({ rows, onFocusPart }: LockedPartsProps): ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <section className="gf-manifest__section" aria-labelledby="gf-locked-heading">
      <h3 id="gf-locked-heading" className="gf-manifest__heading">
        Locked Parts
      </h3>
      <ul className="gf-locked">
        {rows.map((row) => (
          <li key={row.partId} className="gf-locked__item">
            <button type="button" className="gf-link-btn" onClick={() => onFocusPart(row.partId)}>
              {row.name}
            </button>
            <span className="gf-step__flag">
              {row.clashCount !== null ? (
                <span className="gf-step__clashes">
                  {row.clashCount} {row.clashCount === 1 ? "clash" : "clashes"}
                </span>
              ) : null}
              {row.obstructed ? (
                <>
                  <WarnIcon className="gf-icon" />
                  <span>Obstructed</span>
                </>
              ) : null}
              {row.interlocked ? (
                <>
                  <InterlockIcon className="gf-icon" />
                  <span>Interlocked</span>
                </>
              ) : (
                <>
                  <WarnIcon className="gf-icon" />
                  <span>Unassigned</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
