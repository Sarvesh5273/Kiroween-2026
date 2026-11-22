/**
 * Step Caption Bar: sits under the viewport and shows the current step as text.
 *
 * It carries the plain-English instruction, the tool, torque and warning tags and the shortcut
 * legend. The text is the full instruction, so the app is 100% understandable on mute. The optional
 * Read Aloud toggle speaks the same text through `window.speechSynthesis`. It is disabled with a
 * visible reason when the browser has no speech support.
 */
import { useEffect, type ReactElement } from "react";
import { useAppDispatch, useAppState } from "../state/AppStateProvider";
import { WarnIcon } from "../ui/icons";
import { buildNarration, selectCurrentStepModel, type StepCaptionModel } from "./stepText";
import { SHORTCUT_LEGEND } from "./useKeyboardShortcuts";

/** True when the browser can speak. Checked at call time so tests and SSR need no browser. */
export function isSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

function ShortcutLegend(): ReactElement {
  return (
    <p className="gf-shortcuts" aria-label="Keyboard shortcuts">
      {SHORTCUT_LEGEND.map((entry) => (
        <span key={entry.keys} className="gf-shortcuts__item">
          <kbd className="gf-kbd">{entry.keys}</kbd> {entry.label}
        </span>
      ))}
    </p>
  );
}

function CaptionTags({ model }: { model: StepCaptionModel }): ReactElement | null {
  const hasTags =
    model.tool !== "" || model.torque !== "" || model.warning !== "" || model.markFlexible;
  if (!hasTags && model.subassembly === "") return null;
  return (
    <ul className="gf-caption__tags" aria-label="Step details">
      {model.tool !== "" ? (
        <li className="gf-tag">
          <span className="gf-tag__key">Tool</span> {model.tool}
        </li>
      ) : null}
      {model.torque !== "" ? (
        <li className="gf-tag">
          <span className="gf-tag__key">Torque</span> {model.torque}
        </li>
      ) : null}
      {model.warning !== "" ? (
        <li className="gf-tag gf-tag--warn">
          <WarnIcon className="gf-icon" />
          <span className="gf-tag__key">Warning</span> {model.warning}
        </li>
      ) : null}
      {model.markFlexible ? <li className="gf-tag gf-tag--warn">Flexible part</li> : null}
      {model.subassembly !== "" ? (
        <li className="gf-tag">
          <span className="gf-tag__key">Subassembly</span> {model.subassembly}
        </li>
      ) : null}
    </ul>
  );
}

export function StepCaptionBar(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const model = selectCurrentStepModel(state);
  const enabled = state.authoring.narrationEnabled;
  const supported = isSpeechSupported();
  const speaking = enabled && supported;
  const narration = model === null ? null : buildNarration(model);

  // Speaks on every step change while Read Aloud is on. Cleanup cancels speech that is still running.
  useEffect(() => {
    if (!speaking || narration === null) return undefined;
    const synth = window.speechSynthesis;
    synth.cancel();
    synth.speak(new window.SpeechSynthesisUtterance(narration));
    return () => synth.cancel();
  }, [speaking, narration]);

  const hasPlan = state.solve.result !== null && state.solve.result.plan.status !== "error";

  return (
    <section className="gf-caption" aria-label="Current step">
      <div className="gf-caption__main">
        {model !== null ? (
          <>
            <p className="gf-caption__step">
              Step {model.number} of {model.total}
              <span className="gf-caption__part"> · {model.name}</span>
            </p>
            <p className="gf-caption__text" data-testid="caption-text">
              {model.instruction}
            </p>
            <CaptionTags model={model} />
            {model.note !== "" ? <p className="gf-caption__note">{model.note}</p> : null}
          </>
        ) : (
          <p className="gf-caption__text gf-caption__text--idle" data-testid="caption-text">
            {hasPlan
              ? "Select a step in the manifest or press J to start the walkthrough."
              : "Load a kit or a file to see step-by-step instructions here."}
          </p>
        )}
      </div>
      <div className="gf-caption__side">
        <button
          type="button"
          className="gf-btn gf-btn--compact"
          aria-pressed={enabled && supported}
          disabled={!supported}
          title="Speak each step aloud"
          onClick={() => dispatch({ type: "authoring/narrationSet", enabled: !enabled })}
        >
          Read Aloud: {enabled && supported ? "On" : "Off"}
        </button>
        {!supported ? (
          <p className="gf-caption__reason" data-testid="narration-reason">
            Read Aloud is not available in this browser. The captions carry every instruction.
          </p>
        ) : null}
      </div>
      <ShortcutLegend />
    </section>
  );
}
