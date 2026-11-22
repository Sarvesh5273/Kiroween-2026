/**
 * Bill-of-materials summary (Requirement 15.7): total Part count and the number of Steps per
 * primitive (`helical_unscrew`, `linear_slide`, any other).
 */
import type { ReactElement } from "react";
import type { BomSummary as BomCounts } from "../state/selectors";

export interface BomSummaryProps {
  bom: BomCounts;
}

export function BomSummary({ bom }: BomSummaryProps): ReactElement {
  const items: { label: string; value: number }[] = [
    { label: "Parts", value: bom.totalParts },
    { label: "Helical unscrew", value: bom.helical },
    { label: "Linear slide", value: bom.linear },
    { label: "Other", value: bom.other },
  ];
  return (
    <div className="gf-bom" role="group" aria-label="Bill of materials">
      {items.map((item) => (
        <div key={item.label} className="gf-bom__item">
          <span className="gf-bom__value">{item.value}</span>
          <span className="gf-bom__label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
