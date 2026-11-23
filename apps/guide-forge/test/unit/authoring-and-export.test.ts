/**
 * Part 2 unit tests: the authoring slice, the keyboard shortcut resolver and the offline manual.
 *
 * The solved and deadlocked states come from the real solve pipeline (`runSolve`), so step order,
 * primitives and clash counts come from the geometry and the algorithm. Nothing here names a part
 * id or a mesh. The tests read ids and primitives from the result.
 */
import { checkClashes } from "@unboltkit/core";
import { beforeAll, describe, expect, it } from "vitest";
import { selectStepModels } from "../../src/authoring/stepText";
import {
  nextStepIndex,
  resolveShortcut,
  type ShortcutKeyEvent,
  type ShortcutTarget,
} from "../../src/authoring/useKeyboardShortcuts";
import {
  buildManualInput,
  buildOfflineManualHtml,
  canExportManual,
  escapeHtml,
  manualFileName,
  type ManualInput,
} from "../../src/export/manualExporter";
import type { SolveResult } from "../../src/protocol";
import {
  defaultToolForPrimitive,
  initialAuthoringSlice,
  resolveAnnotation,
} from "../../src/state/authoringSlice";
import { initialState, rootReducer } from "../../src/state/reducer";
import type { AppAction, AppState } from "../../src/state/types";
import { runSolve } from "../../src/worker/solvePipeline";

function solveKit(kitName: string): SolveResult {
  return runSolve(
    { type: "solve", requestId: 1, source: { kind: "kit", kitName } },
    { now: () => performance.now(), checkClashes },
  );
}

function reduce(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(rootReducer, state);
}

/** State after a finished solve of `kitName`. */
function loadedState(kitName: string, result: SolveResult): AppState {
  return reduce(
    initialState,
    { type: "solve/started", requestId: 1, label: { kind: "kit", kitName } },
    { type: "solve/succeeded", requestId: 1, result },
  );
}

const SNAPSHOT_A = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const SNAPSHOT_B = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let keyboard: SolveResult;
let cage: SolveResult;

beforeAll(() => {
  keyboard = solveKit("mechanical-keyboard-65");
  cage = solveKit("deadlock-cage-dumbbell-ring");
});

describe("authoringSlice", () => {
  it("starts with no annotations, visibility all and narration off", () => {
    expect(initialState.authoring).toEqual({
      annotations: {},
      visibilityMode: "all",
      narrationEnabled: false,
    });
    expect(initialAuthoringSlice.narrationEnabled).toBe(false);
  });

  it("derives default tool labels from the motion primitive only", () => {
    expect(defaultToolForPrimitive("helical_unscrew")).toBe("Hex / Torx Driver");
    expect(defaultToolForPrimitive("linear_slide")).toBe("Lift / Spudger");
    expect(defaultToolForPrimitive("two_step_l_slide")).toBe("Slide & Release");
    expect(defaultToolForPrimitive(null)).toBe("");
    expect(defaultToolForPrimitive("toString")).toBe("");
    expect(defaultToolForPrimitive("custom_primitive")).toBe("");
  });

  it("resolves each step's default tool from its compiled primitive and lets the author override it", () => {
    const state = loadedState("mechanical-keyboard-65", keyboard);
    const models = selectStepModels(state);
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.tool).toBe(defaultToolForPrimitive(model.primitive));
    }
    const first = models[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const edited = reduce(state, {
      type: "authoring/annotationPatched",
      partId: first.partId,
      patch: { tool: "M2.5 Hex" },
    });
    expect(resolveAnnotation(edited.authoring, first.partId, first.primitive).tool).toBe("M2.5 Hex");
    expect(selectStepModels(edited)[0]?.tool).toBe("M2.5 Hex");
  });

  it("stores annotations per partId and drops an entry that returns to the defaults", () => {
    const state = loadedState("mechanical-keyboard-65", keyboard);
    const partId = selectStepModels(state)[1]?.partId;
    expect(partId).toBeDefined();
    if (partId === undefined) return;

    const patched = reduce(state, {
      type: "authoring/annotationPatched",
      partId,
      patch: { torque: "1.8 Nm", warning: "ESD Safe", markFlexible: true },
    });
    expect(patched.authoring.annotations[partId]).toEqual({
      tool: "",
      torque: "1.8 Nm",
      warning: "ESD Safe",
      note: "",
      subassembly: "",
      markFlexible: true,
    });
    expect(Object.keys(patched.authoring.annotations)).toEqual([partId]);

    // The same patch again changes nothing, so the state keeps its identity.
    const again = rootReducer(patched, {
      type: "authoring/annotationPatched",
      partId,
      patch: { torque: "1.8 Nm" },
    });
    expect(again).toBe(patched);

    const reverted = reduce(patched, {
      type: "authoring/annotationPatched",
      partId,
      patch: { torque: "", warning: "", markFlexible: false },
    });
    expect(reverted.authoring.annotations).toEqual({});

    const cleared = reduce(patched, { type: "authoring/annotationCleared", partId });
    expect(cleared.authoring.annotations).toEqual({});
  });

  it("ignores a patch for a part that is not a step of the current plan", () => {
    const state = loadedState("mechanical-keyboard-65", keyboard);
    const next = rootReducer(state, {
      type: "authoring/annotationPatched",
      partId: "no-such-part",
      patch: { note: "x" },
    });
    expect(next).toBe(state);
    expect(rootReducer(initialState, {
      type: "authoring/annotationPatched",
      partId: "anything",
      patch: { note: "x" },
    })).toBe(initialState);
  });

  it("stores visibility mode and narration, and rejects an unknown visibility mode", () => {
    let state = reduce(
      initialState,
      { type: "authoring/visibilitySet", mode: "hide-removed" },
      { type: "authoring/narrationSet", enabled: true },
    );
    expect(state.authoring.visibilityMode).toBe("hide-removed");
    expect(state.authoring.narrationEnabled).toBe(true);
    state = reduce(state, { type: "authoring/visibilitySet", mode: "ghost-context" });
    expect(state.authoring.visibilityMode).toBe("ghost-context");
    const unchanged = rootReducer(state, {
      type: "authoring/visibilitySet",
      mode: "bogus" as unknown as "all",
    });
    expect(unchanged).toBe(state);
  });

  it("resets annotations and visibility mode on solve/started and keeps narration", () => {
    let state = loadedState("mechanical-keyboard-65", keyboard);
    const partId = selectStepModels(state)[0]?.partId;
    expect(partId).toBeDefined();
    if (partId === undefined) return;
    state = reduce(
      state,
      { type: "authoring/annotationPatched", partId, patch: { note: "Keep the ribbon cable attached." } },
      { type: "authoring/visibilitySet", mode: "ghost-context" },
      { type: "authoring/narrationSet", enabled: true },
    );
    expect(Object.keys(state.authoring.annotations)).toEqual([partId]);

    const restarted = rootReducer(state, {
      type: "solve/started",
      requestId: 2,
      label: { kind: "kit", kitName: "planetary-gearbox-3-stage" },
    });
    expect(restarted.authoring.annotations).toEqual({});
    expect(restarted.authoring.visibilityMode).toBe("all");
    expect(restarted.authoring.narrationEnabled).toBe(true);
  });
});

describe("keyboard shortcuts", () => {
  const key = (k: string, extra: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    ...extra,
  });
  const page: ShortcutTarget = { tagName: "BODY" };

  it("maps every documented key", () => {
    expect(resolveShortcut(key("j"), page)).toEqual({ kind: "step", direction: 1 });
    expect(resolveShortcut(key("ArrowRight"), page)).toEqual({ kind: "step", direction: 1 });
    expect(resolveShortcut(key("K"), page)).toEqual({ kind: "step", direction: -1 });
    expect(resolveShortcut(key("ArrowLeft"), page)).toEqual({ kind: "step", direction: -1 });
    expect(resolveShortcut(key(" "), page)).toEqual({ kind: "playPause" });
    expect(resolveShortcut(key("m"), page)).toEqual({ kind: "toggleMode" });
    expect(resolveShortcut(key("1"), page)).toEqual({ kind: "camera", camera: "iso" });
    expect(resolveShortcut(key("2"), page)).toEqual({ kind: "camera", camera: "front" });
    expect(resolveShortcut(key("3"), page)).toEqual({ kind: "camera", camera: "top" });
    expect(resolveShortcut(key("f"), page)).toEqual({ kind: "camera", camera: "fit" });
    expect(resolveShortcut(key("x"), page)).toBeNull();
  });

  it("ignores keys typed into input, textarea, select and contentEditable", () => {
    for (const target of [
      { tagName: "INPUT" },
      { tagName: "textarea" },
      { tagName: "SELECT" },
      { tagName: "DIV", isContentEditable: true },
      { tagName: "DIV", getAttribute: (name: string) => (name === "contenteditable" ? "true" : null) },
    ] satisfies ShortcutTarget[]) {
      expect(resolveShortcut(key("j"), target)).toBeNull();
      expect(resolveShortcut(key(" "), target)).toBeNull();
      expect(resolveShortcut(key("ArrowLeft"), target)).toBeNull();
    }
  });

  it("ignores modified keys and leaves Space to a focused button", () => {
    expect(resolveShortcut(key("j", { ctrlKey: true }), page)).toBeNull();
    expect(resolveShortcut(key("f", { metaKey: true }), page)).toBeNull();
    expect(resolveShortcut(key("m", { altKey: true }), page)).toBeNull();
    expect(resolveShortcut(key(" "), { tagName: "BUTTON" })).toBeNull();
  });

  it("moves the step index within bounds", () => {
    expect(nextStepIndex(null, 5, 1)).toBe(0);
    expect(nextStepIndex(null, 5, -1)).toBeNull();
    expect(nextStepIndex(0, 5, 1)).toBe(1);
    expect(nextStepIndex(4, 5, 1)).toBeNull();
    expect(nextStepIndex(0, 5, -1)).toBeNull();
    expect(nextStepIndex(3, 5, -1)).toBe(2);
    expect(nextStepIndex(0, 0, 1)).toBeNull();
  });
});

describe("buildOfflineManualHtml", () => {
  function annotatedState(): { state: AppState; names: string[] } {
    let state = loadedState("mechanical-keyboard-65", keyboard);
    const models = selectStepModels(state);
    const first = models[0];
    const second = models[1];
    if (first === undefined || second === undefined) throw new Error("expected at least two steps");
    state = reduce(
      state,
      {
        type: "authoring/annotationPatched",
        partId: first.partId,
        patch: {
          tool: "PH0 Driver",
          torque: "1.8 Nm",
          warning: "Spring Tension",
          note: "Keep the screw <b>tray</b> close",
          subassembly: "Top case",
          markFlexible: true,
        },
      },
      {
        type: "authoring/annotationPatched",
        partId: second.partId,
        patch: { tool: "Tweezers", warning: "ESD Safe" },
      },
    );
    return { state, names: models.map((m) => m.name) };
  }

  function exportHtml(state: AppState): string {
    const input = buildManualInput(
      state,
      { assembled: SNAPSHOT_A, exploded: SNAPSHOT_B },
      "2027-10-31",
    );
    expect(input).not.toBeNull();
    if (input === null) throw new Error("no manual input");
    return buildOfflineManualHtml(input);
  }

  it("is enabled only for a ready solved or deadlocked result", () => {
    expect(canExportManual(initialState)).toBe(false);
    const loading = rootReducer(initialState, {
      type: "solve/started",
      requestId: 1,
      label: { kind: "kit", kitName: "mechanical-keyboard-65" },
    });
    expect(canExportManual(loading)).toBe(false);
    expect(canExportManual(loadedState("mechanical-keyboard-65", keyboard))).toBe(true);
    expect(canExportManual(loadedState("deadlock-cage-dumbbell-ring", cage))).toBe(true);
    expect(buildManualInput(initialState, { assembled: null, exploded: null }, "x")).toBeNull();
  });

  it("escapes script tags, ampersands, quotes and apostrophes in every user string", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
    const hostile = `<script>alert("xss")</script> & "q"`;
    const input: ManualInput = {
      title: hostile,
      sourceLabel: hostile,
      generatedAt: hostile,
      partCount: 2,
      planStatus: "deadlocked",
      steps: [
        {
          number: 1,
          name: hostile,
          primitive: "linear_slide",
          instruction: hostile,
          escapeDistanceText: "0.100",
          tool: hostile,
          torque: hostile,
          warning: hostile,
          note: hostile,
          subassembly: hostile,
          markFlexible: true,
        },
      ],
      lockedParts: [hostile],
      guideVerification: { text: hostile, tone: "warn" },
      legacyRayHits: 0,
      naiveBadge: { text: hostile },
      snapshots: {
        assembled: 'data:image/png;base64,AAAA" onerror="alert(1)',
        exploded: SNAPSHOT_B,
      },
    };
    const html = buildOfflineManualHtml(input);
    expect(html).not.toContain(hostile);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;q&quot;");
    // Exactly one script element: the viewer script that this module owns.
    expect(html.match(/<script\b/gi)?.length).toBe(1);
    // A malformed snapshot URL is rejected, so it cannot inject an attribute.
    expect(html).not.toContain("onerror=");
    expect(html).toContain("Snapshot not available");
    expect(html).toContain(`src="${SNAPSHOT_B}"`);
  });

  it("has no external script, stylesheet, image or URL of any kind", () => {
    const html = exportHtml(annotatedState().state);
    expect(html).not.toMatch(/<script[^>]*\ssrc\s*=/i);
    expect(html).not.toMatch(/<link[^>]*\shref\s*=\s*["']?https?:/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/url\(\s*["']?https?:/i);
    expect(html).not.toMatch(/@import/i);
    for (const match of html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)) {
      expect(match[1]?.startsWith("data:image/png;base64,")).toBe(true);
    }
    expect(html).toContain("default-src &#39;none&#39;");
  });

  it("says Full guide not verified, keeps the legacy ray count as a diagnostic, and embeds both snapshots", () => {
    const html = exportHtml(annotatedState().state);
    // No full-guide check has run, so the manual must not claim one.
    expect(html).toContain("Full guide not verified");
    expect(html).not.toContain("Independent Oracle Proof");
    expect(html).not.toMatch(/zero-clash|mathematically verified/i);
    expect(html.replace(/not verified/gi, "")).not.toMatch(/\bverified\b/i);
    const oracle = keyboard.oracle;
    if (oracle === null) throw new Error("expected a legacy ray report");
    expect(html).toContain(
      `Legacy ray check (diagnostic only, not proof): ${oracle.totalClashes} legacy ray ${oracle.totalClashes === 1 ? "hit" : "hits"}`,
    );
    const naive = keyboard.naive;
    expect(naive).not.toBeNull();
    if (naive === null) return;
    expect(html).toContain("Naive Radial Explode");
    expect(html).toContain(`${naive.totalClashes} Clashes`);
    expect(html).toContain(`src="${SNAPSHOT_A}"`);
    expect(html).toContain(`src="${SNAPSHOT_B}"`);
    expect(html).toContain(`${keyboard.parts.length} parts`);
    expect(html).toContain("@media print");
    expect(html).toContain("#F6F8FB");
    expect(html).toContain("#1E3A5F");
    expect(html).toContain("#0F172A");
  });

  it("lists every step in plan order with checkboxes, navigation and the viewer script", () => {
    const { state, names } = annotatedState();
    const html = exportHtml(state);
    const plan = keyboard.plan;
    expect(plan.status).toBe("solved");
    if (plan.status !== "solved") return;
    expect(names).toHaveLength(plan.steps.length);

    let cursor = -1;
    for (let n = 1; n <= plan.steps.length; n += 1) {
      const at = html.indexOf(`id="step-${n}"`);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
      expect(html).toContain(`<input type="checkbox" class="done-box" data-step="${n}">`);
    }
    expect(html).not.toContain(`id="step-${plan.steps.length + 1}"`);
    expect(html.match(/class="step"/g)).toHaveLength(plan.steps.length);
    expect(html).toContain('id="prev-step"');
    expect(html).toContain('id="next-step"');
    expect(html).toContain('"ArrowRight"');
    expect(html).toContain('key === "j"');
    expect(html).toContain('key === "k"');
  });

  it("includes the edited tool, torque, warning, note, subassembly and flexible flag", () => {
    const html = exportHtml(annotatedState().state);
    expect(html).toContain("PH0 Driver");
    expect(html).toContain("1.8 Nm");
    expect(html).toContain("Spring Tension");
    expect(html).toContain("Tweezers");
    expect(html).toContain("ESD Safe");
    expect(html).toContain("Top case");
    expect(html).toContain("Flexible part");
    // The note keeps its markup as text.
    expect(html).toContain("Keep the screw &lt;b&gt;tray&lt;/b&gt; close");
    expect(html).not.toContain("<b>tray</b>");
  });

  it("aggregates tools and the bill of materials, using default tools for untouched steps", () => {
    const { state } = annotatedState();
    const html = exportHtml(state);
    const toolsAt = html.indexOf("Tools required");
    const bomAt = html.indexOf("Bill of materials");
    const stepsAt = html.indexOf("Step-by-step");
    expect(toolsAt).toBeGreaterThan(-1);
    expect(bomAt).toBeGreaterThan(toolsAt);
    expect(stepsAt).toBeGreaterThan(bomAt);

    const models = selectStepModels(state);
    const defaults = new Set(models.slice(2).map((m) => defaultToolForPrimitive(m.primitive)).filter((t) => t !== ""));
    expect(defaults.size).toBeGreaterThan(0);
    const toolsSection = html.slice(toolsAt, bomAt);
    for (const tool of defaults) expect(toolsSection).toContain(escapeHtml(tool));
    // Aggregation: one row per distinct tool, with the step count.
    const rowCount = toolsSection.match(/<tr><td>/g)?.length ?? 0;
    const distinct = new Set(models.map((m) => (m.tool === "" ? "Unspecified" : m.tool)));
    expect(rowCount).toBe(distinct.size);
    const bomSection = html.slice(bomAt, stepsAt);
    expect(bomSection.match(/<tr><td class="num">/g)).toHaveLength(models.length);
  });

  it("exports a deadlocked plan with the interlock verdict and its locked parts", () => {
    const state = loadedState("deadlock-cage-dumbbell-ring", cage);
    const input = buildManualInput(state, { assembled: null, exploded: null }, "2027-10-31");
    expect(input).not.toBeNull();
    if (input === null) return;
    expect(input.planStatus).toBe("deadlocked");
    expect(input.lockedParts.length).toBeGreaterThan(0);
    const html = buildOfflineManualHtml(input);
    expect(html).toContain("Interlocked • No Valid Sequence");
    expect(html).toContain("Interlocked: no valid removal sequence");
    expect(html).toContain("Full guide not verified");
    expect(html).toContain("Snapshot not available");
    for (const name of input.lockedParts) expect(html).toContain(escapeHtml(name));
  });

  it("builds a safe download file name", () => {
    expect(manualFileName("Mechanical Keyboard 65%")).toBe("mechanical-keyboard-65-manual.html");
    expect(manualFileName("../../etc/passwd.glb")).toBe("etc-passwd-manual.html");
    expect(manualFileName("***")).toBe("assembly-manual.html");
  });
});
