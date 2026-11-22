/**
 * Step Authoring Editor: a compact form in the Manifest_Panel for the selected step.
 *
 * Fields: tool (quick chips plus free text), torque, warning (chips plus free text), a custom note,
 * a subassembly group name and a Mark Flexible checkbox. Every change dispatches
 * `authoring/annotationPatched`. An empty tool field means the default for the step's motion
 * primitive, which the placeholder shows.
 */
import { useId, type ChangeEvent, type ReactElement } from "react";
import { EMPTY_ANNOTATION, MAX_ANNOTATION_TEXT, defaultToolForPrimitive } from "../state/authoringSlice";
import { useAppDispatch, useAppState } from "../state/AppStateProvider";
import { selectManifestRows } from "../state/selectors";
import type { StepAnnotation } from "../state/types";

export const TOOL_CHIPS: readonly string[] = ["M2.5 Hex", "PH0 Driver", "Spudger", "Tweezers"];
export const WARNING_CHIPS: readonly string[] = ["ESD Safe", "Spring Tension", "Delicate"];

interface ChipRowProps {
  label: string;
  chips: readonly string[];
  value: string;
  onPick: (chip: string) => void;
}

function ChipRow({ label, chips, value, onPick }: ChipRowProps): ReactElement {
  return (
    <div className="gf-chips" role="group" aria-label={label}>
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          className="gf-chip"
          aria-pressed={value === chip}
          onClick={() => onPick(value === chip ? "" : chip)}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

export function StepAuthoringPanel(): ReactElement | null {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const ids = useId();
  const index = state.view.selectedStepIndex;
  const row = index === null ? undefined : selectManifestRows(state)[index];

  if (row === undefined) {
    return (
      <section className="gf-manifest__section" aria-labelledby={`${ids}-heading`}>
        <h3 id={`${ids}-heading`} className="gf-manifest__heading">
          Step notes
        </h3>
        <p className="gf-manifest__empty">
          Select a step to add its tool, torque, warning and notes.
        </p>
      </section>
    );
  }

  const has = Object.prototype.hasOwnProperty.call(state.authoring.annotations, row.partId);
  const annotation: StepAnnotation = has
    ? (state.authoring.annotations[row.partId] as StepAnnotation)
    : EMPTY_ANNOTATION;
  const defaultTool = defaultToolForPrimitive(row.primitive);

  const patch = (change: Partial<StepAnnotation>): void => {
    dispatch({ type: "authoring/annotationPatched", partId: row.partId, patch: change });
  };
  const onText =
    (field: "tool" | "torque" | "warning" | "note" | "subassembly") =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      patch({ [field]: event.currentTarget.value });
    };

  return (
    <section className="gf-manifest__section gf-author" aria-labelledby={`${ids}-heading`}>
      <h3 id={`${ids}-heading`} className="gf-manifest__heading">
        Step notes · Step {row.number}: {row.name}
      </h3>

      <div className="gf-field">
        <label className="gf-field__label" htmlFor={`${ids}-tool`}>
          Tool
        </label>
        <ChipRow label="Quick tools" chips={TOOL_CHIPS} value={annotation.tool} onPick={(tool) => patch({ tool })} />
        <input
          id={`${ids}-tool`}
          className="gf-input"
          type="text"
          maxLength={MAX_ANNOTATION_TEXT}
          value={annotation.tool}
          placeholder={defaultTool === "" ? "Tool name" : `Default: ${defaultTool}`}
          onChange={onText("tool")}
        />
      </div>

      <div className="gf-field">
        <label className="gf-field__label" htmlFor={`${ids}-torque`}>
          Torque
        </label>
        <input
          id={`${ids}-torque`}
          className="gf-input"
          type="text"
          maxLength={MAX_ANNOTATION_TEXT}
          value={annotation.torque}
          placeholder="1.8 Nm"
          onChange={onText("torque")}
        />
      </div>

      <div className="gf-field">
        <label className="gf-field__label" htmlFor={`${ids}-warning`}>
          Warning
        </label>
        <ChipRow
          label="Quick warnings"
          chips={WARNING_CHIPS}
          value={annotation.warning}
          onPick={(warning) => patch({ warning })}
        />
        <input
          id={`${ids}-warning`}
          className="gf-input"
          type="text"
          maxLength={MAX_ANNOTATION_TEXT}
          value={annotation.warning}
          placeholder="No warning"
          onChange={onText("warning")}
        />
      </div>

      <div className="gf-field">
        <label className="gf-field__label" htmlFor={`${ids}-note`}>
          Note
        </label>
        <textarea
          id={`${ids}-note`}
          className="gf-input gf-input--area"
          rows={3}
          maxLength={MAX_ANNOTATION_TEXT}
          value={annotation.note}
          placeholder="Custom note for this step"
          onChange={onText("note")}
        />
      </div>

      <div className="gf-field">
        <label className="gf-field__label" htmlFor={`${ids}-sub`}>
          Subassembly
        </label>
        <input
          id={`${ids}-sub`}
          className="gf-input"
          type="text"
          maxLength={MAX_ANNOTATION_TEXT}
          value={annotation.subassembly}
          placeholder="Group name, for example Plate stack"
          onChange={onText("subassembly")}
        />
      </div>

      <label className="gf-check">
        <input
          type="checkbox"
          checked={annotation.markFlexible}
          onChange={(event) => patch({ markFlexible: event.currentTarget.checked })}
        />
        <span>Mark Flexible</span>
      </label>

      <button
        type="button"
        className="gf-btn gf-btn--compact gf-btn--ghost"
        disabled={!has}
        onClick={() => dispatch({ type: "authoring/annotationCleared", partId: row.partId })}
      >
        Clear notes for this step
      </button>
    </section>
  );
}
