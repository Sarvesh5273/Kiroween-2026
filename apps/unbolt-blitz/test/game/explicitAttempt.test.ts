/**
 * Explicit attempts on the real game path: `AppController.loadFile` with the real glTF import,
 * the real `SolverClient`, and the real worker handler (Core stages 0 to 4 and Core's production
 * `verifyLinearMove`). Only the thread boundary is simulated: `InProcessWorker` runs the handler on
 * a later macrotask and structured-clones every message, as `postMessage` does. It can hold check
 * answers back, so late answers can be delivered after a replay or a level change.
 *
 * Every case clicks a part with an axis chosen through `setAttemptAxis`. Nothing here names a part
 * id; parts are found by their node names in the uploaded files.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLinearMove, type MoveVerification } from "@unboltkit/core";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createAppController, type AppController } from "../../src/appController";
import { EXIT_TRAVEL_FLOOR } from "../../src/game/scoring";
import { planExplicitAttempt, resolveExplicitStraight, type ExplicitAxis } from "../../src/game/blitzEngine";
import type { GameEvent } from "../../src/game/events";
import type { GameState } from "../../src/game/gameState";
import { axisLabel, describeEvent } from "../../src/hud/hudModel";
import type { WorkerInMessage, WorkerOutMessage } from "../../src/protocol";
import { createSolverClient, type WorkerLike } from "../../src/solver/solverClient";
import { applyEventToArena, type BridgedArena } from "../../src/viewport/arenaBridge";
import { createWorkerHandler, type WorkerHandlerDeps } from "../../src/worker/workerHandler";

const PROBES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../demo-video/research/probes");
const PLUS_X: ExplicitAxis = 0;
const PLUS_Y: ExplicitAxis = 2;

class InProcessWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<WorkerOutMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  holdChecks = false;
  readonly held: WorkerOutMessage[] = [];
  readonly checksReceived: WorkerInMessage[] = [];
  private readonly handle: (message: WorkerInMessage) => void;

  constructor(overrides: Partial<WorkerHandlerDeps>) {
    this.handle = createWorkerHandler((message) => this.send(message), overrides);
  }

  postMessage(message: unknown): void {
    if (this.terminated) return;
    const copy = structuredClone(message) as WorkerInMessage;
    if (copy.type === "check") this.checksReceived.push(copy);
    setTimeout(() => {
      if (!this.terminated) this.handle(copy);
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Delivers every held check answer now, to whatever handler the client has attached. */
  releaseHeld(): void {
    for (const message of this.held.splice(0)) this.onmessage?.({ data: message } as MessageEvent<WorkerOutMessage>);
  }

  private send(message: WorkerOutMessage): void {
    const copy = structuredClone(message);
    if (this.holdChecks && (copy.type === "checkResult" || copy.type === "checkFailure")) {
      this.held.push(copy);
      return;
    }
    setTimeout(() => {
      if (!this.terminated) this.onmessage?.({ data: copy } as MessageEvent<WorkerOutMessage>);
    }, 0);
  }
}

interface Harness {
  controller: AppController;
  workers: InProcessWorker[];
  events: GameEvent[];
  state: () => GameState;
}

function harness(overrides: Partial<WorkerHandlerDeps> = {}): Harness {
  const workers: InProcessWorker[] = [];
  const client = createSolverClient(() => {
    const worker = new InProcessWorker(overrides);
    workers.push(worker);
    return worker;
  });
  const controller = createAppController({ solverClient: client, modules: [] });
  const events: GameEvent[] = [];
  controller.store.bus.subscribe((event) => events.push(event));
  return { controller, workers, events, state: () => controller.store.getState() };
}

async function upload(h: Harness, fileName: string): Promise<void> {
  const bytes = readFileSync(resolve(PROBES, fileName));
  await h.controller.loadFile(new File([bytes], fileName.split("/").pop() as string));
  await vi.waitFor(() => expect(h.state().screen.kind).toBe("level"), { timeout: 60_000, interval: 5 });
}

function partId(h: Harness, nodeName: string): string {
  const screen = h.state().screen;
  if (screen.kind !== "level") throw new Error("no level");
  const part = screen.loaded.parts.find((entry) => entry.nodeName === nodeName);
  if (part === undefined) throw new Error(`no part named ${nodeName}`);
  return part.partId;
}

/** Candidate axis `axis` of part `id`, from the solve's render data. */
function candidateAxis(h: Harness, id: string, axis: number): readonly number[] | undefined {
  const screen = h.state().screen;
  if (screen.kind !== "level") return undefined;
  return screen.loaded.parts.find((part) => part.partId === id)?.candidateAxes[axis];
}

function nameOf(h: Harness, id: string): string {
  const screen = h.state().screen;
  return screen.kind === "level" ? (screen.loaded.displayNames.get(id) ?? id) : id;
}

function normalizationScale(h: Harness): number {
  const screen = h.state().screen;
  if (screen.kind !== "level") throw new Error("no level");
  return screen.loaded.plan.normalization.scale;
}

async function settled(h: Harness): Promise<void> {
  await vi.waitFor(() => expect(h.state().pendingAttempt).toBeNull(), { timeout: 60_000, interval: 5 });
}

interface Row {
  case: string;
  part: string;
  axis: string;
  primitive: string;
  travelNormalized: number;
  travelModelUnits: number;
  outcome: string;
  blockers: string;
  scoreBefore: number;
  scoreAfter: number;
  mistakesAfter: number;
}
const report: Row[] = [];

/** One explicit attempt through `clickPart`, reported with what the game actually did. */
async function attempt(h: Harness, label: string, nodeName: string, axis: ExplicitAxis): Promise<{ row: Row; outcome: GameEvent }> {
  h.controller.setAttemptAxis(axis);
  const id = partId(h, nodeName);
  const scoreBefore = h.state().engine?.score ?? 0;
  const before = h.events.length;
  h.controller.clickPart(id, performance.now());
  const pending = h.state().pendingAttempt;
  expect(pending, `${label}: a straight attempt waits for its check`).not.toBeNull();
  if (pending === null) throw new Error("no pending attempt");
  const { plan } = pending;
  // The move sent is the move the Arena would play: the chosen axis, max(escape, floor), all live parts.
  expect(plan.dir).toEqual(candidateAxis(h, id, axis));
  expect(plan.step.primitive).toBe("linear_slide");
  expect(plan.travel).toBe(Math.max(plan.escapeDistance, EXIT_TRAVEL_FLOOR));
  expect(plan.step.params).toEqual({ kind: "linear_slide", dir: plan.dir, distance: plan.travel });
  await settled(h);
  const produced = h.events.slice(before);
  const outcome = produced.find((e) => e.kind === "part_removed" || e.kind === "part_blocked" || e.kind === "attempt_unresolved");
  if (outcome === undefined) throw new Error(`${label}: no outcome event`);
  const row: Row = {
    case: label,
    part: nameOf(h, id),
    axis: axisLabel(axis),
    primitive: plan.step.primitive,
    travelNormalized: plan.travel,
    travelModelUnits: plan.travel / normalizationScale(h),
    outcome: outcome.kind === "attempt_unresolved" ? `unresolved (${outcome.reason})` : outcome.kind,
    blockers: outcome.kind === "part_blocked" ? outcome.blockerIds.map((b) => nameOf(h, b)).join(", ") : "",
    scoreBefore,
    scoreAfter: h.state().engine?.score ?? 0,
    mistakesAfter: h.state().engine?.mistakes ?? 0,
  };
  report.push(row);
  return { row, outcome };
}

afterAll(() => {
  console.log(`EXPLICIT_ATTEMPT_REPORT ${JSON.stringify(report)}`);
});

describe("explicit attempts on the service-ring revisions", () => {
  it("removable cap: ring +Y is Blocked by Service cap; after the cap comes off +Y, ring +Y is Clear with Spindle present", async () => {
    const h = harness();
    await upload(h, "service-ring/removable-cap.glb");
    const ringId = partId(h, "service_ring");
    const capId = partId(h, "service_cap");
    const spindleId = partId(h, "spindle");

    const first = await attempt(h, "removable cap, cap on: ring +Y", "service_ring", PLUS_Y);
    expect(first.outcome.kind).toBe("part_blocked");
    if (first.outcome.kind !== "part_blocked") return;
    expect(first.outcome.basis).toBe("checked_straight");
    expect(first.outcome.blockerIds).toEqual([capId]);
    expect(first.row.blockers).toBe("Service Cap");
    expect(first.row.scoreAfter).toBe(first.row.scoreBefore);
    expect(h.state().engine?.removed.has(ringId)).toBe(false);

    const cap = await attempt(h, "removable cap: cap +Y", "service_cap", PLUS_Y);
    expect(cap.outcome.kind).toBe("part_removed");
    expect(h.state().engine?.removed.has(capId)).toBe(true);

    const ring = await attempt(h, "removable cap, cap removed: ring +Y", "service_ring", PLUS_Y);
    expect(ring.outcome.kind).toBe("part_removed");
    if (ring.outcome.kind !== "part_removed") return;
    expect(ring.outcome.basis).toBe("checked_straight");
    expect(ring.outcome.step.params).toMatchObject({ kind: "linear_slide", dir: [0, 1, 0] });
    expect(ring.row.scoreAfter).toBeGreaterThan(ring.row.scoreBefore);
    expect(h.state().engine?.removed.has(spindleId)).toBe(false);
    // The check covered exactly the move that was played, against Spindle only.
    const lastCheck = h.workers[0]?.checksReceived.at(-1);
    expect(lastCheck).toMatchObject({ type: "check", move: { partId: ringId, staticPartIds: [spindleId] } });
  });

  it("integral cap: ring +Y is Blocked by Spindle", async () => {
    const h = harness();
    await upload(h, "service-ring/integral-cap.glb");
    const spindleId = partId(h, "spindle");
    const result = await attempt(h, "integral cap: ring +Y", "service_ring", PLUS_Y);
    expect(result.outcome.kind).toBe("part_blocked");
    if (result.outcome.kind !== "part_blocked") return;
    expect(result.outcome.blockerIds).toEqual([spindleId]);
    expect(result.row.blockers).toBe("Spindle");
    expect(result.row.scoreAfter).toBe(result.row.scoreBefore);
  });
});

describe("explicit attempt on crossed bars", () => {
  it("the requested +X slide of Y_bar is Blocked by Z_bar, so it neither scores nor animates", async () => {
    const h = harness();
    await upload(h, "crossed-bars.glb");
    const yBar = partId(h, "Y_bar");
    const zBar = partId(h, "Z_bar");
    const result = await attempt(h, "crossed bars: Y_bar +X", "Y_bar", PLUS_X);
    expect(result.outcome.kind).toBe("part_blocked");
    if (result.outcome.kind !== "part_blocked") return;
    expect(result.outcome.blockerIds).toEqual([zBar]);
    expect(result.row.scoreAfter).toBe(0);
    expect(h.state().engine?.removed.has(yBar)).toBe(false);
    // No part_removed event: the Arena's exit animation is driven only by that event.
    expect(h.events.filter((e) => e.kind === "part_removed")).toEqual([]);
    // The played travel really reaches Z_bar: the floor makes it longer than the AABB escape.
    expect(result.row.travelNormalized).toBe(EXIT_TRAVEL_FLOOR);
  });
});

describe("double clicks, late answers and unverified checks", () => {
  it("a second click while the first attempt is being checked is rejected, and the part scores once", async () => {
    const h = harness();
    await upload(h, "service-ring/removable-cap.glb");
    h.controller.setAttemptAxis(PLUS_Y);
    const capId = partId(h, "service_cap");
    h.controller.clickPart(capId, performance.now());
    h.controller.clickPart(capId, performance.now());
    expect(h.events.at(-1)).toMatchObject({ kind: "click_rejected", reason: "attempt_pending" });
    await settled(h);
    expect(h.workers[0]?.checksReceived).toHaveLength(1);
    expect(h.events.filter((e) => e.kind === "part_removed")).toHaveLength(1);
    const scored = h.state().engine?.score;
    // A third click after removal is a normal rejection for a part that is gone.
    h.controller.clickPart(capId, performance.now());
    expect(h.events.at(-1)).toMatchObject({ kind: "click_rejected", reason: "not_live" });
    expect(h.state().engine?.score).toBe(scored);
  });

  it("an answer that arrives after a replay is ignored", async () => {
    const h = harness();
    await upload(h, "service-ring/removable-cap.glb");
    const worker = h.workers[0] as InProcessWorker;
    worker.holdChecks = true;
    h.controller.setAttemptAxis(PLUS_Y);
    const capId = partId(h, "service_cap");
    h.controller.clickPart(capId, performance.now());
    await vi.waitFor(() => expect(worker.held).toHaveLength(1), { timeout: 60_000, interval: 5 });
    h.controller.replay();
    expect(h.state().pendingAttempt).toBeNull();
    const before = h.state();
    worker.releaseHeld();
    expect(h.state()).toBe(before);
    expect(h.state().engine?.removed.size).toBe(0);
    expect(h.state().engine?.score).toBe(0);
  });

  it("an answer for the previous level is ignored after a level change", async () => {
    const h = harness();
    await upload(h, "service-ring/removable-cap.glb");
    const first = h.workers[0] as InProcessWorker;
    first.holdChecks = true;
    h.controller.setAttemptAxis(PLUS_Y);
    h.controller.clickPart(partId(h, "service_cap"), performance.now());
    await vi.waitFor(() => expect(first.held).toHaveLength(1), { timeout: 60_000, interval: 5 });
    const oldAttemptId = (first.held[0] as { attemptId: number }).attemptId;
    await upload(h, "service-ring/integral-cap.glb");
    expect(first.terminated).toBe(true);
    const before = h.state();
    // The client detached the old worker, so a stray message reaches no handler.
    first.releaseHeld();
    // And the reducer ignores the old attempt id even if an answer were dispatched directly.
    h.controller.store.dispatch({
      type: "EXPLICIT_ATTEMPT_CHECKED",
      attemptId: oldAttemptId,
      result: { kind: "verdict", check: { verdict: "clear", move: { partId: "x", dir: [0, 1, 0], distance: 1, presentPartIds: [] }, blockerIds: [] } },
      at: performance.now(),
    });
    expect(h.state()).toBe(before);
    expect(h.state().engine?.score).toBe(0);
  });

  it("an Unverified check removes nothing, scores nothing and is not a mistake", async () => {
    const unverified: typeof verifyLinearMove = (...args) => {
      const real: MoveVerification = verifyLinearMove(...args);
      return { ...real, verdict: "unverified", pairs: real.pairs.map((pair) => ({ ...pair, verdict: "unverified", reason: "contact_unresolved", evidence: {} })) };
    };
    const h = harness({ verifyLinearMove: unverified });
    await upload(h, "service-ring/removable-cap.glb");
    const result = await attempt(h, "forced unverified: cap +Y", "service_cap", PLUS_Y);
    expect(result.outcome).toMatchObject({ kind: "attempt_unresolved", reason: "unverified" });
    expect(h.state().engine).toMatchObject({ score: 0, mistakes: 0, combo: 1 });
    expect(h.state().engine?.removed.size).toBe(0);
  });

  it("a worker error removes nothing, scores nothing and is not a mistake", async () => {
    const failing: typeof verifyLinearMove = () => {
      throw new Error("simulated verifier failure");
    };
    const h = harness({ verifyLinearMove: failing });
    await upload(h, "service-ring/removable-cap.glb");
    const result = await attempt(h, "forced error: cap +Y", "service_cap", PLUS_Y);
    expect(result.outcome).toMatchObject({ kind: "attempt_unresolved", reason: "error" });
    expect(h.state().engine).toMatchObject({ score: 0, mistakes: 0 });
  });

  it("a verdict about a different move (other travel, direction or static set) is stale and changes nothing", async () => {
    const h = harness();
    await upload(h, "service-ring/removable-cap.glb");
    const engine = h.state().engine;
    if (engine === null) throw new Error("no engine");
    const plan = planExplicitAttempt(engine, partId(h, "service_cap"), PLUS_Y);
    if (plan.kind !== "straight") throw new Error("expected a straight plan");
    const move = { partId: plan.partId, dir: plan.dir, distance: plan.travel, presentPartIds: plan.staticPartIds };
    const clear = (changed: Partial<typeof move>) => ({ verdict: "clear" as const, move: { ...move, ...changed }, blockerIds: [] });
    expect(resolveExplicitStraight(engine, plan, clear({ distance: plan.travel / 2 }))).toEqual({ kind: "unresolved", reason: "stale" });
    expect(resolveExplicitStraight(engine, plan, clear({ dir: [1, 0, 0] }))).toEqual({ kind: "unresolved", reason: "stale" });
    expect(resolveExplicitStraight(engine, plan, clear({ presentPartIds: plan.staticPartIds.slice(1) }))).toEqual({ kind: "unresolved", reason: "stale" });
    const exact = resolveExplicitStraight(engine, plan, clear({}));
    expect(exact.kind).toBe("removed");
  });

  it("a helical explicit attempt keeps the blocking-graph rule, sends no check and is not described as checked", async () => {
    const h = harness();
    await upload(h, "crossed-bars.glb");
    h.controller.setAttemptAxis(PLUS_Y);
    const yBar = partId(h, "Y_bar");
    h.controller.clickPart(yBar, performance.now());
    expect(h.state().pendingAttempt).toBeNull();
    const last = h.events.at(-1);
    expect(last).toMatchObject({ kind: "part_removed", basis: "blocking_graph", axisIndex: PLUS_Y, step: { primitive: "helical_unscrew" } });
    expect(h.workers[0]?.checksReceived).toHaveLength(0);
    const screen = h.state().screen;
    if (last === undefined || screen.kind !== "level") throw new Error("no event");
    const text = describeEvent(last, screen.loaded.displayNames);
    expect(text).not.toMatch(/check|verif/i);
  });

  it("Auto keeps the normal game: a click is decided at once and sends no check", async () => {
    const h = harness();
    await upload(h, "service-ring/removable-cap.glb");
    h.controller.setAttemptAxis(null);
    h.controller.clickPart(partId(h, "service_cap"), performance.now());
    expect(h.state().pendingAttempt).toBeNull();
    expect(h.events.at(-1)).toMatchObject({ kind: "part_removed", basis: "blocking_graph" });
    expect(h.workers[0]?.checksReceived).toHaveLength(0);
  });
});

describe("changing the attempt axis while a check is pending (release patch regression)", () => {
  /** Arena calls made by the real bridge, so animation and shudder can be counted. */
  function recordArena(h: Harness): { removed: string[]; blocked: string[] } {
    const calls = { removed: [] as string[], blocked: [] as string[] };
    const arena: BridgedArena = {
      loadParts: () => undefined,
      clear: () => undefined,
      removePart: (id) => void calls.removed.push(id),
      blockPart: (id) => void calls.blocked.push(id),
      showInterlock: () => undefined,
    };
    h.controller.store.bus.subscribe((event) => applyEventToArena(arena, h.controller.store, event));
    return calls;
  }

  /** Uploads removable-cap.glb and starts a +Y attempt on Service Cap whose reply is held. */
  async function heldCapAttempt(): Promise<{ h: Harness; worker: InProcessWorker; capId: string; arena: ReturnType<typeof recordArena> }> {
    const h = harness();
    await upload(h, "service-ring/removable-cap.glb");
    const arena = recordArena(h);
    const worker = h.workers[0] as InProcessWorker;
    worker.holdChecks = true;
    h.controller.setAttemptAxis(PLUS_Y);
    const capId = partId(h, "service_cap");
    h.controller.clickPart(capId, performance.now());
    expect(h.state().pendingAttempt?.plan.partId).toBe(capId);
    await vi.waitFor(() => expect(worker.held).toHaveLength(1), { timeout: 60_000, interval: 5 });
    return { h, worker, capId, arena };
  }

  function expectUntouched(h: Harness, arena: ReturnType<typeof recordArena>): void {
    expect(h.state().engine).toMatchObject({ score: 0, combo: 1, mistakes: 0, penaltyMs: 0 });
    expect(h.state().engine?.removed.size).toBe(0);
    expect(h.events.filter((e) => e.kind === "part_removed" || e.kind === "part_blocked")).toEqual([]);
    expect(arena.removed).toEqual([]);
    expect(arena.blocked).toEqual([]);
  }

  /** A fresh +Y attempt on the cap, answered normally, scores exactly once. */
  async function freshAttemptScoresOnce(h: Harness, worker: InProcessWorker, capId: string, arena: ReturnType<typeof recordArena>): Promise<void> {
    worker.holdChecks = false;
    h.controller.setAttemptAxis(PLUS_Y);
    h.controller.clickPart(capId, performance.now());
    expect(h.state().pendingAttempt).not.toBeNull();
    await settled(h);
    expect(h.events.filter((e) => e.kind === "part_removed")).toHaveLength(1);
    expect(h.state().engine?.score).toBe(100);
    expect(h.state().engine?.removed.has(capId)).toBe(true);
    expect(arena.removed).toEqual([capId]);
  }

  it.each<[string, ExplicitAxis | null]>([
    ["+Y to +X", PLUS_X],
    ["+Y to Auto", null],
  ])("%s cancels the attempt at once, and the held +Y reply changes nothing", async (_label, nextAxis) => {
    const { h, worker, capId, arena } = await heldCapAttempt();
    h.controller.setAttemptAxis(nextAxis);
    expect(h.state().pendingAttempt).toBeNull();
    expect(h.events.at(-1)).toMatchObject({ kind: "attempt_unresolved", reason: "cancelled", partId: capId, axisIndex: PLUS_Y });
    const before = h.state();
    worker.releaseHeld();
    expect(h.state()).toBe(before);
    expectUntouched(h, arena);
    await freshAttemptScoresOnce(h, worker, capId, arena);
  });

  it("choosing the axis that is already selected does not cancel the attempt", async () => {
    const { h, worker, capId, arena } = await heldCapAttempt();
    h.controller.setAttemptAxis(PLUS_Y);
    expect(h.state().pendingAttempt?.plan.partId).toBe(capId);
    worker.releaseHeld();
    await settled(h);
    expect(h.events.filter((e) => e.kind === "part_removed")).toHaveLength(1);
    expect(h.state().engine?.score).toBe(100);
    expect(arena.removed).toEqual([capId]);
  });

  it("the cancelled reply does not interfere with a newer attempt that is still pending", async () => {
    const { h, worker, capId, arena } = await heldCapAttempt();
    h.controller.setAttemptAxis(PLUS_X);
    h.controller.setAttemptAxis(PLUS_Y);
    h.controller.clickPart(capId, performance.now());
    const newer = h.state().pendingAttempt;
    expect(newer).not.toBeNull();
    await vi.waitFor(() => expect(worker.held).toHaveLength(2), { timeout: 60_000, interval: 5 });
    // Both replies arrive, the cancelled one first.
    worker.releaseHeld();
    await settled(h);
    expect(h.events.filter((e) => e.kind === "part_removed")).toHaveLength(1);
    expect(h.events.filter((e) => e.kind === "attempt_unresolved").map((e) => (e as { reason: string }).reason)).toEqual(["cancelled"]);
    expect(h.state().engine).toMatchObject({ score: 100, mistakes: 0, combo: 2 });
    expect(arena.removed).toEqual([capId]);
  });
});
