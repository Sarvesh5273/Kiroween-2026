/**
 * `AppController`: the composition root's logic, free of React and the DOM so it runs in Node tests.
 *
 * It owns the game store, the solver client and the engine dependencies. It turns level requests,
 * dropped or picked files, and worker answers into reducer actions:
 *
 *   LEVEL_REQUESTED, then LEVEL_LOADED | SOLVE_REJECTED | SOLVE_FAILED  (all with the same requestId)
 *
 * A part click goes through `clickPart`. With no attempt axis chosen it is the normal game
 * (`PART_CLICKED`). With an axis chosen it is an explicit attempt along exactly that axis; a straight
 * one is sent to the worker, which runs Core's `verifyLinearMove` on the move the Arena would play,
 * and the answer comes back as `EXPLICIT_ATTEMPT_CHECKED` with the attempt's id.
 *
 * An over-budget result is loaded like any other: the warning rides on `LoadedLevel.overBudget` and no
 * recovery screen is shown. Every load gets an epoch that no earlier load of this controller used.
 */
import { createEngineDeps } from "./engineDeps";
import { createEngineLevel } from "./game/blitzEngine";
import type { EngineDeps, ExplicitAxis } from "./game/blitzEngine";
import { deriveDisplayNames } from "./game/displayNames";
import { loadedLevelFromSolve } from "./game/gameState";
import type { GameAction, GameState, LevelRef, LoadedLevel } from "./game/gameState";
import { toEngineLevelInput } from "./game/levelData";
import { createGameStore } from "./game/store";
import type { GameStore } from "./game/store";
import { DEFAULT_LEVEL_ID, findBundledLevel } from "./levels";
import { GAME_MODULES } from "./modules/registry";
import type { GameModule, ModuleContext } from "./modules/types";
import type { BundledLevelId, SolveFailure, SolveResult, SolveSource, WorkerRejection } from "./protocol";
import type { RecoveryCause } from "./recovery/recoveryCause";
import { createSolverClient } from "./solver/solverClient";
import type { SolveHandlers, SolverClient } from "./solver/solverClient";
import { importFailureToRecoveryCause, importGltfFile } from "./upload/gltfImport";
import type { ImportResult } from "./upload/gltfImport";

export interface AppControllerOptions {
  /** Defaults to the real worker-backed client. Tests pass a fake. */
  solverClient?: SolverClient;
  /** Defaults to `importGltfFile`. */
  importFile?: (file: File) => Promise<ImportResult>;
  /** Defaults to `createEngineDeps()`. */
  engineDeps?: EngineDeps;
  /** Defaults to `GAME_MODULES`. */
  modules?: readonly GameModule[];
  /** Time source for the `at` field of actions. Defaults to `performance.now()`. */
  now?: () => number;
  /** An existing store, for tests that want to observe it. Defaults to a new store. */
  store?: GameStore;
}

export interface AppController {
  readonly store: GameStore;
  /** Loads the Lockbox when no level has been requested yet. Safe to call more than once. */
  start(): void;
  selectLevel(levelId: BundledLevelId): void;
  /** Imports a dropped or picked file, then solves it. Resolves when the file has been handled. */
  loadFile(file: File): Promise<void>;
  /** Same as `loadFile`. */
  handleFile(file: File): Promise<void>;
  /** Called by the "Load Lockbox" action of a recovery screen. */
  loadLockbox(): void;
  /** Registers the function that opens the hidden file input. Returns an unregister function. */
  bindFilePicker(open: () => void): () => void;
  /** Opens the file picker, when one is bound. */
  openFilePicker(): void;
  /** A click on a part in the Arena, at `at` on the `performance.now()` clock. */
  clickPart(partId: string, at: number): void;
  /** Chooses the axis for explicit attempts, or null for the normal game. */
  setAttemptAxis(axis: ExplicitAxis | null): void;
  flagTrap(): void;
  replay(): void;
  dismissRecovery(): void;
  /** Subscribes modules to the event bus. Returns an unsubscribe function. */
  registerModules(modules: readonly GameModule[]): () => void;
  dispose(): void;
}

function recoveryCauseFromRejection(rejection: WorkerRejection): RecoveryCause {
  if (rejection.reason === "monolithic") {
    return { reason: "monolithic", totalTriangles: rejection.totalTriangles };
  }
  return { reason: "no-geometry", detail: rejection.message };
}

function failureFromThrown(thrown: unknown): SolveFailure {
  if (thrown instanceof Error) return { name: thrown.name, code: null, message: thrown.message };
  return { name: "NonErrorThrown", code: null, message: String(thrown) };
}

export function createAppController(options: AppControllerOptions = {}): AppController {
  const store = options.store ?? createGameStore();
  const client = options.solverClient ?? createSolverClient();
  const importFile = options.importFile ?? ((file: File) => importGltfFile(file));
  const deps = options.engineDeps ?? createEngineDeps();
  const now = options.now ?? ((): number => performance.now());

  let disposed = false;
  let lastEpoch = 0;
  /** Highest request id this controller has seen from the client or issued itself. */
  let highestRequestId = 0;
  /** Increases on every load request, so a slower import of an older file is dropped. */
  let loadToken = 0;
  let openPicker: (() => void) | null = null;
  let attemptCounter = 0;
  const moduleUnsubscribers: Array<() => void> = [];
  const registeredModules: GameModule[] = [];

  /** Results that the client delivers before `solve` has returned its id wait here. */
  let early: Array<() => void> | null = null;
  const deliver = (action: () => void): void => {
    if (early !== null) early.push(action);
    else action();
  };

  function nextEpoch(): number {
    const state = store.getState();
    const currentEpoch = state.screen.kind === "level" ? state.screen.loaded.epoch : 0;
    lastEpoch = Math.max(lastEpoch, currentEpoch) + 1;
    return lastEpoch;
  }

  function isCurrent(requestId: number): boolean {
    return !disposed && store.getState().latestRequestId === requestId;
  }

  function onSolved(requestId: number, result: SolveResult, ref: LevelRef, label: string): void {
    if (!isCurrent(requestId)) return;
    try {
      const engineLevel = createEngineLevel(toEngineLevelInput(result), deps);
      const base = loadedLevelFromSolve(result, ref, label, nextEpoch());
      const displayNames = deriveDisplayNames(
        result.parts.map((part) => ({ partId: part.partId, nodeName: part.nodeName })),
      );
      const loaded: LoadedLevel = { ...base, displayNames };
      store.dispatch({ type: "LEVEL_LOADED", requestId, loaded, engineLevel, at: now() });
    } catch (thrown) {
      store.dispatch({ type: "SOLVE_FAILED", requestId, failure: failureFromThrown(thrown), at: now() });
    }
  }

  function onRejected(requestId: number, rejection: WorkerRejection): void {
    if (!isCurrent(requestId)) return;
    store.dispatch({
      type: "SOLVE_REJECTED",
      requestId,
      cause: recoveryCauseFromRejection(rejection),
      at: now(),
    });
  }

  function onFailure(requestId: number, failure: SolveFailure): void {
    if (!isCurrent(requestId)) return;
    store.dispatch({ type: "SOLVE_FAILED", requestId, failure, at: now() });
  }

  /** Starts a solve, dispatches LEVEL_REQUESTED with the client's id, then flushes early answers. */
  function startSolve(ref: LevelRef, label: string, source: SolveSource, transfer: Transferable[]): void {
    const handlers: SolveHandlers = {
      onSolved: (id, result) => deliver(() => onSolved(id, result, ref, label)),
      onRejected: (id, rejection) => deliver(() => onRejected(id, rejection)),
      onFailure: (id, failure) => deliver(() => onFailure(id, failure)),
    };

    early = [];
    let requestId: number;
    let queued: Array<() => void>;
    try {
      requestId = client.solve(source, transfer, handlers);
    } finally {
      queued = early;
      early = null;
    }
    highestRequestId = Math.max(highestRequestId, requestId);
    store.dispatch({ type: "LEVEL_REQUESTED", ref, label, requestId, at: now() });
    for (const action of queued) action();
  }

  /** Dispatches LEVEL_REQUESTED with an id that no pending solve can own, for work done before the solve. */
  function requestPlaceholder(ref: LevelRef, label: string): number {
    highestRequestId += 1;
    const requestId = highestRequestId;
    store.dispatch({ type: "LEVEL_REQUESTED", ref, label, requestId, at: now() });
    return requestId;
  }

  function selectLevel(levelId: BundledLevelId): void {
    if (disposed) return;
    const level = findBundledLevel(levelId);
    if (level === undefined) {
      const requestId = requestPlaceholder({ kind: "bundled", levelId }, String(levelId));
      store.dispatch({
        type: "SOLVE_FAILED",
        requestId,
        failure: { name: "UnknownLevel", code: null, message: `Unknown level: ${String(levelId)}.` },
        at: now(),
      });
      return;
    }
    loadToken += 1;
    startSolve({ kind: "bundled", levelId }, level.label, { kind: "bundled", levelId }, []);
  }

  async function loadFile(file: File): Promise<void> {
    if (disposed) return;
    loadToken += 1;
    const token = loadToken;
    const ref: LevelRef = { kind: "custom", fileName: file.name };
    const placeholderId = requestPlaceholder(ref, file.name);

    let imported: ImportResult;
    try {
      imported = await importFile(file);
    } catch (thrown) {
      if (disposed || token !== loadToken) return;
      store.dispatch({
        type: "SOLVE_REJECTED",
        requestId: placeholderId,
        cause: { reason: "unexpected", message: failureFromThrown(thrown).message },
        at: now(),
      });
      return;
    }
    // A newer request (level choice or another file) owns the screen now.
    if (disposed || token !== loadToken) return;

    if (!imported.ok) {
      store.dispatch({
        type: "SOLVE_REJECTED",
        requestId: placeholderId,
        cause: importFailureToRecoveryCause(imported.failure),
        at: now(),
      });
      return;
    }
    startSolve(ref, file.name, imported.source, imported.transfer);
  }

  function registerModules(modules: readonly GameModule[]): () => void {
    const ctx: ModuleContext = {
      getState: (): GameState => store.getState(),
      engine: () => store.getState().engine,
    };
    const unsubscribers = modules.map((module) => {
      registeredModules.push(module);
      return store.bus.subscribe((event) => module.onEvent(event, ctx));
    });
    const unsubscribeAll = (): void => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
    moduleUnsubscribers.push(unsubscribeAll);
    return unsubscribeAll;
  }

  function clickPart(partId: string, at: number): void {
    if (disposed) return;
    const axis = store.getState().attemptAxis;
    if (axis === null) {
      store.dispatch({ type: "PART_CLICKED", partId, at });
      return;
    }
    attemptCounter += 1;
    const attemptId = attemptCounter;
    store.dispatch({ type: "EXPLICIT_ATTEMPT", partId, axis, attemptId, at });
    const pending = store.getState().pendingAttempt;
    // A helical attempt, a rejected click or a click during another check sends nothing.
    if (pending === null || pending.attemptId !== attemptId) return;
    const { plan } = pending;
    const answer = (result: Parameters<typeof dispatchChecked>[1]): void => dispatchChecked(attemptId, result);
    const sent = client.checkMove(
      attemptId,
      { partId: plan.partId, dir: plan.dir, distance: plan.travel, staticPartIds: plan.staticPartIds },
      {
        onResult: (verification) =>
          answer({
            kind: "verdict",
            check: {
              verdict: verification.verdict,
              move: verification.move,
              blockerIds: verification.pairs.filter((pair) => pair.verdict === "blocked").map((pair) => pair.staticPartId),
            },
          }),
        onFailure: (failure) => answer({ kind: "error", message: failure.message }),
      },
    );
    if (!sent) answer({ kind: "error", message: "No solver worker is available for this level." });
  }

  function dispatchChecked(
    attemptId: number,
    result: Extract<GameAction, { type: "EXPLICIT_ATTEMPT_CHECKED" }>["result"],
  ): void {
    if (disposed) return;
    store.dispatch({ type: "EXPLICIT_ATTEMPT_CHECKED", attemptId, result, at: now() });
  }

  registerModules(options.modules ?? GAME_MODULES);

  return {
    store,

    start() {
      const state = store.getState();
      if (disposed || state.latestRequestId !== 0 || state.screen.kind !== "idle") return;
      selectLevel(DEFAULT_LEVEL_ID);
    },

    selectLevel,
    loadFile,
    handleFile: loadFile,

    loadLockbox() {
      selectLevel(DEFAULT_LEVEL_ID);
    },

    bindFilePicker(open) {
      openPicker = open;
      return () => {
        if (openPicker === open) openPicker = null;
      };
    },

    openFilePicker() {
      openPicker?.();
    },

    clickPart,
    setAttemptAxis(axis) {
      if (disposed) return;
      store.dispatch({ type: "ATTEMPT_AXIS_SET", axis, at: now() });
    },
    flagTrap() {
      if (disposed) return;
      store.dispatch({ type: "TRAP_FLAGGED", at: now() });
    },

    replay() {
      if (disposed) return;
      store.dispatch({ type: "REPLAY", at: now() });
    },

    dismissRecovery() {
      if (disposed) return;
      store.dispatch({ type: "RECOVERY_DISMISSED" });
    },

    registerModules,

    dispose() {
      if (disposed) return;
      disposed = true;
      loadToken += 1;
      for (const unsubscribe of moduleUnsubscribers) unsubscribe();
      moduleUnsubscribers.length = 0;
      for (const module of registeredModules) module.dispose?.();
      registeredModules.length = 0;
      openPicker = null;
      client.dispose();
    },
  };
}
