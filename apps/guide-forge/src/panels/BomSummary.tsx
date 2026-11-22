/**
 * Bill-of-materials summary (Requirement 15.7): a compact metric strip with the total Part count and
 * the number of Steps per primitive. `Helical` counts `helical_unscrew` steps and `Linear` counts
 * `linear_slide` steps. A fourth `Other` metric appears only when a plan uses another primitive.
 */
import type { ReactElement } from "react";
import type { BomSummary as BomCounts } from "../state/selectors";

export interface BomSummaryProps {
  bom: BomCounts;
}

interface Metric {
  key: "parts" | "helical" | "linear" | "other";
  label: string;
  hint: string;
  value: number;
}

export function BomSummary({ bom }: BomSummaryProps): ReactElement {
  const items: Metric[] = [
    { key: "parts", label: "Parts", hint: "Parts in the assembly", value: bom.totalParts },
    { key: "helical", label: "Helical", hint: "Helical unscrew steps", value: bom.helical },
    { key: "linear", label: "Linear", hint: "Linear slide steps", value: bom.linear },
  ];
  if (bom.other > 0) {
    items.push({ key: "other", label: "Other", hint: "Steps with another motion primitive", value: bom.other });
  }
  return (
    <div className="gf-bom" role="group" aria-label="Bill of materials">
      {items.map((item) => (
        <div key={item.key} className={`gf-bom__item gf-bom__item--${item.key}`} title={item.hint}>
          <span className="gf-bom__value">{item.value}</span>
          <span className="gf-bom__label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
