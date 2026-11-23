import type { MeshBVH } from "three-mesh-bvh";
import type { ResolvedSolverConfig } from "./config";

/** Three components as a tuple, so every value is plain data. */
export type Vec3 = [number, number, number];

/** Child indices from the provided root. `[]` is the root itself. */
export type NodePath = number[];

// ---------------------------------------------------------------------------
// Diagnostics and normalization
// ---------------------------------------------------------------------------

export interface Diagnostic {
  code: "excluded-node" | "derived-normals" | "instancing-ignored" | "skinning-ignored";
  nodePath: NodePath;
  nodeType: string;
  message: string;
}

/** Maps world coordinates to normalized ones: `normalized = world * scale + translation`. */
export interface NormalizationTransform {
  scale: number;
  translation: Vec3;
}

export interface SamplingMetadata {
  stride: number;
  polyBudgetExceeded: boolean;
  totalTriangles: number;
  polyBudget: 150000;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export interface PlanStep {
  partId: string;
  dir: Vec3;
  /** Index into that Part's Candidate_Axes, 0 to 31. */
  dirIndex: number;
  escapeDistance: number;
  /**
   * Always `null` in plans from the Peel_Solver (Req 14.10). A non-null value only appears in
   * steps that a consumer or test supplies, where it selects `two_step_l_slide` (Req 19.10).
   */
  secondary: { dir: Vec3; distance: number } | null;
}

export interface WitnessEdge {
  from: string;
  to: string;
  dirIndex: number;
  dir: Vec3;
  fromTriangles: number[];
  toTriangles: number[];
}

export interface DeadlockWitness {
  /** Each SCC has at least 2 Part_IDs, sorted. */
  sccs: { partIds: string[]; edges: WitnessEdge[] }[];
  unassignedPartIds: string[];
}

// ---------------------------------------------------------------------------
// Errors as plain data (returned values)
// ---------------------------------------------------------------------------

export interface ConfigurationIssue {
  fields: string[];
  rejected: string[];
  message: string;
}

export interface ConfigurationError {
  kind: "ConfigurationError";
  message: string;
  issues: ConfigurationIssue[];
}

export interface EmptyAssemblyError {
  kind: "EmptyAssemblyError";
  message: string;
  diagnostics: Diagnostic[];
}

export interface InvalidGeometryError {
  kind: "InvalidGeometryError";
  message: string;
  reason: "non-finite" | "malformed" | "zero-extent" | "non-finite-scale";
  /** Traversal order. Empty for `zero-extent` and `non-finite-scale`. */
  nodePaths: NodePath[];
}

export interface MonolithicMeshError {
  kind: "MonolithicMeshError";
  message: string;
  totalTriangles: number;
  nodePath: NodePath;
}

export type CoreError = ConfigurationError | EmptyAssemblyError | InvalidGeometryError | MonolithicMeshError;

// ---------------------------------------------------------------------------
// Disassembly plans
// ---------------------------------------------------------------------------

export interface SolvedPlan {
  status: "solved";
  steps: PlanStep[];
  normalization: NormalizationTransform;
  sampling: SamplingMetadata;
  diagnostics: Diagnostic[];
}

export interface DeadlockedPlan {
  status: "deadlocked";
  steps: PlanStep[];
  witness: DeadlockWitness;
  normalization: NormalizationTransform;
  sampling: SamplingMetadata;
  diagnostics: Diagnostic[];
}

export interface ErrorResult {
  status: "error";
  error: CoreError;
  diagnostics: Diagnostic[];
}

/** Narrow on `status` before reading `steps`, `witness` or `error` (Req 30.4). */
export type DisassemblyPlan = SolvedPlan | DeadlockedPlan | ErrorResult;

// ---------------------------------------------------------------------------
// Blocking graph
// ---------------------------------------------------------------------------

export interface BlockingEdge {
  from: string;
  to: string;
  dirIndex: number;
  dir: Vec3;
  fromTriangles: number[];
  toTriangles: number[];
}

export interface BlockingGraph {
  /** Ascending by UTF-16 code units. */
  partIds: string[];
  /** Per Part, 32 entries, with keys in sorted order. */
  candidateAxes: Record<string, Vec3[]>;
  /** Sorted by `(from, dirIndex, to)`. */
  edges: BlockingEdge[];
  stats: { pairsTested: number; pairsPruned: number; raysCast: number; zeroAreaParts: number };
  /** Present only when `collectRayCounts` was set. */
  diagnostics?: {
    rayCounts: { from: string; to: string; dirIndex: number; forwardRays: number; backwardRays: number }[];
    prunedTriples: { from: string; to: string; dirIndex: number }[];
  };
}

// ---------------------------------------------------------------------------
// Stage 4 and oracle results
// ---------------------------------------------------------------------------

/** Parameters of a compiled step. Custom primitives must also return plain data. */
export type PrimitiveParams =
  | { kind: "linear_slide"; dir: Vec3; distance: number }
  | { kind: "helical_unscrew"; dir: Vec3; distance: number; axis: Vec3; pivot: Vec3; pitch: number }
  | { kind: "two_step_l_slide"; d1: Vec3; s1: number; d2: Vec3; s2: number }
  | { kind: string; [key: string]: unknown };

export interface TrajectoryStep {
  partId: string;
  primitive: string;
  params: PrimitiveParams;
}

/** Pose `x ↦ R·x + T`, with `rotation` as 9 row-major numbers. */
export interface Pose {
  rotation: number[];
  translation: Vec3;
}

export interface NaiveBaselineResult {
  perPart: {
    partId: string;
    direction: Vec3;
    clashCount: number;
    clashes: { obstructingPartId: string; movingTriangle: number; obstructingTriangle: number }[];
  }[];
  totalClashes: number;
}

/**
 * The structural subset of a normalized Part that the Clash_Checker reads (Req 20). A
 * `NormalizedPart` satisfies it. The oracle recomputes face normals and areas from `triangles`
 * and `positions` itself, so it does not read `faceNormals`, `triangleAreas` or `cornerNormals`.
 *
 * `bvh` must be built over the same `positions` and `triangles`, with `indirect: true`, so that a
 * reported `faceIndex` is the Part-local triangle index.
 */
export interface ClashPart {
  readonly partId: string;
  /** 3 numbers per vertex. */
  readonly positions: Float64Array;
  /** 3 vertex indices per triangle, outward wound. */
  readonly triangles: Uint32Array;
  /** Weld cluster of every vertex. */
  readonly weldIds: Uint32Array;
  /** Per weld cluster, the local index of its smallest member vertex. */
  readonly weldRepresentatives: Uint32Array;
  readonly aabb: { readonly min: Vec3; readonly max: Vec3 };
  readonly bvh: MeshBVH;
}
export interface ClashResult {
  /** Number of rays that produced an Opposing_Normal_Collision. */
  count: number;
  /** Sorted ascending, no duplicates. */
  movingTriangles: number[];
  /** Sorted by Part_ID. Only Parts with at least 1 collision appear. Triangle lists are sorted ascending, no duplicates. */
  staticTriangles: { partId: string; triangles: number[] }[];
  /**
   * One record per colliding ray, sorted by `(originSide, originPartId, originKind,
   * originIndex)` with `moving` before `static` and `vertex` before `centroid`.
   */
  collisions: {
    originSide: "moving" | "static";
    originPartId: string;
    originKind: "vertex" | "centroid";
    /** For `vertex`, the local index of the weld cluster's representative vertex. For `centroid`, the triangle index. */
    originIndex: number;
    /** For `centroid`, the triangle itself. For `vertex`, the largest incident triangle, the lowest index on ties. */
    originTriangle: number;
    hitPartId: string;
    hitTriangle: number;
    /** Distance from the micro-shrunk origin along the ray's unit direction. */
    distance: number;
  }[];
}

// ---------------------------------------------------------------------------
// Finite straight-move verification (spec crossed-bars-false-verified)
// ---------------------------------------------------------------------------

/** Outcome of one verified move, or of a whole plan. */
export type MoveVerdict = "clear" | "blocked" | "unverified";

export type MoveReason =
  /** Clear: the swept moving box and the static box are more than Clearance_Epsilon apart. */
  | "separated_boxes"
  /** Clear: the surfaces stay at least Clearance_Epsilon apart over the whole move. */
  | "separation_distance"
  /** Clear: distance up to the contact, then one plane separates the Parts exactly. */
  | "contact_plane"
  /** Blocked: a point more than Clearance_Epsilon inside both Parts at some travel. */
  | "penetration_witness"
  /** Unverified: the step's primitive is not a straight `linear_slide`. */
  | "unsupported_primitive"
  /** Unverified: a mesh is not closed, so its interior is undefined. */
  | "open_mesh"
  /** Unverified: a closed mesh encloses non-positive volume, so it is not outward-wound. */
  | "invalid_orientation"
  /** Unverified: one Part lies inside the other at the start. */
  | "nested_at_start"
  /** Unverified: the start could not be shown to be interior-disjoint. */
  | "initial_separation_unknown"
  /** Unverified: contact occurs and neither a separating plane nor a witness settles it. */
  | "contact_unresolved"
  /** Unverified: the distance proof needed more steps than its bound. */
  | "iteration_cap";

/** The exact motion a verdict is about, in normalized coordinates. */
export interface LinearMove {
  partId: string;
  dir: Vec3;
  distance: number;
  /** Part_IDs of the static Parts, ascending. */
  presentPartIds: string[];
}

export interface PairVerification {
  staticPartId: string;
  verdict: MoveVerdict;
  reason: MoveReason;
  /** The numbers behind the reason. Only the fields of that reason are set. */
  evidence: {
    boxGap?: number;
    minDistance?: number;
    iterations?: number;
    contactAt?: number;
    normal?: Vec3;
    overlap?: number;
    travel?: number;
    point?: Vec3;
    depth?: number;
  };
}

export interface MoveVerification {
  move: LinearMove;
  verdict: MoveVerdict;
  /** One entry per static Part, ascending by Part_ID. */
  pairs: PairVerification[];
}

export interface StepVerification {
  partId: string;
  primitive: string;
  verdict: MoveVerdict;
  /** `unsupported_primitive` for a step that was not checked, otherwise `null`. */
  reason: MoveReason | null;
  /** `null` for a step that was not checked. */
  move: MoveVerification | null;
  /** Static Part_IDs whose pair is Blocked, ascending. */
  blockerIds: string[];
}

export interface TrajectoryVerification {
  verdict: MoveVerdict;
  steps: StepVerification[];
}

export type RegistryError =
  | { kind: "DuplicatePrimitiveName"; name: string; message: string }
  | { kind: "UnknownPrimitive"; name: string; message: string }
  | {
      kind: "InvalidPrimitive";
      member: "name" | "priority" | "isApplicable" | "buildParams" | "pose";
      message: string;
    }
  | { kind: "NoApplicablePrimitive"; partId: string; message: string };

export type RegistryResult<T> = { ok: true; value: T } | { ok: false; error: RegistryError };

export type CompileError =
  | { kind: "PlanNotSolved"; status: "deadlocked" | "error"; message: string }
  | ConfigurationError
  | RegistryError;

// ---------------------------------------------------------------------------
// Internal stage data. These hold typed arrays or the MeshBVH, so they never
// appear in a public result.
// ---------------------------------------------------------------------------

/** One mesh node after Scene_Parser. Positions and normals are world space. */
export interface MeshRecord {
  nodePath: NodePath;
  nodeName: string;
  /** Column-major world matrix, computed from local TRS. */
  worldMatrix: number[];
  /** World-space position of each source vertex, 3 numbers per vertex. */
  positions: Float64Array;
  /**
   * Unit normal for each triangle corner, 9 numbers per triangle in source corner order
   * (corner 0, corner 1, corner 2). For derived normals, the three corners of a triangle hold
   * the same face normal.
   */
  normals: Float64Array;
  normalsDerived: boolean;
  /** Source vertex indices, 3 per triangle. Non-indexed geometry gives `3k, 3k+1, 3k+2`. */
  triangles: Uint32Array;
  /** `det(worldMatrix) < 0`. Corner order must be reversed to keep face normals outward. */
  windingFlipped: boolean;
}

/** A structural problem found on one mesh node during Stage 0 validation. */
export interface GeometryIssue {
  reason: "malformed" | "non-finite";
  nodePath: NodePath;
}

export interface Part {
  partId: string;
  sourceNodePath: NodePath;
  sourceNodeName: string;
  islandIndex: number;
  sourceTriangleIndices: Uint32Array;
  positions: Float64Array;
  triangles: Uint32Array;
  weldIds: Uint32Array;
  weldRepresentatives: Uint32Array;
  faceNormals: Float64Array;
  triangleAreas: Float64Array;
  /** 9 numbers per triangle (three corners, each with x, y, z). */
  cornerNormals: Float64Array;
}

export interface Stage0Result {
  status: "ok";
  parts: Part[];
  meshes: MeshRecord[];
  diagnostics: Diagnostic[];
  totalTriangles: number;
  sampling: SamplingMetadata;
}

export type FrameAxisName = "PCA1" | "PCA2" | "PCA3";

export type FrameRule =
  | "eigen"
  | "farthest"
  | "largest-face"
  | "skew"
  | "farthest-sign"
  | "F1"
  | "F2"
  | "F3";

/** Which rule fixed one axis or one sign of a Part frame. */
export interface FrameDecision {
  axis: FrameAxisName;
  subject: "axis" | "sign";
  rule: FrameRule;
}

export interface PartFrame {
  /** PCA1, PCA2, PCA3, right-handed. */
  axes: [Vec3, Vec3, Vec3];
  variances: [number, number, number];
  centroid: Vec3;
  obb: { center: Vec3; halfExtents: Vec3 };
  frameUnique: boolean;
  minRelativeMargin: number;
  decisions: FrameDecision[];
}

export interface NormalizedPart extends Part {
  aabb: { min: Vec3; max: Vec3 };
  frame: PartFrame;
  /** 32 entries, in the fixed layout of Req 10. */
  candidateAxes: Vec3[];
  metrics: { extentsSorted: Vec3; slenderness: number; isFastener: boolean };
  bvh: MeshBVH;
}

export interface Stage1Result {
  status: "ok";
  /** Ascending by Part_ID. */
  parts: NormalizedPart[];
  normalization: NormalizationTransform;
  sampling: SamplingMetadata;
  diagnostics: Diagnostic[];
  config: ResolvedSolverConfig;
}
