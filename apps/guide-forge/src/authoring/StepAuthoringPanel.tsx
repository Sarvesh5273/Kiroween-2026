/**
 * Step Notes card: a compact, collapsible form pinned under the step list for the selected step.
 *
 * Fields: tool (quick chips plus free text), torque, warning (chips plus free text), a custom note,
 * a subassembly group name and a Mark Flexible checkbox. Every change dispatches
 * `authoring/annotationPatched`. An empty tool field means the default for the step's motion
 * primitive, which the placeholder shows.
 *
 * With no step selected the card is a single hint line. With a step selected it opens, and the
 * header button collapses it to give the step list the whole column.
 */
import { useId, useState, type ChangeEvent, type ReactElement } from "react";
import { EMPTY_ANNOTATION, MAX_ANNOTATION_TEXT, defaultToolForPrimitive } from "../state/authoringSlice";
import { useAppDispatch, useAppState } from "../state/AppStateProvider";
import { selectManifestRows } from "../state/selectors";
import type { StepAnnotation } from "../state/types";
import { ChevronDownIcon } from "../ui/icons";

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
  const [open, setOpen] = useState(true);
  const index = state.view.selectedStepIndex;
  const row = index === null ? undefined : selectManifestRows(state)[index];

  if (row === undefined) {
    return (
      <section className="gf-notes gf-notes--idle" aria-labelledby={`${ids}-heading`}>
        <h3 id={`${ids}-heading`} className="gf-notes__title">
          Step Notes
        </h3>
        <p className="gf-notes__hint">Select a step to add its tool, torque, warning and notes.</p>
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
    <section className="gf-notes gf-author" aria-labelledby={`${ids}-heading`}>
      <div className="gf-notes__head">
        <h3 id={`${ids}-heading`} className="gf-notes__title">
          Step Notes
          <span className="gf-notes__sub">
            {" "}
            · Step {row.number}: {row.name}
          </span>
        </h3>
        <button
          type="button"
          className="gf-notes__toggle"
          aria-expanded={open}
          aria-controls={`${ids}-body`}
          aria-label={open ? "Collapse step notes" : "Expand step notes"}
          title={open ? "Collapse step notes" : "Expand step notes"}
          data-open={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDownIcon size={16} />
        </button>
      </div>

      <div id={`${ids}-body`} className="gf-notes__body" hidden={!open}>
        <div className="gf-field gf-field--wide">
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
          <label className="gf-field__label" htmlFor={`${ids}-sub`}>
            Subassembly
          </label>
          <input
            id={`${ids}-sub`}
            className="gf-input"
            type="text"
            maxLength={MAX_ANNOTATION_TEXT}
            value={annotation.subassembly}
            placeholder="Plate stack"
            onChange={onText("subassembly")}
          />
        </div>

        <div className="gf-field gf-field--wide">
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

        <div className="gf-field gf-field--wide">
          <label className="gf-field__label" htmlFor={`${ids}-note`}>
            Note
          </label>
          <textarea
            id={`${ids}-note`}
            className="gf-input gf-input--area"
            rows={2}
            maxLength={MAX_ANNOTATION_TEXT}
            value={annotation.note}
            placeholder="Custom note for this step"
            onChange={onText("note")}
          />
        </div>

        <div className="gf-notes__foot">
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
            Clear notes
          </button>
        </div>
      </div>
    </section>
  );
}
