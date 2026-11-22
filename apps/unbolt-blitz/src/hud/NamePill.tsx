import type { CSSProperties } from "react";
import type { GameStore } from "../game/store";
import { displayNamesOf, useGameState } from "./useGameStore";

/** Hovered part and pointer position in client pixels, as reported by the Arena's `onHover`. */
export interface HoverState {
  partId: string;
  clientX: number;
  clientY: number;
}

/** Display_Name pill near the pointer while a part is hovered (Req 10.2, 10.3). */
export function NamePill({ store, hover }: { store: GameStore; hover: HoverState | null }) {
  const names = displayNamesOf(useGameState(store));
  if (hover === null) return null;
  const name = names.get(hover.partId);
  if (name === undefined) return null;

  const style: CSSProperties = { left: hover.clientX, top: hover.clientY };
  return (
    <div className="bz-name-pill" style={style} aria-hidden="true">
      {name}
    </div>
  );
}
