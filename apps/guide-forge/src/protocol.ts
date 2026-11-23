/**
 * Shared message and data types that cross the Main_Thread / Solver_Worker boundary.
 *
 * This module holds no React import and no DOM type. Core types come in through
 * `import type` only, so nothing from Core is bundled by this file.
 */
import type {
  DisassemblyPlan,
  MoveVerification,
  NaiveBaselineResult,
  TrajectoryStep,
  Vec3,
} from "@unboltkit/core";

export const STAGE_NAMES = ["stage0", "stage1", "stage2", "stage3", "stage4", "oracle", "naive"] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export interface StageProgressEvent {
  stage: StageName;
  state: "started" | "completed";
  /** Milliseconds since the solve began. */
  elapsedMs: number;
  /** Duration of the stage. `null` on `started`. */
  durationMs: number | null;
}

/** Plain data for one surface. Colours are sRGB hex integers. */
export interface MaterialDescriptor {
  baseColor: number;
  metalness: number;
  roughness: number;
  transmission: number;
  opacity: number;
  emissive: number;
}

export interface ScenePayloadMesh {
  positions: Float32Array;
  normals: Float32Array | null;
  indices: Uint32Array | null;
  material: MaterialDescriptor;
}

/** Child order equals Object3D child order, so Core node paths match. No texture, image or DOM object. */
export interface ScenePayloadNode {
  name: string;
  position: Vec3;
  quaternion: [number, number, number, number];
  scale: Vec3;
  mesh: ScenePayloadMesh | null;
  children: ScenePayloadNode[];
}

export interface ScenePayload {
  root: ScenePayloadNode;
  meshCount: number;
}

export type SolveSource =
  | { kind: "kit"; kitName: string }
  | { kind: "scene"; fileName: string; scene: ScenePayload };

/** Label kept in app state. The payload is not kept. */
export type SolveLabel =
  | { kind: "kit"; kitName: string }
  | { kind: "file"; fileName: string }
  | { kind: "example"; name: "service-ring" };

export interface SolveRequestMessage {
  type: "solve";
  requestId: number;
  source: SolveSource;
}

export interface PartRenderData {
  partId: string;
  nodeName: string;
  nodePath: number[];
  /** Normalized coordinates (maxExtent 1.0). */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  material: MaterialDescriptor;
  /** OBB centre in normalized coordinates. Origin of the leader spline. */
  obbCenter: Vec3;
  aabb: { min: Vec3; max: Vec3 };
}

/**
 * Legacy ray clash counts, kept as a diagnostic. A count of zero is not evidence that a move is
 * clear: rays from vertices and centroids can miss a collision (crossed bars), and a hit beyond
 * the end of a move is not a collision of that move.
 */
export interface OracleReport {
  perStep: { partId: string; clashCount: number }[];
  totalClashes: number;
}

export interface SolveResult {
  plan: DisassemblyPlan;
  /** `null` unless the plan is solved and stage 4 returned ok. */
  trajectory: TrajectoryStep[] | null;
  /** `null` unless the plan is solved. */
  oracle: OracleReport | null;
  /** `null` when the plan is an error. */
  naive: NaiveBaselineResult | null;
  /** Empty when the plan is an error. */
  parts: PartRenderData[];
  timings: { totalMs: number; stageMs: Partial<Record<StageName, number>> };
}

export interface SolveFailure {
  name: string;
  code: string | null;
  message: string;
}

/**
 * One straight move to check, as the user chose it. Directions and distances are in model
 * coordinates: Stage 1 normalization only scales and translates, so a model axis is also a
 * normalized axis, and the worker multiplies `distance` by the normalization scale.
 */
export interface MoveCheckRequest {
  partId: string;
  /** Unit direction in model coordinates. */
  dir: Vec3;
  /** Travel in model units. Finite and greater than 0. */
  distance: number;
  /** Every Part present during the move other than `partId`, ascending by Part_ID. */
  staticPartIds: string[];
}
export interface CheckMoveMessage {
  type: "check";
  /** The solve whose Parts the move is about. */
  requestId: number;
  checkId: number;
  move: MoveCheckRequest;
}
export type WorkerInMessage = SolveRequestMessage | CheckMoveMessage;
export interface MoveCheckResult {
  /** The production `verifyLinearMove` result, in normalized units. */
  verification: MoveVerification;
  /** Time spent in the worker on this check. */
  elapsedMs: number;
}
export type WorkerOutMessage =
  | { type: "progress"; requestId: number; event: StageProgressEvent }
  | { type: "result"; requestId: number; result: SolveResult }
  | { type: "failure"; requestId: number; failure: SolveFailure }
  | { type: "checkResult"; requestId: number; checkId: number; result: MoveCheckResult }
  | { type: "checkFailure"; requestId: number; checkId: number; failure: SolveFailure };
