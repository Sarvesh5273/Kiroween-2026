/**
 * Part 2 plug-in contract. A module listens to Game_Events through the bus and
 * reads state through `ModuleContext`. It never edits the reducer or the engine.
 *
 * Type-only imports: no DOM, React or Three.js module.
 */
import type { EngineState } from "../game/blitzEngine";
import type { GameEvent } from "../game/events";
import type { GameState } from "../game/gameState";

export interface ModuleContext {
  getState(): GameState;
  /** For hints: liveParts, clearAxes, unremovedBlockers, and so on. Null before a level loads. */
  engine(): EngineState | null;
}

export interface GameModule {
  id: string;
  onEvent(event: GameEvent, ctx: ModuleContext): void;
  dispose?(): void;
}
