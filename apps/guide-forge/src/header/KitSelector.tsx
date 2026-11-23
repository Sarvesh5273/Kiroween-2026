/**
 * Kit_Selector (Requirements 2.2, 6.1, 6.2): a native `<select>` with the "Showcase" and
 * "Deadlock Cage" option groups. Choosing a kit starts a solve that carries only the kit name.
 */
import type { ChangeEvent, ReactElement } from "react";
import { KIT_GROUPS, KIT_TITLES, type KitName } from "../kits";
import { SERVICE_RING } from "../examples/serviceRing";
import { useAppState, useSolver } from "../state/AppStateProvider";

/** Value of the placeholder option shown while an uploaded file is the active source. */
const FILE_OPTION_VALUE = "";

function findKitName(value: string): KitName | null {
  for (const group of KIT_GROUPS) {
    for (const name of group.kitNames) {
      if (name === value) return name;
    }
  }
  return null;
}

export function KitSelector(): ReactElement {
  const label = useAppState().solve.label;
  const solver = useSolver();

  const activeKit = label !== null && label.kind === "kit" ? findKitName(label.kitName) : null;
  const fileName = label !== null && label.kind === "file" ? label.fileName : null;
  const value = activeKit ?? FILE_OPTION_VALUE;

  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const name = findKitName(event.currentTarget.value);
    if (name !== null) solver.solveKit(name);
  };

  return (
    <div className="gf-field">
      <label className="gf-field__label" htmlFor="kit-selector">
        Kit
      </label>
      <select id="kit-selector" className="gf-select" value={value} onChange={onChange}>
        {activeKit === null ? (
          <option value={FILE_OPTION_VALUE} disabled>
            {label?.kind === "example" ? SERVICE_RING.title : fileName !== null ? `Uploaded: ${fileName}` : "Choose a kit"}
          </option>
        ) : null}
        {KIT_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.kitNames.map((name) => (
              <option key={name} value={name}>
                {KIT_TITLES[name]}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
