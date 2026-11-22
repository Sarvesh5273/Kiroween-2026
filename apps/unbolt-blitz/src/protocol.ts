import type { DeadlockedPlan, SolvedPlan, TrajectoryStep, Vec3 } from "@unboltkit/core";

/** Plain-data types shared by the main thread and the Blitz_Worker. No React, DOM or runtime imports. */

export type BundledLevelId =
  | "lockbox"
  | "planetary-gearbox"
  | "keyboard-65"
  | "dumbbell-cage"
  | "ship-in-bottle";

export interface MaterialDescriptor {
  baseColor: number;
  metalness: number;
  roughness: number;
  transmission: number;
  opacity: number;
  emissive: number;
}

/** Plain scene data. Child order equals Object3D child order, so Core node paths match. */
export interface ScenePayloadNode {
  name: string;
  position: Vec3;
  quaternion: [number, number, number, number];
  scale: Vec3;
  mesh: {
    positions: Float32Array;
    normals: Float32Array | null;
    indices: Uint32Array | null;
    material: MaterialDescriptor;
  } | null;
  children: ScenePayloadNode[];
}

export interface ScenePayload {
  root: ScenePayloadNode;
  meshCount: number;
}

export type SolveSource =
  | { kind: "bundled"; levelId: BundledLevelId }
  | { kind: "scene"; fileName: string; scene: ScenePayload };

export interface SolveRequestMessage {
  type: "solve";
  requestId: number;
  source: SolveSource;
}

export type StageName = "stage0" | "stage1" | "stage2" | "stage3" | "stage4";

/** Render_Data of one part, in normalized coordinates (maxExtent 1.0). */
export interface PartRenderData {
  partId: string;
  displayName: string;
  nodeName: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  material: MaterialDescriptor;
  obb: { center: Vec3; halfExtents: Vec3 };
  aabb: { min: Vec3; max: Vec3 };
  isFastener: boolean;
  principalAxis: Vec3;
  /** 32 unit vectors, indexed by `dirIndex`. */
  candidateAxes: Vec3[];
}

/** `from → to` with `dirIndex`: part `to` blocks part `from` along candidate axis `dirIndex`. */
export interface BlitzEdge {
  from: string;
  to: string;
  dirIndex: number;
}

/** Present when Core reports `polyBudgetExceeded` for a multi-part scene. The level stays playable. */
export interface OverBudgetWarning {
  totalTriangles: number;
  polyBudget: 150000;
  stride: number;
}

export interface SolveResult {
  /** Ascending `partId`. */
  parts: PartRenderData[];
  edges: BlitzEdge[];
  plan: SolvedPlan | DeadlockedPlan;
  /** Null unless the plan is solved. */
  trajectories: TrajectoryStep[] | null;
  /** Non-null exactly when Core reports `polyBudgetExceeded`. */
  overBudget: OverBudgetWarning | null;
  timings: { totalMs: number; stageMs: Partial<Record<StageName, number>> };
}

export type WorkerRejection =
  | { reason: "monolithic"; totalTriangles: number }
  | {
      reason: "no-geometry";
      errorKind: "EmptyAssemblyError" | "InvalidGeometryError";
      message: string;
    };

export interface SolveFailure {
  name: string;
  code: string | null;
  message: string;
}

export type WorkerOutMessage =
  | { type: "progress"; requestId: number; stage: StageName; state: "started" | "completed" }
  | { type: "solved"; requestId: number; result: SolveResult }
  | { type: "rejected"; requestId: number; rejection: WorkerRejection }
  | { type: "failure"; requestId: number; failure: SolveFailure };
