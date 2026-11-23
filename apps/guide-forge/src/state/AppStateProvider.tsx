/**
 * AppStateProvider: React Context plus `useReducer(rootReducer, initialState)` (Requirements 4.1, 4.7).
 *
 * This is the only file under `src/state/` that imports React. It also owns the browser-side effects
 * that feed the reducer:
 * - the `SolverClient`, created inside an effect and disposed on unmount, so React StrictMode's
 *   double mount creates, disposes and re-creates it without leaking a worker (Requirements 5.11, 6.4);
 * - the first solve of `mechanical-keyboard-65`, started without user input (Requirement 6.4);
 * - the `prefers-reduced-motion: reduce` listener, dispatched once for the initial value and again
 *   on every change (Requirement 11.10);
 * - the `requestAnimationFrame` loop that runs only while `view.playing` and dispatches `view/tick`
 *   (Requirement 11.8).
 *
 * Components read state through `useAppState`, change it only through `useAppDispatch` actions
 * (Requirement 4.7) and start solves and move checks through `useSolver`.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { DEFAULT_KIT_NAME, type KitName } from "../kits";
import type { MoveCheckRequest, SolveFailure, SolveLabel } from "../protocol";
import { createSolverClient, type SolverClient } from "../solver/solverClient";
import { importGltfFile } from "../upload/gltfImport";
import { initialState, rootReducer } from "./reducer";
import { buildFailureCard } from "./recovery";
import type { AppAction, AppState } from "./types";

/** Media query that reports the operating system's reduced-motion preference. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Longest delta, in seconds, that one animation frame may add to the timeline. A background tab
 * pauses `requestAnimationFrame`, and the first frame after it would otherwise jump the playback.
 */
export const MAX_TICK_SECONDS = 0.1;

export interface SolverApi {
  /** Starts a solve of one bundled kit. Supersedes any running solve. */
  solveKit(name: KitName): void;
  /**
   * Imports a `.glb` or `.gltf` file on the Main_Thread. A usable scene starts a solve with its
   * buffers transferred. Any other outcome raises a Recovery_Card and posts no Solve_Request.
   */
  solveFile(file: File): Promise<void>;
  openRingExample(): Promise<void>;
  /** Checks one move on the current solve's Parts in the Solver_Worker ("Check this move"). */
  checkMove(move: MoveCheckRequest, key: string): void;
}

const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<AppAction> | null>(null);
const SolverContext = createContext<SolverApi | null>(null);

function kitLabel(name: string): SolveLabel {
  return { kind: "kit", kitName: name };
}

function failureFromThrown(thrown: unknown): SolveFailure {
  if (thrown instanceof Error) {
    return { name: thrown.name, code: null, message: thrown.message };
  }
  return { name: "NonErrorThrown", code: null, message: String(thrown) };
}

/** Subscribes to the reduced-motion media query. Returns an unsubscribe function. */
function watchReducedMotion(dispatch: Dispatch<AppAction>): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  dispatch({ type: "env/reducedMotionChanged", reduced: query.matches });
  const onChange = (event: MediaQueryListEvent): void => {
    dispatch({ type: "env/reducedMotionChanged", reduced: event.matches });
  };
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Runs the animation-frame loop while `playing` is true. Returns a cancel function. */
function startPlaybackLoop(dispatch: Dispatch<AppAction>): () => void {
  let handle = 0;
  let last = performance.now();
  const frame = (now: number): void => {
    const deltaSeconds = Math.min(MAX_TICK_SECONDS, Math.max(0, (now - last) / 1000));
    last = now;
    if (deltaSeconds > 0) {
      dispatch({ type: "view/tick", deltaSeconds });
    }
    handle = requestAnimationFrame(frame);
  };
  handle = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(handle);
}

function makeSolverApi(
  clientRef: RefObject<SolverClient | null>,
  dispatch: Dispatch<AppAction>,
): SolverApi {
  // An upload, example, or kit selected while a file is loading always wins.
  let latestLoad = 0;
  async function importSource(
    load: number, owner: SolverClient, readFile: () => Promise<File>, label?: SolveLabel,
  ): Promise<void> {
    const current = () => latestLoad === load && clientRef.current === owner;
    try {
      const file = await readFile();
      if (!current()) return;
      const outcome = await importGltfFile(file);
      if (!current()) return;
      if (outcome.ok) owner.solve(outcome.source, label ?? outcome.label, outcome.transfer);
      else dispatch({ type: "recovery/raised", card: outcome.card });
    } catch (thrown) {
      if (current()) dispatch({ type: "recovery/raised", card: buildFailureCard(failureFromThrown(thrown)) });
    }
  }
  return {
    solveKit(name) {
      latestLoad++;
      clientRef.current?.solve({ kind: "kit", kitName: name }, kitLabel(name));
    },
    async solveFile(file) {
      const owner = clientRef.current;
      if (owner) await importSource(++latestLoad, owner, async () => file);
    },
    async openRingExample() {
      const owner = clientRef.current;
      if (!owner) return;
      await importSource(++latestLoad, owner, async () => {
        const response = await fetch(new URL("../examples/removable-cap.glb", import.meta.url));
        if (!response.ok) throw new Error("The ring example could not be loaded. Try opening the example again.");
        return new File([await response.blob()], "removable-cap.glb");
      }, { kind: "example", name: "service-ring" });
    },
    checkMove(move, key) {
      clientRef.current?.checkMove(move, key);
    },
  };
}

export function AppStateProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, dispatch] = useReducer(rootReducer, initialState);
  const clientRef = useRef<SolverClient | null>(null);

  // Worker lifecycle and the first solve. Created in the effect so StrictMode's mount, cleanup and
  // second mount never leave two live clients.
  useEffect(() => {
    const client = createSolverClient(dispatch);
    clientRef.current = client;
    client.solve({ kind: "kit", kitName: DEFAULT_KIT_NAME }, kitLabel(DEFAULT_KIT_NAME));
    return () => {
      client.dispose();
      if (clientRef.current === client) {
        clientRef.current = null;
      }
    };
  }, []);

  useEffect(() => watchReducedMotion(dispatch), []);

  const playing = state.view.playing;
  useEffect(() => {
    if (!playing) return undefined;
    return startPlaybackLoop(dispatch);
  }, [playing]);

  const solver = useMemo(() => makeSolverApi(clientRef, dispatch), []);

  return (
    <DispatchContext.Provider value={dispatch}>
      <SolverContext.Provider value={solver}>
        <StateContext.Provider value={state}>{children}</StateContext.Provider>
      </SolverContext.Provider>
    </DispatchContext.Provider>
  );
}

function useRequiredContext<T>(value: T | null, hookName: string): T {
  if (value === null) {
    throw new Error(`${hookName} must be used inside <AppStateProvider>.`);
  }
  return value;
}

/** The current App_State. */
export function useAppState(): AppState {
  return useRequiredContext(useContext(StateContext), "useAppState");
}

/** The App_Action dispatcher. Its identity never changes. */
export function useAppDispatch(): Dispatch<AppAction> {
  return useRequiredContext(useContext(DispatchContext), "useAppDispatch");
}

/** `solveKit` and `solveFile`. The returned object keeps one identity for the provider's lifetime. */
export function useSolver(): SolverApi {
  return useRequiredContext(useContext(SolverContext), "useSolver");
}
