/**
 * "Check this move": the worker check, the staleness rules of the state, and the client queue.
 *
 * The service-ring files go through the same path as an upload: `GLTFLoader`, `objectToPayload`,
 * then `runSolve` on the scene payload. The move is one fixed choice (the service ring, +Y, 20
 * model units) in every case; only the model and the present Parts differ. These are Node unit
 * tests. The browser acceptance run is separate.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLinearMove, type Stage1Result } from "@unboltkit/core";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { CheckMoveMessage, MoveCheckRequest, SolveResult, WorkerOutMessage } from "../../src/protocol";
import { objectToPayload } from "../../src/scene/scenePayload";
import { createSolverClient } from "../../src/solver/solverClient";
import {
  selectCurrentMove,
  selectMoveCheckView,
  selectPresentParts,
} from "../../src/state/moveCheck";
import { initialState, rootReducer } from "../../src/state/reducer";
import type { AppAction, AppState } from "../../src/state/types";
import { MoveCheckRequestError, runMoveCheck, type MoveCheckContext } from "../../src/worker/moveCheck";
import { runSolve } from "../../src/worker/solvePipeline";

const PROBES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../demo-video/research/probes/service-ring");

interface Loaded {
  fileName: string;
  result: SolveResult;
  context: MoveCheckContext;
}

async function solveUpload(fileName: string, requestId: number): Promise<Loaded> {
  const bytes = readFileSync(resolve(PROBES, fileName));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const { transfer: _transfer, ...scene } = objectToPayload(gltf.scene);
  let stage1: Stage1Result | null = null;
  const result = runSolve(
    { type: "solve", requestId, source: { kind: "scene", fileName, scene } },
    { onStage1Ready: (prepared) => (stage1 = prepared) },
  );
  if (stage1 === null) throw new Error(`${fileName}: Stage 1 did not finish`);
  return { fileName, result, context: { requestId, stage1 } };
}

function reduce(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(rootReducer, state);
}

function loaded(run: Loaded): AppState {
  return reduce(
    initialState,
    { type: "solve/started", requestId: run.context.requestId, label: { kind: "file", fileName: run.fileName } },
    { type: "solve/succeeded", requestId: run.context.requestId, result: run.result },
  );
}

function partIdByName(run: Loaded, nodeName: string): string {
  const part = run.result.parts.find((entry) => entry.nodeName === nodeName);
  if (part === undefined) throw new Error(`${run.fileName}: no part named ${nodeName}`);
  return part.partId;
}

/** The one move every acceptance case uses: the service ring, +Y, 20 model units. */
function chooseRingPull(state: AppState, run: Loaded): AppState {
  return reduce(
    state,
    { type: "moveCheck/partSelected", partId: partIdByName(run, "service_ring") },
    { type: "moveCheck/directionSelected", direction: "+y" },
    { type: "moveCheck/distanceSet", text: "20" },
  );
}

/** Runs the current move through the worker function and feeds the answer back, as the app does. */
function checkCurrent(state: AppState, run: Loaded, checkId: number): AppState {
  const current = selectCurrentMove(state);
  if (!current.ok) throw new Error(current.reason);
  const message: CheckMoveMessage = { type: "check", requestId: run.context.requestId, checkId, move: current.request };
  const started = rootReducer(state, { type: "moveCheck/started", requestId: run.context.requestId, checkId, key: current.key });
  expect(selectMoveCheckView(started).status).toBe("checking");
  const result = runMoveCheck(run.context, message);
  return rootReducer(started, { type: "moveCheck/completed", requestId: run.context.requestId, checkId, result });
}

let integral: Loaded;
let removable: Loaded;

beforeAll(async () => {
  integral = await solveUpload("integral-cap.glb", 1);
  removable = await solveUpload("removable-cap.glb", 2);
});

describe("Check this move on the service-ring revisions (Node, upload payload path)", () => {
  it("prepares an editable move only for the bundled example; uploading the same model starts blank", () => {
    const requestId = removable.context.requestId;
    const start = reduce(initialState, { type: "solve/started", requestId, label: { kind: "example", name: "service-ring" } });
    const done = { type: "solve/succeeded", requestId, result: removable.result } as const;
    const example = rootReducer(start, done);
    expect(selectMoveCheckView(example).status).toBe("ready");
    expect(selectCurrentMove(example)).toMatchObject({ request: { partId: partIdByName(removable, "service_ring"), dir: [0, 1, 0], distance: 20 } });
    const edited = reduce(example, { type: "moveCheck/distanceSet", text: "4" });
    expect(rootReducer(edited, done).moveCheck.distanceText).toBe("4");
    const upload = reduce(edited, { type: "solve/started", requestId: requestId + 1, label: { kind: "file", fileName: "removable-cap.glb" } }, done,
      { ...done, requestId: requestId + 1 });
    expect(upload.moveCheck).toMatchObject({ partId: null, direction: null, distanceText: "", outcome: null });
  });

  it("integral cap: the plan is deadlocked, and the upward ring pull is Blocked by the spindle", () => {
    expect(integral.result.plan.status).toBe("deadlocked");
    const state = checkCurrent(chooseRingPull(loaded(integral), integral), integral, 1);
    const view = selectMoveCheckView(state);
    expect(view.status).toBe("blocked");
    expect(view.blockerNames).toEqual(["Spindle"]);
    expect(view.headline).toBe("Blocked by Spindle");
    expect(view.request?.dir).toEqual([0, 1, 0]);
    expect(view.request?.distance).toBe(20);
  });

  it("removable cap, cap still on: the same pull is Blocked by the cap, not by the spindle", () => {
    expect(removable.result.plan.status).toBe("solved");
    const state = checkCurrent(chooseRingPull(loaded(removable), removable), removable, 1);
    const view = selectMoveCheckView(state);
    expect(view.status).toBe("blocked");
    expect(view.blockerNames).toEqual(["Service cap"]);
    expect(view.present.map((part) => part.name).sort()).toEqual(["Service cap", "Service ring", "Spindle"]);
  });

  it("removable cap, after selecting the cap's step: the same pull is Clear and the spindle stays present", () => {
    const capId = partIdByName(removable, "service_cap");
    const plan = removable.result.plan;
    if (plan.status !== "solved") throw new Error("expected a solved plan");
    const capStep = plan.steps.findIndex((step) => step.partId === capId);
    expect(capStep).toBe(0);
    // The real app flow: choosing the cap's step row moves the timeline to the end of that step.
    const state = checkCurrent(
      reduce(chooseRingPull(loaded(removable), removable), { type: "view/stepSelected", index: capStep }),
      removable,
      1,
    );
    const view = selectMoveCheckView(state);
    expect(view.status).toBe("clear");
    expect(view.headline).toBe("Clear");
    expect(view.detail).toContain("The full guide is not verified.");
    expect(view.request?.staticPartIds).toEqual([partIdByName(removable, "spindle")]);
    expect(view.request?.dir).toEqual([0, 1, 0]);
    expect(view.request?.distance).toBe(20);
  });
});

describe("runMoveCheck sends exactly the requested move", () => {
  it("passes the chosen direction, the distance times the normalization scale and the given statics", () => {
    const calls: Parameters<typeof verifyLinearMove>[] = [];
    const recording: typeof verifyLinearMove = (...args) => {
      calls.push(args);
      return verifyLinearMove(...args);
    };
    const ring = partIdByName(removable, "service_ring");
    const spindle = partIdByName(removable, "spindle");
    const move: MoveCheckRequest = { partId: ring, dir: [0, 1, 0], distance: 20, staticPartIds: [spindle] };
    runMoveCheck(removable.context, { type: "check", requestId: 2, checkId: 1, move }, { verifyLinearMove: recording });
    expect(calls).toHaveLength(1);
    const [moving, dir, distance, statics] = calls[0] as Parameters<typeof verifyLinearMove>;
    expect(moving.partId).toBe(ring);
    expect(dir).toEqual([0, 1, 0]);
    expect(distance).toBe(20 * removable.context.stage1.normalization.scale);
    expect(statics.map((part) => part.partId)).toEqual([spindle]);
  });

  it("rejects a request for another solve, an unknown part, the mover as static, a repeat or a bad distance", () => {
    const ring = partIdByName(removable, "service_ring");
    const spindle = partIdByName(removable, "spindle");
    const base: MoveCheckRequest = { partId: ring, dir: [0, 1, 0], distance: 20, staticPartIds: [spindle] };
    const send = (requestId: number, move: MoveCheckRequest, context: MoveCheckContext | null = removable.context) =>
      () => runMoveCheck(context, { type: "check", requestId, checkId: 1, move });
    expect(send(2, base, null)).toThrow(MoveCheckRequestError);
    expect(send(1, base)).toThrow(MoveCheckRequestError);
    expect(send(2, { ...base, partId: "/nope" })).toThrow(MoveCheckRequestError);
    expect(send(2, { ...base, staticPartIds: ["/nope"] })).toThrow(MoveCheckRequestError);
    expect(send(2, { ...base, staticPartIds: [spindle, ring] })).toThrow(MoveCheckRequestError);
    expect(send(2, { ...base, staticPartIds: [spindle, spindle] })).toThrow(MoveCheckRequestError);
    for (const distance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(send(2, { ...base, distance })).toThrow(MoveCheckRequestError);
    }
  });
});

describe("stale verdicts are discarded", () => {
  function checkedRemovable(): AppState {
    return checkCurrent(chooseRingPull(loaded(removable), removable), removable, 1);
  }

  it.each<[string, () => AppAction]>([
    ["the distance", () => ({ type: "moveCheck/distanceSet", text: "21" })],
    ["the direction", () => ({ type: "moveCheck/directionSelected", direction: "-y" })],
    ["the part", () => ({ type: "moveCheck/partSelected", partId: partIdByName(removable, "service_cap") })],
    ["the present parts", () => ({ type: "view/stepSelected", index: 0 })],
    ["the model", () => ({ type: "solve/started", requestId: 3, label: { kind: "file", fileName: "other.glb" } })],
  ])("a change of %s drops the verdict", (_label, makeAction) => {
    const action = makeAction();
    const checked = checkedRemovable();
    expect(checked.moveCheck.outcome).not.toBeNull();
    const changed = rootReducer(checked, action);
    expect(changed.moveCheck.outcome).toBeNull();
    expect(selectMoveCheckView(changed).status).not.toBe("blocked");
  });

  it("a late answer for an earlier move does not overwrite the new selection", () => {
    const state = chooseRingPull(loaded(removable), removable);
    const first = selectCurrentMove(state);
    if (!first.ok) throw new Error(first.reason);
    const pendingFirst = rootReducer(state, { type: "moveCheck/started", requestId: 2, checkId: 1, key: first.key });
    // The user removes the cap while the first check is still running.
    const moved = rootReducer(pendingFirst, { type: "view/stepSelected", index: 0 });
    expect(moved.moveCheck.pending).toBeNull();
    const second = selectCurrentMove(moved);
    if (!second.ok) throw new Error(second.reason);
    const pendingSecond = rootReducer(moved, { type: "moveCheck/started", requestId: 2, checkId: 2, key: second.key });
    // The first (cap on, Blocked) answer arrives late.
    const lateResult = runMoveCheck(removable.context, { type: "check", requestId: 2, checkId: 1, move: first.request });
    expect(lateResult.verification.verdict).toBe("blocked");
    const afterLate = rootReducer(pendingSecond, { type: "moveCheck/completed", requestId: 2, checkId: 1, result: lateResult });
    expect(afterLate).toBe(pendingSecond);
    expect(selectMoveCheckView(afterLate).status).toBe("checking");
    // Going back to the first move later does not resurrect the late answer either.
    expect(afterLate.moveCheck.outcome).toBeNull();
  });

  it("an answer for an old solve is ignored", () => {
    const state = chooseRingPull(loaded(removable), removable);
    const current = selectCurrentMove(state);
    if (!current.ok) throw new Error(current.reason);
    const pending = rootReducer(state, { type: "moveCheck/started", requestId: 2, checkId: 7, key: current.key });
    const result = runMoveCheck(removable.context, { type: "check", requestId: 2, checkId: 7, move: current.request });
    expect(rootReducer(pending, { type: "moveCheck/completed", requestId: 1, checkId: 7, result })).toBe(pending);
  });
});

describe("present parts", () => {
  it("are every part for a deadlocked plan, and every part minus completed steps for a solved plan", () => {
    const dead = selectPresentParts(loaded(integral));
    expect(dead.ok && dead.partIds.length).toBe(integral.result.parts.length);
    const afterCap = selectPresentParts(reduce(loaded(removable), { type: "view/stepSelected", index: 0 }));
    expect(afterCap.ok && afterCap.removedPartIds).toEqual([partIdByName(removable, "service_cap")]);
  });

  it("are not claimed between two steps, and a removed part is not swapped for another", () => {
    const mid = reduce(loaded(removable), { type: "view/timelineSet", p: 0.5 });
    expect(selectPresentParts(mid).ok).toBe(false);
    const ringGone = reduce(chooseRingPull(loaded(removable), removable), { type: "view/stepSelected", index: 1 });
    const move = selectCurrentMove(ringGone);
    expect(move.ok).toBe(false);
    expect(ringGone.moveCheck.partId).toBe(partIdByName(removable, "service_ring"));
  });
});

describe("SolverClient move-check queue", () => {
  class FakeWorker {
    posted: unknown[] = [];
    onmessage: ((event: MessageEvent<WorkerOutMessage>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage(message: unknown): void {
      this.posted.push(message);
    }
    terminate(): void {}
    reply(message: WorkerOutMessage): void {
      this.onmessage?.({ data: message } as MessageEvent<WorkerOutMessage>);
    }
  }

  it("keeps one check in flight and replaces a waiting check with the newest one", () => {
    const actions: AppAction[] = [];
    const worker = new FakeWorker();
    const client = createSolverClient((action) => actions.push(action), () => worker as unknown as Worker);
    const requestId = client.solve({ kind: "kit", kitName: "x" }, { kind: "kit", kitName: "x" });
    const move: MoveCheckRequest = { partId: "a", dir: [0, 1, 0], distance: 1, staticPartIds: ["b"] };
    const first = client.checkMove(move, "k1");
    const second = client.checkMove({ ...move, distance: 2 }, "k2");
    const third = client.checkMove({ ...move, distance: 3 }, "k3");
    const checks = () => worker.posted.filter((message) => (message as { type: string }).type === "check") as CheckMoveMessage[];
    expect(checks().map((message) => message.checkId)).toEqual([first]);
    const result = { verification: { move: { partId: "a", dir: [0, 1, 0], distance: 1, presentPartIds: ["b"] }, verdict: "clear", pairs: [] }, elapsedMs: 1 } as const;
    worker.reply({ type: "checkResult", requestId, checkId: first as number, result: structuredClone(result) as never });
    expect(checks().map((message) => message.checkId)).toEqual([first, third]);
    expect(checks()[1]?.move.distance).toBe(3);
    expect(second).not.toBeNull();
    expect(actions.filter((action) => action.type === "moveCheck/started").map((action) => (action as { key: string }).key)).toEqual(["k1", "k2", "k3"]);
  });

  it("returns null before any solve", () => {
    const client = createSolverClient(() => undefined, () => new FakeWorker() as unknown as Worker);
    expect(client.checkMove({ partId: "a", dir: [0, 1, 0], distance: 1, staticPartIds: [] }, "k")).toBeNull();
  });
});

describe("opening a model does not run a full audit", () => {
  it("the solve pipeline never calls the move verifier", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/worker/solvePipeline.ts"), "utf8");
    expect(source).not.toMatch(/verifyLinearMove|verifyTrajectory/);
  });
});
