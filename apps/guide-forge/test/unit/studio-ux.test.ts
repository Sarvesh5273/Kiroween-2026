/**
 * Studio UX state tests: the one-click Naive switch, toast feedback, the comparison card model and
 * the pipeline telemetry model.
 *
 * Every solved and deadlocked state comes from the real solve pipeline (`runSolve`), and the
 * progress events are the ones that pipeline emits. Expected values are read from the result, so
 * nothing here names a part id or a clash count.
 */
import { checkClashes } from "@unboltkit/core";
import { beforeAll, describe, expect, it } from "vitest";
import { STAGE_NAMES } from "../../src/protocol";
import type { SolveResult, StageProgressEvent } from "../../src/protocol";
import { initialState, rootReducer } from "../../src/state/reducer";
import {
  formatDuration,
  formatStageMs,
  selectClashBadge,
  selectComparison,
  selectPipelineTelemetry,
  stageActivityLabel,
} from "../../src/state/selectors";
import type { AppAction, AppState } from "../../src/state/types";
import { NAIVE_ENTRY_EXPLODE } from "../../src/state/viewSlice";
import { runSolve } from "../../src/worker/solvePipeline";

interface SolveRun {
  kitName: string;
  result: SolveResult;
  events: StageProgressEvent[];
}

function solveKit(kitName: string): SolveRun {
  const events: StageProgressEvent[] = [];
  const result = runSolve(
    { type: "solve", requestId: 1, source: { kind: "kit", kitName } },
    { now: () => performance.now(), checkClashes, onProgress: (event) => events.push(event) },
  );
  return { kitName, result, events };
}

function reduce(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(rootReducer, state);
}

/** State while the solve is running, after the first `eventCount` progress events. */
function runningState(run: SolveRun, eventCount: number): AppState {
  return reduce(
    initialState,
    { type: "solve/started", requestId: 1, label: { kind: "kit", kitName: run.kitName } },
    ...run.events
      .slice(0, eventCount)
      .map((event): AppAction => ({ type: "solve/progress", requestId: 1, event })),
  );
}

/** State after a finished solve, with every progress event applied. */
function loadedState(run: SolveRun, result: SolveResult = run.result): AppState {
  return reduce(runningState(run, run.events.length), {
    type: "solve/succeeded",
    requestId: 1,
    result,
  });
}

let keyboard: SolveRun;
let cage: SolveRun;

beforeAll(() => {
  keyboard = solveKit("mechanical-keyboard-65");
  cage = solveKit("deadlock-cage-dumbbell-ring");
});

describe("one-click Naive switch", () => {
  it("opens the explode slider to 0.65 when Naive is chosen with the slider closed", () => {
    const state = loadedState(keyboard);
    expect(state.view.naiveExplode).toBe(0);
    const naive = reduce(state, { type: "view/modeSet", mode: "naive" });
    expect(NAIVE_ENTRY_EXPLODE).toBe(0.65);
    expect(naive.view.mode).toBe("naive");
    expect(naive.view.naiveExplode).toBe(0.65);
  });

  it("keeps an explode value the user already chose, and reopens it after a drag to zero", () => {
    let state = reduce(loadedState(keyboard), { type: "view/modeSet", mode: "naive" });
    state = reduce(state, { type: "view/explodeSet", s: 0.3 }, { type: "view/modeSet", mode: "dbg" });
    expect(state.view.naiveExplode).toBe(0.3);
    state = reduce(state, { type: "view/modeSet", mode: "naive" });
    expect(state.view.naiveExplode).toBe(0.3);

    state = reduce(
      state,
      { type: "view/explodeSet", s: 0 },
      { type: "view/modeSet", mode: "dbg" },
      { type: "view/modeSet", mode: "naive" },
    );
    expect(state.view.naiveExplode).toBe(NAIVE_ENTRY_EXPLODE);
  });

  it("leaves the slider closed when the result has no naive report", () => {
    const withoutNaive = { ...keyboard.result, naive: null };
    const state = reduce(loadedState(keyboard, withoutNaive), { type: "view/modeSet", mode: "naive" });
    expect(state.view.mode).toBe("naive");
    expect(state.view.naiveExplode).toBe(0);
  });

  it("stops playback when the mode changes", () => {
    const state = reduce(loadedState(keyboard), { type: "view/playRequested" });
    expect(state.view.playing).toBe(true);
    const dbg = reduce(state, { type: "view/modeSet", mode: "naive" }, { type: "view/modeSet", mode: "dbg" });
    expect(dbg.view.mode).toBe("dbg");
    expect(dbg.view.playing).toBe(false);
  });

  it("changes nothing when no plan is loaded", () => {
    expect(rootReducer(initialState, { type: "view/modeSet", mode: "naive" })).toBe(initialState);
  });
});

describe("toast feedback", () => {
  it("posts a toast for an accepted mode switch with the naive clash total from the result", () => {
    const state = loadedState(keyboard);
    expect(state.feedback.toast).toBeNull();
    const total = keyboard.result.naive?.totalClashes;
    expect(total).toBeDefined();

    const naive = reduce(state, { type: "view/modeSet", mode: "naive" });
    expect(naive.feedback.toast?.tone).toBe("warn");
    expect(naive.feedback.toast?.text).toContain("Naive Radial Explode");
    expect(naive.feedback.toast?.text).toContain(String(total));
    expect(naive.feedback.announcement.seq).toBe(state.feedback.announcement.seq + 1);

    const dbg = reduce(naive, { type: "view/modeSet", mode: "dbg" });
    expect(dbg.feedback.toast?.tone).toBe("ok");
    expect(dbg.feedback.toast?.text).toBe("Switched to UnboltKit DBG");
    expect(dbg.feedback.toast?.seq).toBe((naive.feedback.toast?.seq ?? 0) + 1);
  });

  it("posts no toast for a rejected mode switch", () => {
    const state = loadedState(keyboard);
    expect(rootReducer(state, { type: "view/modeSet", mode: "dbg" })).toBe(state);
  });

  it("shows a posted toast and reads it through the live region", () => {
    const state = loadedState(keyboard);
    const next = reduce(state, {
      type: "feedback/toastPosted",
      tone: "ok",
      text: "Manual exported: keyboard-manual.html",
    });
    expect(next.feedback.toast).toEqual({
      seq: 1,
      tone: "ok",
      text: "Manual exported: keyboard-manual.html",
    });
    expect(next.feedback.announcement.text).toBe("Manual exported: keyboard-manual.html");
    expect(next.feedback.announcement.seq).toBe(state.feedback.announcement.seq + 1);
  });

  it("ignores a blank toast", () => {
    expect(rootReducer(initialState, { type: "feedback/toastPosted", tone: "info", text: "   " })).toBe(
      initialState,
    );
  });

  it("keeps the last toast when a new solve starts", () => {
    const toasted = reduce(loadedState(keyboard), { type: "feedback/toastPosted", tone: "ok", text: "Done" });
    const restarted = rootReducer(toasted, {
      type: "solve/started",
      requestId: 2,
      label: { kind: "kit", kitName: "planetary-gearbox-3-stage" },
    });
    expect(restarted.feedback.toast).toEqual(toasted.feedback.toast);
    expect(restarted.feedback.recovery).toBeNull();
  });
});

describe("comparison card model", () => {
  it("reads the legacy ray count and the naive report of a solved plan, and never says Verified", () => {
    const comparison = selectComparison(keyboard.result);
    expect(comparison).not.toBeNull();
    const { oracle, naive } = keyboard.result;
    if (comparison === null || oracle === null || naive === null) throw new Error("expected both reports");

    expect(comparison.dbg.clashes).toBe(oracle.totalClashes);
    expect(comparison.dbg.status).toBe("unverified");
    expect(comparison.dbg.text).toBe(
      `${oracle.totalClashes} legacy ray ${oracle.totalClashes === 1 ? "hit" : "hits"} (full guide not verified)`,
    );
    // The only "verified" in the text is the negated one.
    expect(comparison.dbg.text.replace(/not verified/gi, "")).not.toMatch(/verified/i);

    const obstructed = naive.perPart.filter((entry) => entry.clashCount > 0).length;
    expect(comparison.naive.clashes).toBe(naive.totalClashes);
    expect(comparison.naive.obstructed).toBe(obstructed);
    expect(comparison.naive.total).toBe(naive.perPart.length);
    expect(comparison.naive.text).toBe(
      `${naive.totalClashes} ${naive.totalClashes === 1 ? "clash" : "clashes"} (${obstructed}/${naive.perPart.length} parts obstructed)`,
    );
    // The naive explode collides; the plan's legacy ray count is a diagnostic only.
    expect(comparison.naive.clashes).toBeGreaterThan(0);
  });

  it("agrees with the header Clash_Badge in Naive mode and in DBG mode", () => {
    const comparison = selectComparison(keyboard.result);
    expect(comparison).not.toBeNull();
    if (comparison === null) return;
    // Two selectors, one source of truth: the card and the badge must never disagree.
    expect(selectClashBadge(keyboard.result, "naive").text).toBe(
      `${comparison.naive.clashes} Clashes • ${comparison.naive.obstructed} Obstructed Parts`,
    );
    const hits = comparison.dbg.clashes ?? -1;
    expect(selectClashBadge(keyboard.result, "dbg")).toEqual({
      icon: "unverified",
      text: `Full guide not verified • ${hits} legacy ray ${hits === 1 ? "hit" : "hits"}`,
    });
  });

  it("says the full guide is not verified with zero ray hits, with hits, and without a ray report", () => {
    const oracle = keyboard.result.oracle;
    if (oracle === null) throw new Error("expected an oracle report");
    const zero = selectComparison({ ...keyboard.result, oracle: { ...oracle, totalClashes: 0 } });
    expect(zero?.dbg.text).toBe("0 legacy ray hits (full guide not verified)");
    expect(selectClashBadge({ ...keyboard.result, oracle: { ...oracle, totalClashes: 0 } }, "dbg").icon).toBe("unverified");

    const dirty = selectComparison({ ...keyboard.result, oracle: { ...oracle, totalClashes: 3 } });
    expect(dirty?.dbg.text).toBe("3 legacy ray hits (full guide not verified)");

    const noOracle = selectComparison({ ...keyboard.result, oracle: null });
    expect(noOracle?.dbg.clashes).toBeNull();
    expect(noOracle?.dbg.text).toBe("Full guide not verified");
    expect(selectClashBadge({ ...keyboard.result, oracle: null }, "dbg").text).toBe("Full guide not verified");
  });

  it("is absent for a deadlocked plan, an empty state and a result without a naive report", () => {
    expect(cage.result.plan.status).toBe("deadlocked");
    expect(selectComparison(cage.result)).toBeNull();
    expect(selectComparison(null)).toBeNull();
    expect(selectComparison({ ...keyboard.result, naive: null })).toBeNull();
  });
});

describe("pipeline telemetry model", () => {
  it("names the running stage and counts finished stages while the solve runs", () => {
    const stage2Started = keyboard.events.findIndex(
      (event) => event.stage === "stage2" && event.state === "started",
    );
    expect(stage2Started).toBeGreaterThan(0);
    const eventCount = stage2Started + 1;
    const state = runningState(keyboard, eventCount);
    const telemetry = selectPipelineTelemetry(state);

    expect(telemetry.phase).toBe("running");
    expect(telemetry.activeStage).toBe("stage2");
    expect(telemetry.label).toBe("Stage 2: Building Swept-Ray DBG...");
    expect(telemetry.label).toBe(stageActivityLabel("stage2"));
    const completed = keyboard.events.slice(0, eventCount).filter((e) => e.state === "completed").length;
    expect(telemetry.fraction).toBeCloseTo((completed + 0.5) / STAGE_NAMES.length, 10);
    expect(telemetry.fraction).toBeGreaterThan(0);
    expect(telemetry.fraction).toBeLessThan(1);
    expect(telemetry.totalMs).toBeNull();
  });

  it("starts at zero with a neutral label before the first stage reports", () => {
    const telemetry = selectPipelineTelemetry(runningState(keyboard, 0));
    expect(telemetry.phase).toBe("running");
    expect(telemetry.activeStage).toBeNull();
    expect(telemetry.label).toBe("Starting solver...");
    expect(telemetry.fraction).toBe(0);
  });

  it("is idle before any solve", () => {
    expect(selectPipelineTelemetry(initialState).phase).toBe("idle");
  });

  it("reports the total and the duration of all seven stages once the solve is done", () => {
    const telemetry = selectPipelineTelemetry(loadedState(keyboard));
    expect(telemetry.phase).toBe("done");
    expect(telemetry.totalMs).toBe(keyboard.result.timings.totalMs);
    expect(telemetry.fraction).toBe(1);
    expect(telemetry.stages.map((entry) => entry.stage)).toEqual([...STAGE_NAMES]);
    for (const entry of telemetry.stages) {
      expect(entry.state).toBe("completed");
      expect(entry.durationMs).toBe(keyboard.result.timings.stageMs[entry.stage]);
    }
  });

  it("marks the stages that a deadlocked plan never runs as skipped", () => {
    const telemetry = selectPipelineTelemetry(loadedState(cage));
    const byStage = new Map(telemetry.stages.map((entry) => [entry.stage, entry]));
    for (const stage of ["stage4", "oracle"] as const) {
      expect(byStage.get(stage)?.state).toBe("skipped");
      expect(byStage.get(stage)?.durationMs).toBeNull();
    }
    expect(byStage.get("naive")?.state).toBe("completed");
  });

  it("formats durations for the pill and the stage rows", () => {
    expect(formatDuration(5123)).toBe("5.1s");
    expect(formatDuration(999.4)).toBe("999 ms");
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(null)).toBe("\u2013");
    expect(formatStageMs(3812.4)).toBe("3,812 ms");
    expect(formatStageMs(7)).toBe("7 ms");
    expect(formatStageMs(null)).toBe("\u2013");
  });
});
