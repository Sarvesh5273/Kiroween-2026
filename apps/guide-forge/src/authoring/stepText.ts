/**
 * Plain-English step text shared by the Step Caption Bar, Read Aloud and the offline manual.
 *
 * Pure. No React, no DOM and no three import. The wording depends on the compiled motion primitive
 * and the display name of the part, never on a part id or a mesh name.
 */
import { resolveAnnotation } from "../state/authoringSlice";
import { selectManifestRows } from "../state/selectors";
import type { AppState, StepAnnotation } from "../state/types";

/** One plain sentence that tells the reader what to do with the part. */
export function buildStepInstruction(primitive: string | null, partName: string): string {
  switch (primitive) {
    case "helical_unscrew":
      return `Unscrew ${partName} counter-clockwise until it lifts free.`;
    case "linear_slide":
      return `Lift ${partName} straight out along the arrow.`;
    case "two_step_l_slide":
      return `Slide ${partName} sideways to release it, then lift it clear.`;
    default:
      return `Remove ${partName} along its planned escape path.`;
  }
}

export interface StepCaptionModel {
  /** Zero-based index in the plan. */
  index: number;
  /** `index + 1`. */
  number: number;
  total: number;
  partId: string;
  name: string;
  primitive: string | null;
  instruction: string;
  tool: string;
  torque: string;
  warning: string;
  note: string;
  subassembly: string;
  markFlexible: boolean;
}

/** Joins the instruction and annotation of one step into the model that the UI and exporter share. */
export function buildStepModel(args: {
  index: number;
  total: number;
  partId: string;
  name: string;
  primitive: string | null;
  annotation: StepAnnotation;
}): StepCaptionModel {
  const { annotation } = args;
  return {
    index: args.index,
    number: args.index + 1,
    total: args.total,
    partId: args.partId,
    name: args.name,
    primitive: args.primitive,
    instruction: buildStepInstruction(args.primitive, args.name),
    tool: annotation.tool,
    torque: annotation.torque.trim(),
    warning: annotation.warning.trim(),
    note: annotation.note.trim(),
    subassembly: annotation.subassembly.trim(),
    markFlexible: annotation.markFlexible,
  };
}

/** All steps of the current plan as caption models, in plan order. Empty when there is no plan. */
export function selectStepModels(state: AppState): StepCaptionModel[] {
  const rows = selectManifestRows(state);
  return rows.map((row) =>
    buildStepModel({
      index: row.index,
      total: rows.length,
      partId: row.partId,
      name: row.name,
      primitive: row.primitive,
      annotation: resolveAnnotation(state.authoring, row.partId, row.primitive),
    }),
  );
}

/** The model of the selected step, or `null` when no step is selected. */
export function selectCurrentStepModel(state: AppState): StepCaptionModel | null {
  const index = state.view.selectedStepIndex;
  if (index === null) return null;
  return selectStepModels(state)[index] ?? null;
}

/** Text for `speechSynthesis`: the same facts the caption shows, in reading order. */
export function buildNarration(model: StepCaptionModel): string {
  const parts = [`Step ${model.number} of ${model.total}.`, model.instruction];
  if (model.tool !== "") parts.push(`Tool: ${model.tool}.`);
  if (model.torque !== "") parts.push(`Torque: ${model.torque}.`);
  if (model.warning !== "") parts.push(`Warning: ${model.warning}.`);
  if (model.markFlexible) parts.push("This part is flexible. Handle it gently.");
  if (model.note !== "") parts.push(model.note);
  return parts.join(" ");
}
