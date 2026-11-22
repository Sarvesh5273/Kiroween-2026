/**
 * One Step row (Requirements 2.2, 13.4, 14.7, 15.2, 15.5, 15.6, 15.8).
 *
 * A native `<button type="button">`, so Enter and Space work and the row is focusable. The selected
 * row carries `aria-current="step"` and scrolls into view when the selection changes through the
 * keyboard, the timeline or playback. Every status (Not compiled, Obstructed, Interlocked) appears
 * as text with an icon, not as colour alone. The primitive badge is colour-coded by motion kind.
 */
import { useEffect, useRef, type ReactElement } from "react";
import type { ManifestRow } from "../state/selectors";
import { InterlockIcon, WarnIcon } from "../ui/icons";
import { primitiveClass } from "../ui/primitives";

export interface StepRowProps {
  row: ManifestRow;
  /** Called with the zero-based step index when the row is activated. */
  onSelect: (index: number) => void;
}

export function StepRow({ row, onSelect }: StepRowProps): ReactElement {
  const ref = useRef<HTMLButtonElement | null>(null);

  // `nearest` leaves the list alone when the row is already visible, so a click never jumps it.
  useEffect(() => {
    if (row.selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [row.selected]);

  const classes = ["gf-step"];
  if (row.primitive === null) classes.push("gf-step--uncompiled");
  if (row.obstructed) classes.push("gf-step--obstructed");
  if (row.interlocked) classes.push("gf-step--interlocked");

  const showFlag = row.clashCount !== null || row.interlocked;

  return (
    <button
      ref={ref}
      type="button"
      className={classes.join(" ")}
      aria-current={row.selected ? "step" : undefined}
      onClick={() => onSelect(row.index)}
    >
      <span className="gf-step__num">{row.number}</span>
      <span className="gf-step__name">{row.name}</span>
      {row.primitive === null ? (
        <span className="gf-prim gf-prim--uncompiled">Not compiled</span>
      ) : (
        <span className={`gf-prim ${primitiveClass(row.primitive)}`}>{row.primitive}</span>
      )}
      <span className="gf-step__dist">escape {row.escapeDistanceText}</span>
      {showFlag ? (
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
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
