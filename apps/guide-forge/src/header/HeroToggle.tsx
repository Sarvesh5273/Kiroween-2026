/**
 * Hero_Toggle (Requirements 10.1, 10.2, 10.7, 10.8): two buttons that switch between DBG_Mode and
 * Naive_Mode. Each button exposes `aria-pressed`. Both are disabled while no usable Solve_Result
 * exists (`selectControlEnablement(...).heroToggle`). Activating one dispatches `view/modeSet`
 * only, so no new Solve_Request is made.
 */
import type { ReactElement } from "react";
import { useAppDispatch, useAppState } from "../state/AppStateProvider";
import { selectControlEnablement } from "../state/selectors";
import type { Mode } from "../state/types";

interface HeroOption {
  mode: Mode;
  label: string;
}

export const HERO_OPTIONS: readonly HeroOption[] = [
  { mode: "dbg", label: "UnboltKit DBG" },
  { mode: "naive", label: "Naive Radial Explode" },
];

export function HeroToggle(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const enabled = selectControlEnablement(state).heroToggle;
  const activeMode = state.view.mode;

  return (
    <div className="gf-hero" role="group" aria-label="Comparison mode">
      {HERO_OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          className="gf-hero__option"
          aria-pressed={activeMode === option.mode}
          disabled={!enabled}
          onClick={() => dispatch({ type: "view/modeSet", mode: option.mode })}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
