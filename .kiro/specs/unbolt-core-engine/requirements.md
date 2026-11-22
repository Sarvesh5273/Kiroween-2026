# Requirements Document

## Introduction

UnboltKit Core Engine is the pure-CPU TypeScript disassembly solver in `packages/unbolt-core` (npm name `@unboltkit/core`), together with the procedural test and demo assemblies in `packages/sample-kits` (npm name `@unboltkit/sample-kits`).

Given a Three.js `Object3D` hierarchy, the Core_Engine computes a collision-free, ordered disassembly plan in five stages:

- **Stage 0**: parse the scene hierarchy and split meshes into connected islands (Parts).
- **Stage 1**: normalize the assembly, build per-Part SAH BVHs, and compute Candidate_Axes.
- **Stage 2**: build an OBB-pruned, bidirectional swept-ray Directional Blocking Graph (DBG).
- **Stage 3**: peel Parts in a Kahn topological order, or return a Tarjan SCC Deadlock_Witness when no Part can move.
- **Stage 4**: compile the peel order into kinematic motion primitives, and provide a naive radial-explosion baseline for comparison.

The Sample_Kits package provides deterministic, license-clean procedural assemblies: three showcase kits and two adversarial Deadlock_Cages. Property-based tests built on `fast-check` and `vitest` verify the geometric and graph invariants of the Core_Engine.

### Scope

In scope:

- `packages/unbolt-core`
- `packages/sample-kits`

Out of scope:

- All code in `apps/*` (`apps/guide-forge`, `apps/unbolt-blitz`, `apps/crew-assembly-ci`) and `tools/*` (`tools/cad-auditor-mcp`). These are downstream consumers of the Core_Engine. Their UI, recovery screens, and Web Worker wiring are specified elsewhere.
- Reading `.gltf`/`.glb` files from disk or network. Consumers load files (for example with `GLTFLoader`) and pass the resulting `Object3D` to the Core_Engine.
- Rendering, animation playback, GPU computation, and CSG boolean operations.
- Automatic Kiro hook wiring of new motion primitives. The Primitive_Registry only has to be ready for it.

### Project conventions applied (from `.kiro/steering`)

- `geometry-invariants.md`: the Core_Engine is pure CPU TypeScript with only `three` and `three-mesh-bvh` as runtime dependencies, has no DOM, WebGL, or `window` access, and normalizes to `maxExtent = 1.0` before any DBG raycasting. Sample_Kits use `ExtrudeGeometry` and `LatheGeometry` with PBR materials and avoid deep `three-bvh-csg` chains.
- `no-spec-gaming.md`: no hardcoded Part IDs, bounding boxes, or step orders. No silently swallowed exceptions. No trivial assertions. All randomness is seeded. Every property test checks a real geometric or graph property.

## Glossary

- **Core_Engine**: The `@unboltkit/core` package as a whole, including all stages and its public API.
- **Scene_Parser**: The Stage 0 component that traverses an `Object3D` hierarchy and extracts world-space triangle geometry per mesh node.
- **Island_Splitter**: The Stage 0 component that welds indexed vertices and runs Union-Find over triangles to split one mesh node into connected Islands.
- **Normalizer**: The Stage 1 component that uniformly scales and translates the Assembly so that its axis-aligned bounding box has `maxExtent = 1.0`.
- **BVH_Builder**: The Stage 1 component that builds one `MeshBVH` per Part using the `SAH` split strategy from `three-mesh-bvh`.
- **Axis_Generator**: The Stage 1 component that computes each Part's PCA/OBB local axes and Candidate_Axes.
- **DBG_Builder**: The Stage 2 component that computes Blocking_Edges between Parts for each Candidate_Axis.
- **Peel_Solver**: The Stage 3 component that removes Parts in Kahn topological order.
- **SCC_Analyzer**: The Stage 3 component that runs Tarjan's Strongly Connected Components algorithm on the Blocking_Graph of the Parts that could not be peeled.
- **Primitive_Registry**: The Stage 4 registry of named Motion_Primitives, located in `packages/unbolt-core/src/primitives/`.
- **Motion_Primitive**: A named, parameterized rigid-motion generator that maps a normalized time `t` in `[0, 1]` to an SE(3) pose. Built-in names: `linear_slide`, `helical_unscrew`, `two_step_l_slide`.
- **Trajectory_Compiler**: The Stage 4 component that converts a Disassembly_Plan into an ordered list of Trajectory_Steps.
- **Trajectory_Step**: One compiled motion: a Part ID, a Motion_Primitive name, and that primitive's parameters.
- **Naive_Baseline**: The function `computeNaiveRadialClashes()`, which counts clashes produced by a naive radial explosion of the Assembly.
- **Clash_Checker**: The test-oracle component that counts Opposing_Normal_Collisions for a Part translated along a direction against a set of static Parts, independently of the DBG_Builder's sampling.
- **Sample_Kits**: The `@unboltkit/sample-kits` package.
- **Kit_Builder**: A Sample_Kits function that returns a procedural Assembly as a `THREE.Group`.
- **Keyboard_Fixture**: The reduced keyboard Assembly returned by the 65% Mechanical Keyboard Kit_Builder when called with a grid layout of 2 rows by 3 columns (Requirement 23 criteria 9 and 10).
- **Full_Keyboard**: The Assembly returned by the 65% Mechanical Keyboard Kit_Builder when called with its default parameters (the full 65% layout).
- **Full_Keyboard_Run_Count**: The number of seeded runs that each Invariant 1, Invariant 2, and Invariant 4 property test executes on the Full_Keyboard: 10 by default, overridable through the environment variable `UNBOLT_FULL_KB_RUNS` (Requirement 25 criteria 10 to 12).
- **Invariant_Kit**: One of the four Assemblies that the Invariant 1, Invariant 2, and Invariant 4 property tests use: the Haunted Clockwork Lockbox, the 3-Stage Planetary Gearbox, and the Keyboard_Fixture, each run at least 100 times per property, and the Full_Keyboard, run Full_Keyboard_Run_Count times per property.
- **Watertight_Solid_Part**: A Part that is closed (every edge between two welded vertices is shared by exactly 2 of the Part's triangles), outward-wound (every triangle's counter-clockwise winding yields a face normal that points out of the solid the Part encloses), and thicker than Micro_Shrink everywhere, with thickness measured as in Requirement 22 criterion 15.
- **Construction_Axis**: For a Sample_Kits Part, the unit axis along which the Kit_Builder builds and intends to remove the Part (the extrusion direction of an `ExtrudeGeometry` Part, the lathe axis of a `LatheGeometry` Part, or the shaft axis of a screw, pin, or spindle), recorded by the Kit_Builder on the Part's mesh node so that kit tests can read it.
- **Radial_Clearance**: For a Sample_Kits Part and its Construction_Axis `a`, the smallest distance, measured perpendicular to `a` in normalized units, between the Part's surface and the surface of any other Part of the same Assembly at the same position along `a`, taken over every position along `a` within the Part's extent along `a`.
- **Expected_Blocking_Edge**: For a Sample_Kits Assembly, a triple `(A, B, d)` with A ≠ B and `d` one of A's Candidate_Axes, for which the Clash_Checker, run with the default Solver_Config, reports at least 1 Opposing_Normal_Collision when A is translated along `d` against the static Part B alone.
- **Sample_Ray**: One of the stratified rays that the DBG_Builder casts for a Part pair and direction under Requirement 12 criteria 1 and 2.
- **Deadlock_Cage**: An adversarial Kit_Builder output in which no Part can be removed by any translation along any Candidate_Axis.
- **Assembly**: The full set of Parts derived from one input `Object3D` hierarchy.
- **Part**: One Island, with a stable Part ID, world-space triangles, a source node reference, and an Island index.
- **Island**: A maximal set of triangles within one mesh node that are connected through shared welded vertices.
- **Part_ID**: A string identifier derived deterministically from the source node's path in the hierarchy and the Island index.
- **Weld_Tolerance**: The configurable distance, relative to the Assembly's bounding-box diagonal, within which two vertex positions are treated as the same vertex during Island splitting.
- **Poly_Budget**: The fixed threshold of 150,000 total triangles across the Assembly.
- **Sampling_Metadata**: The deterministic stride surface-sampling description attached to the Assembly, containing the stride value and the Poly_Budget warning flag.
- **Normalization_Transform**: The uniform scale and translation that the Normalizer applies, recorded so that consumers can map results back to source coordinates.
- **PCA_Axes**: Three orthonormal unit vectors per Part, derived from principal component analysis of the Part's vertices, which also define the Part's OBB orientation.
- **OBB**: The oriented bounding box of a Part, aligned to its PCA_Axes.
- **Tied_Eigenspace**: For a Part, the span of the eigenvectors of its vertex covariance matrix whose eigenvalues pairwise differ by at most `1e-9` times the largest eigenvalue, when at least 2 such eigenvalues exist. All eigenvalues of a Part whose vertices all coincide belong to one Tied_Eigenspace.
- **Intrinsic_Frame_Rule**: The deterministic axis-resolution and sign-resolution rule of Requirement 9 criteria 5 and 6. The rule uses only the Assembly's vertex positions and triangles, so it moves with the Part under any SE3_Transform.
- **Frame_Unique_Part**: A Part for which the Intrinsic_Frame_Rule chooses every PCA_Axis and every sign through its geometric steps, without the Frame_Ambiguous_Part fallback, and decides every comparison it makes by a margin of at least `1e-6` relative to the scale of the compared quantity (the largest principal variance for variance comparisons, the cube of the standard deviation along the axis for third-moment comparisons, and the farthest-vertex distance for distance comparisons), so that rounding cannot change the result.
- **Frame_Ambiguous_Part**: A Part that is not a Frame_Unique_Part, for example a vertex set with full cubic or spherical symmetry. No geometry-only rule can pick a unique frame for such a Part.
- **All_Collinear_Assembly**: An Assembly in which every vertex of every Part lies on one straight line.
- **Canonical_Directions**: The 26 unit vectors of the cube neighborhood: 6 face directions (±X, ±Y, ±Z), 12 edge diagonals, and 8 corner diagonals.
- **Candidate_Axes**: For one Part, the Canonical_Directions plus both signs of each of the Part's 3 PCA_Axes, in a deterministic order.
- **Blocking_Edge**: A directed record `(A, B, d)` stating that Part B obstructs the translation of Part A along direction `d`, together with the clashing triangle indices on both Parts.
- **Blocking_Graph**: The set of all Blocking_Edges, indexable per direction.
- **Micro_Shrink**: The configurable distance by which each ray origin is moved inward from the sampled surface, opposite the surface normal, before casting.
- **Clearance_Epsilon**: The configurable non-negative distance below which a ray hit, measured from the micro-shrunk origin, is discarded as coincident-surface noise.
- **Tau**: The configurable grazing threshold `tau` in `[0, 1)`. A ray hit counts as blocking only if `dot(hitNormal, dir) < -tau`.
- **Opposing_Normal_Collision**: A ray hit against another Part's triangle where `dot(hitNormal, dir) < -tau` and the hit distance is at least Clearance_Epsilon.
- **Slenderness**: For a Part, the ratio of its longest OBB extent to the mean of its two shorter OBB extents.
- **Fastener**: A Part whose two shorter OBB extents differ by at most a configurable symmetry tolerance and whose Slenderness is at least a configurable Fastener slenderness threshold.
- **Radial_Exposure**: The distance from a Part's OBB center to the centroid of the OBB centers of all Parts still present in the Assembly.
- **Escape_Distance**: For a Part and direction `d`, the smallest translation along `d` after which the Part's axis-aligned bounding box no longer overlaps the axis-aligned bounding box of the union of all other Parts still present.
- **Disassembly_Plan**: The solver output. Contains `status`, an ordered list of Plan_Steps when `status === 'solved'`, a Deadlock_Witness when `status === 'deadlocked'`, the Normalization_Transform, and Sampling_Metadata.
- **Plan_Step**: One peel step: a Part_ID, a unit removal direction `dir`, the Escape_Distance along `dir`, and a `secondary` field that is either `null` or a secondary unit direction with a distance.
- **DeadlockWitness**: The structured deadlock report (Deadlock_Witness) containing one or more SCCs, each with at least 2 Part_IDs, and for each Blocking_Edge inside an SCC, the exact clashing triangle indices on both Parts.
- **MonolithicMeshError**: The structured error state returned when the entire Assembly resolves to exactly 1 Island.
- **EmptyAssemblyError**: The structured error state returned when the input hierarchy yields zero triangles, including a hierarchy with no `THREE.Mesh` node that has at least 1 triangle.
- **InvalidGeometryError**: The structured error state returned when the input geometry cannot be processed: non-finite vertex positions or normals, malformed index or position buffers, a zero maximum bounding-box extent, or a non-finite normalization scale. It names the offending node path or paths where applicable.
- **Configuration_Error**: The structured error state returned when a supplied Solver_Config violates one or more validation rules of Requirement 2. It lists every violated field and its rejected value.
- **Solver_Config**: The configuration object for the Core_Engine: Weld_Tolerance, Micro_Shrink, Clearance_Epsilon, Tau, samples per Part per direction, Fastener thresholds, helical angular tolerance (in degrees, default 5, greater than 0 and less than 90), thread pitch (finite and greater than 0), and the PRNG seed.
- **Seeded_PRNG**: A deterministic pseudo-random number generator initialized from an explicit integer seed.
- **SE3_Transform**: A rigid transformation consisting of a rotation and a translation, with no scaling.
- **SE3_Arbitrary**: The single shared, seeded `fast-check` arbitrary that generates SE3_Transforms for the Invariant 1, Invariant 2, and Invariant 3 property tests: a unit quaternion whose norm is within `1e-6` of 1 and a translation whose components each lie in `[-100, 100]` source units.

## Requirements

### Requirement 1: Core purity and runtime portability

**User Story:** As a consumer developer, I want the Core_Engine to run unchanged in browser Web Workers, Vitest, and headless Node CI, so that one solver serves every app and pipeline.

#### Acceptance Criteria

1. THE Core_Engine SHALL list exactly `three` and `three-mesh-bvh`, and no other packages, across the combined `dependencies` and `peerDependencies` of its package manifest, with test-only packages such as `fast-check` and `vitest` declared only in `devDependencies`.
2. THE Core_Engine SHALL import only from `three`, `three-mesh-bvh`, and its own source files, and SHALL contain no reference to the globals `window`, `document`, `navigator`, `HTMLElement`, `HTMLCanvasElement`, `OffscreenCanvas`, `WebGLRenderingContext`, or `WebGL2RenderingContext`.
3. WHEN the Core_Engine test suite runs under Vitest with the `node` test environment and with no setup file or environment that defines `window`, `document`, or other DOM globals, THE Core_Engine SHALL execute Stage 0 through Stage 4 and the Naive_Baseline on at least one Sample_Kits Assembly, and the run SHALL report zero failed tests.
4. THE Core_Engine SHALL expose each stage as an exported function that returns its result directly as a non-Promise value, without waiting on timers, events, or message passing, so that it can be called synchronously from inside a Web Worker.
5. THE Core_Engine SHALL return Disassembly_Plan, DeadlockWitness, MonolithicMeshError, Trajectory_Step, and Naive_Baseline results as plain data values. A plain data value is built only from strings, finite numbers, booleans, `null`, arrays, typed arrays, and objects whose prototype is `Object.prototype`, and contains no cycles, no `Map` or `Set` instances, no class instances, no functions, and no `THREE` objects (including `Vector3`, `Matrix4`, `Quaternion`, `Box3`, `BufferGeometry`, and `Object3D`).
6. FOR ALL Disassembly_Plan, DeadlockWitness, MonolithicMeshError, and Trajectory_Step list values that the Core_Engine produces from the five Sample_Kits assemblies and from at least 100 `fast-check`-generated Assemblies, applying `structuredClone` SHALL produce a value that is deep-equal to the original under Vitest's `toStrictEqual` (round-trip property).
7. THE Core_Engine SHALL NOT import Node.js built-in modules, including `fs`, `path`, `os`, `worker_threads`, and any `node:`-prefixed specifier.
8. WHEN any Core_Engine stage function is called with an input `Object3D` hierarchy, THE Core_Engine SHALL leave every node's position, rotation, scale, and matrix, every geometry's attribute and index arrays, and the child order of every node identical to their values before the call.

### Requirement 2: Solver configuration

**User Story:** As a consumer developer, I want a single validated configuration object with documented defaults, so that I can tune tolerances without editing solver code.

#### Acceptance Criteria

1. THE Core_Engine SHALL accept, as an optional argument to its public solving entry point, a Solver_Config in which each of the following fields is individually optional: Weld_Tolerance, Micro_Shrink, Clearance_Epsilon, Tau, samples per Part per direction, Fastener symmetry tolerance, Fastener slenderness threshold, helical angular tolerance, thread pitch, and PRNG seed.
2. WHEN a Solver_Config field is omitted or set to `undefined`, or the Solver_Config argument itself is omitted, THE Core_Engine SHALL use the default value for that field, as exported from the `@unboltkit/core` public API and documented in its TSDoc.
3. THE Core_Engine SHALL define default values that pass every validation rule in criteria 4 through 10, including Clearance_Epsilon being strictly less than Micro_Shrink, and that include the fixed default values of criterion 12.
4. IF Tau is not a finite number of type `number` or lies outside the half-open range `[0, 1)`, THEN THE Core_Engine SHALL return a configuration error that names the field `tau` and the rejected value.
5. IF Clearance_Epsilon, Micro_Shrink, or Weld_Tolerance is not of type `number`, is negative, is `NaN`, or is infinite, THEN THE Core_Engine SHALL return a configuration error that names the field and the rejected value.
6. IF Clearance_Epsilon and Micro_Shrink are both valid under criterion 5 and Clearance_Epsilon is greater than or equal to Micro_Shrink, THEN THE Core_Engine SHALL return a configuration error that names both fields and both rejected values.
7. IF samples per Part per direction is not an integer in the inclusive range 1 to 4,096, THEN THE Core_Engine SHALL return a configuration error that names the field and the rejected value.
8. IF the Fastener symmetry tolerance is not a finite, non-negative number, or the Fastener slenderness threshold is not a finite number greater than or equal to 1, THEN THE Core_Engine SHALL return a configuration error that names the offending field and the rejected value.
9. IF the PRNG seed is not an integer in the inclusive range 0 to 4,294,967,295, THEN THE Core_Engine SHALL return a configuration error that names the field and the rejected value.
10. IF the helical angular tolerance, measured in degrees with a default of 5, is not a finite number strictly greater than 0 and strictly less than 90, or the thread pitch is not a finite number strictly greater than 0, THEN THE Core_Engine SHALL return a configuration error that names the offending field and the rejected value.
11. IF a supplied Solver_Config violates one or more rules in criteria 4 through 10, THEN THE Core_Engine SHALL return a single configuration error that lists every violated field, without running Stage 0 through Stage 4, without producing a Disassembly_Plan, and without modifying the input `Object3D` hierarchy or the supplied Solver_Config object.
12. THE Core_Engine SHALL use these default values, which this requirement fixes: samples per Part per direction = `48`, Micro_Shrink = `1e-4`, Clearance_Epsilon = `5e-5`, and Tau = `0.05`. Micro_Shrink and Clearance_Epsilon are measured in normalized units where `maxExtent = 1.0`, and Tau is a dimensionless dot-product threshold. These defaults satisfy Clearance_Epsilon < Micro_Shrink (criterion 6). The design document sets the defaults of the remaining Solver_Config fields, except the helical angular tolerance default of 5 degrees stated in criterion 10.

### Requirement 3: Determinism

**User Story:** As a test author, I want identical inputs to produce identical outputs, so that every failure is reproducible.

#### Acceptance Criteria

1. THE Core_Engine SHALL draw every random value used by any stage (Stage 0 through Stage 4, including the Naive_Baseline) from a Seeded_PRNG initialized from the Solver_Config seed, so that two Seeded_PRNG instances initialized with the same seed produce the same sequence of values.
2. THE Core_Engine and the Sample_Kits SHALL use no unseeded randomness source in any stage or Kit_Builder, including `Math.random()` and `crypto.getRandomValues()`, and SHALL NOT let any wall-clock value, including `Date.now()` and `performance.now()`, affect any returned value.
3. WHEN the full pipeline runs twice on the same JavaScript runtime version, with the same Solver_Config values, on the same input hierarchy or on two separately constructed input hierarchies with identical node names, node order, transforms, and geometry, THE Core_Engine SHALL return deep-equal outputs for both runs. This covers the Disassembly_Plan (including `status`, Plan_Step order, Deadlock_Witness SCC order and triangle indices, Normalization_Transform, and Sampling_Metadata), the compiled Trajectory_Steps, the Naive_Baseline clash count, and any MonolithicMeshError. Deep-equal means the same keys, the same array element order, and numeric values identical under `Object.is`.
4. WHEN the Scene_Parser runs repeatedly on the same input hierarchy, or on separately constructed hierarchies with identical node names, node order, and geometry, THE Scene_Parser SHALL assign identical Part_IDs, and the Part_IDs SHALL NOT depend on `Object3D.uuid`, `Object3D.id`, or any other per-instance identifier.
5. THE Core_Engine SHALL iterate over Parts in ascending Part_ID order by UTF-16 code-unit comparison, over directions in the Candidate_Axes order, and over surface samples in ascending stride index order, and SHALL NOT let any iteration order depend on object identity, hash-map insertion timing, or asynchronous completion order.
6. IF the Solver_Config seed is present and is not an integer in the range 0 to 4,294,967,295 inclusive, THEN THE Core_Engine SHALL return the configuration error defined in Requirement 2 criteria 9 and 11 before Stage 0 begins, with no separate seed error type, and SHALL NOT return a Disassembly_Plan.
7. WHEN the Solver_Config omits the seed, THE Core_Engine SHALL initialize the Seeded_PRNG from a fixed default seed constant that is the same in every run and every release of the same package version.
8. WHEN a Kit_Builder is called twice with the same arguments, THE Sample_Kits SHALL return two `THREE.Group` hierarchies with identical node names, node order, local transforms, vertex positions, and triangle indices.

### Requirement 4: Stage 0 scene hierarchy parsing

**User Story:** As a consumer developer, I want the Core_Engine to read a Three.js `Group` or `Object3D` hierarchy from a GLTF/GLB load or a procedural kit, so that I can solve real exported assemblies and generated kits through one entry point.

#### Acceptance Criteria

1. WHEN an `Object3D` hierarchy (including a `THREE.Group`) is provided, THE Scene_Parser SHALL visit the root node and every descendant node in pre-order depth-first order, visiting the children of each node in ascending child-array index order, and SHALL treat every visited `THREE.Mesh` node as a source of Parts regardless of the node's `visible` flag.
2. WHEN a `THREE.Mesh` node is visited, THE Scene_Parser SHALL compute the node's world matrix from the local `position`, `quaternion`, and `scale` of the node and each of its ancestors up to the provided root, without relying on any previously cached `matrixWorld` value.
3. WHEN a `THREE.Mesh` node is visited, THE Scene_Parser SHALL transform the node's vertex positions by the node's world matrix and SHALL transform the node's vertex normals by the inverse transpose of the upper-left 3×3 of that world matrix, re-normalized to unit length.
4. THE Scene_Parser SHALL produce world-space vertex positions that equal the source vertex position multiplied by the source node's world matrix, and world-space normals that equal the normalized inverse-transpose-transformed source normal, each within an absolute tolerance of `1e-9` times the Assembly bounding-box diagonal (transform preservation).
5. THE Scene_Parser SHALL record, for each Part, the source node name, a source node path built from the sequence of child indices from the provided root to the node (so that nodes with duplicate or empty names receive distinct paths), and the source triangle indices, where a non-indexed geometry is read as consecutive triples of vertices with triangle index `k` covering vertices `3k`, `3k+1`, and `3k+2`.
6. WHEN the Scene_Parser encounters a node that is not a `THREE.Mesh`, such as a light, camera, `Points`, or `Line`, or a `THREE.Mesh` whose geometry contains 0 triangles, THE Scene_Parser SHALL exclude that node from Parts, add a diagnostics entry containing the node path and the node type, and continue traversing that node's children.
7. THE Scene_Parser SHALL leave the input `Object3D` hierarchy unmodified, such that after parsing, every node's `position`, `quaternion`, `scale`, `matrix`, `matrixWorld`, and child order, every geometry's attribute arrays and index array, and every material reference are equal to their values before parsing.
8. IF the provided hierarchy contains no `THREE.Mesh` node with at least 1 triangle, THEN THE Scene_Parser SHALL return an error of kind `EmptyAssemblyError`, as defined in Requirement 6 criterion 4, that includes the diagnostics array of excluded node paths, and SHALL produce no Parts.
9. IF any vertex position or vertex normal of a visited `THREE.Mesh` node is non-finite (`NaN` or `±Infinity`) before or after the world-space transform, THEN THE Scene_Parser SHALL return an error of kind `InvalidGeometryError`, as defined in Requirement 6 criterion 5 (which covers non-finite vertex normals as well as non-finite vertex positions), identifying the offending node path, SHALL produce no Parts, and SHALL not proceed to Island splitting.
10. IF a visited `THREE.Mesh` node's geometry has no normal attribute, THEN THE Scene_Parser SHALL derive a unit-length world-space normal for each triangle from its counter-clockwise vertex winding and add a diagnostics entry containing the node path indicating that normals were derived.

### Requirement 5: Stage 0 island splitting

**User Story:** As a consumer developer, I want disconnected sub-parts exported inside one `THREE.Mesh` to become separate Parts, so that assemblies baked into a single mesh can still be disassembled.

#### Acceptance Criteria

1. THE Island_Splitter SHALL group triangles by source mesh node before any Island splitting and SHALL NOT weld vertices or merge triangles across different mesh nodes, so that triangles from different mesh nodes always belong to different Parts.
2. WHEN a mesh node's geometry is processed, THE Island_Splitter SHALL treat two vertices of that node as one welded vertex if the Euclidean distance between their world-space positions is less than or equal to Weld_Tolerance multiplied by the length of the Assembly's world-space axis-aligned bounding-box diagonal. This SHALL hold whether or not the two vertices share an index-buffer entry, and the relation SHALL apply transitively, so that any chain of vertices whose consecutive pairwise distances are within that limit forms one welded vertex.
3. WHEN welding of a mesh node is complete, THE Island_Splitter SHALL merge, with Union-Find, every pair of triangles in that mesh node that share at least one welded vertex, including triangles with zero area.
4. WHEN Union-Find for a mesh node is complete, THE Island_Splitter SHALL emit exactly one Part per resulting Island. Each Part SHALL contain that Island's world-space triangles, a reference to the source mesh node, and the Island index.
5. WHEN a mesh node has non-indexed geometry, THE Island_Splitter SHALL treat each consecutive group of 3 vertex positions as one triangle and SHALL weld those vertices with the same Weld_Tolerance rule as criterion 2 before running Union-Find.
6. FOR ALL mesh nodes, the multiset union of triangles across the node's Islands SHALL equal the node's original triangle set, with each original triangle appearing in exactly one Island (partition invariant).
7. FOR ALL pairs of distinct Islands from the same mesh node, no welded vertex, as defined in criterion 2, SHALL belong to both Islands.
8. THE Island_Splitter SHALL number the Islands of each mesh node with consecutive Island indices starting at 0. The Islands SHALL be ordered by ascending smallest original triangle index within the node, so that Island indices, and therefore Part_IDs, are identical across repeated runs on the same input.
9. IF a mesh node contains zero triangles, THEN THE Island_Splitter SHALL emit zero Parts for that node and SHALL continue processing the remaining mesh nodes.
10. IF a mesh node's index count (indexed geometry) or vertex position count (non-indexed geometry) is not a multiple of 3, or any index refers to a vertex position that does not exist, THEN THE Core_Engine SHALL return a result with `status === 'error'` and an error of kind `InvalidGeometryError` that names the offending node path, and SHALL emit no Parts for the Assembly.

### Requirement 6: Monolithic mesh detection

**User Story:** As a consumer developer, I want a clear structured error when an upload is one connected solid, so that my app can show a recovery state instead of a guessed cut.

#### Acceptance Criteria

1. IF the entire Assembly resolves to exactly 1 Island after the Island_Splitter runs with the Weld_Tolerance from the active Solver_Config, THEN THE Core_Engine SHALL return a result with `status === 'error'` and an error of kind `MonolithicMeshError`.
2. THE MonolithicMeshError SHALL include the total triangle count of the Assembly as an integer of at least 1, equal to the number of triangles the Scene_Parser extracted across all mesh nodes. It SHALL also include the source node path of the single Island, using the same hierarchy path that the Part_ID derivation uses, and a non-empty message string stating that the Assembly forms a single connected Island and that no Disassembly_Plan was produced.
3. IF the Core_Engine returns a result with an error of kind `MonolithicMeshError`, `EmptyAssemblyError`, or `InvalidGeometryError`, THEN THE Core_Engine SHALL skip Stages 1 through 4 for that Assembly. As a result, the result SHALL contain no Plan_Steps, no Deadlock_Witness, no Trajectory_Steps, and no Normalization_Transform.
4. IF the Assembly contains zero triangles across all mesh nodes, including a hierarchy that contains no mesh nodes, THEN THE Core_Engine SHALL return a result with `status === 'error'` and an error of kind `EmptyAssemblyError` that includes a non-empty message string stating that no triangle geometry was found.
5. IF any world-space vertex position or vertex normal extracted by the Scene_Parser has an x, y, or z component that is `NaN`, `+Infinity`, or `-Infinity`, THEN THE Core_Engine SHALL return a result with `status === 'error'` and an error of kind `InvalidGeometryError`. That error SHALL list the node path of every mesh node that contains at least 1 non-finite component, in hierarchy traversal order, and SHALL include a non-empty message string stating that non-finite vertex data was found.
6. IF more than one error condition from criteria 1, 4, and 5 holds for the same Assembly, THEN THE Core_Engine SHALL return exactly one error and choose it in this order of precedence: `InvalidGeometryError` first, then `EmptyAssemblyError`, then `MonolithicMeshError`. A configuration error under Requirement 2 criterion 11 SHALL take precedence over all of these geometry errors, so that an invalid Solver_Config is reported without evaluating any geometry error condition.
7. WHEN the Core_Engine produces a result with an error of kind `MonolithicMeshError`, `EmptyAssemblyError`, or `InvalidGeometryError`, THE Core_Engine SHALL return that result to the caller without throwing an exception and without modifying the input `Object3D` hierarchy's transforms, geometry attributes, or child list.

### Requirement 7: Poly budget and stride sampling

**User Story:** As a consumer developer, I want oversized meshes to stay within a sampling budget and raise a warning flag, so that solving stays tractable and my app can tell the user.

#### Acceptance Criteria

1. THE Core_Engine SHALL attach Sampling_Metadata to every Disassembly_Plan, whether its `status` is `'solved'` or `'deadlocked'`. The Sampling_Metadata SHALL contain a stride that is an integer of at least 1 and a Poly_Budget warning flag that is a boolean.
2. WHEN the total Assembly triangle count is at most 150,000, THE Core_Engine SHALL set the Sampling_Metadata stride to 1 and the Poly_Budget warning flag to `false`. The total Assembly triangle count is the sum of the full, unsampled triangle counts of all Parts in the Assembly, so an Assembly of exactly 150,000 triangles yields stride 1.
3. WHEN the total Assembly triangle count exceeds 150,000, THE Core_Engine SHALL set the Sampling_Metadata stride to `ceil(totalTriangles / 150000)` and the Poly_Budget warning flag to `true`. For example, 150,001 and 300,000 triangles both yield stride 2, and 300,001 triangles yields stride 3.
4. WHILE the Sampling_Metadata stride is greater than 1, THE DBG_Builder SHALL draw ray sample origins only from triangles whose 0-based Part-local index is a multiple of the stride. Triangle index 0 of every Part therefore stays eligible, including Parts with fewer triangles than the stride.
5. WHILE the Sampling_Metadata stride is greater than 1, THE Island_Splitter and the BVH_Builder SHALL process the full, unsampled triangle set. Each Part's triangle count and each Part's `MeshBVH` triangle count SHALL equal the count the same input produces when the stride is 1.
6. WHEN the total Assembly triangle count exceeds 150,000, THE Core_Engine SHALL complete all solver stages and return a Disassembly_Plan without throwing an exception. The Poly_Budget warning flag set to `true` SHALL be the only indication of the exceeded budget.
7. WHEN the Core_Engine is run twice on the same input `Object3D` hierarchy with the same Solver_Config, THE Core_Engine SHALL produce identical Sampling_Metadata and THE DBG_Builder SHALL draw ray sample origins from the same set of triangle indices on each Part in both runs.

### Requirement 8: Stage 1 normalization

**User Story:** As a solver maintainer, I want every Assembly normalized to a unit extent before raycasting, so that tolerances such as Clearance_Epsilon and Micro_Shrink have a consistent meaning across models.

#### Acceptance Criteria

1. WHEN Stage 0 completes without an error, THE Normalizer SHALL multiply every Part vertex position by one positive scalar scale factor and then add one translation vector, using the same scale factor and translation vector for all Parts, so that the largest of the three side lengths of the Assembly axis-aligned bounding box (`maxExtent`) equals `1.0` within an absolute tolerance of `1e-9`.
2. WHEN the Normalizer applies the Normalization_Transform, THE Normalizer SHALL place the center of the normalized Assembly axis-aligned bounding box at the origin, with each of the center's x, y, and z coordinates within an absolute tolerance of `1e-9` of `0`.
3. THE Core_Engine SHALL complete normalization of all Parts before the DBG_Builder casts any ray, so that every ray origin, Micro_Shrink offset, and Clearance_Epsilon comparison is evaluated in normalized coordinates.
4. WHEN the Core_Engine returns a Disassembly_Plan with `status === 'solved'` or `status === 'deadlocked'`, THE Core_Engine SHALL include in that Disassembly_Plan the Normalization_Transform, consisting of the positive scale factor and the translation vector that map pre-normalization world-space positions to normalized positions.
5. THE Normalizer SHALL produce a Normalization_Transform whose inverse, applied to every normalized vertex position, reproduces the corresponding pre-normalization world-space position within an absolute distance of `1e-9` multiplied by the pre-normalization Assembly bounding-box diagonal (round-trip property).
6. IF the Assembly axis-aligned bounding box has a maximum extent of zero, THEN THE Core_Engine SHALL return a result with `status === 'error'` and an error of kind `InvalidGeometryError`, without casting any ray and without returning any Plan_Steps.
7. IF any pre-normalization vertex coordinate is `NaN` or infinite, or the computed scale factor is not a finite positive number, THEN THE Core_Engine SHALL return a result with `status === 'error'` and an error of kind `InvalidGeometryError` indicating that non-finite geometry was found, without casting any ray and without returning any Plan_Steps.
8. WHEN the Normalizer normalizes an Assembly, THE Normalizer SHALL leave the vertex positions, node transforms, and hierarchy of the caller's input `Object3D` unchanged.

### Requirement 9: Stage 1 per-Part BVH and PCA/OBB axes

**User Story:** As a solver maintainer, I want one acceleration structure and one local frame per Part, so that ray queries are fast and Part-aligned extraction directions are available.

#### Acceptance Criteria

1. THE BVH_Builder SHALL build exactly one `MeshBVH` per Part using the `SAH` split strategy from `three-mesh-bvh`, such that the number of `MeshBVH` instances equals the number of Parts in the Assembly and each `MeshBVH` is associated with exactly one Part_ID.
2. WHEN the Normalizer has applied the Normalization_Transform to the Assembly, THE BVH_Builder SHALL build each Part's `MeshBVH` from that Part's normalized world-space triangles, such that the `MeshBVH` holds the same number of triangles as the Part and the `MeshBVH` root bounding box contains the Part's exact float64 normalized axis-aligned bounding box on every coordinate (each root minimum is less than or equal to the exact minimum, and each root maximum is greater than or equal to the exact maximum) and exceeds it by at most `1e-6` per coordinate.
3. THE Axis_Generator SHALL compute, for each Part, 3 PCA_Axes from the Part's normalized vertex positions, ordered by descending principal variance, where each axis is unit length within `1e-9`, the absolute dot product of every pair of axes is at most `1e-9`, and the cross product of the first and second axes equals the third axis within `1e-9` per component (right-handed frame).
4. THE Axis_Generator SHALL compute, for each Part, an OBB in normalized coordinates aligned to the PCA_Axes with a center and 3 non-negative half-extents, such that for each PCA_Axis the minimum and maximum projections of the Part's vertices onto that axis, measured from the OBB center, equal the negative and positive half-extent along that axis within `1e-9`, and every vertex of the Part lies inside the OBB within a tolerance of `1e-9`.
5. WHEN a Part has a Tied_Eigenspace, including a Part whose vertices are all collinear or all coincident, THE Axis_Generator SHALL resolve the PCA_Axes inside that Tied_Eigenspace with the Intrinsic_Frame_Rule, applying these steps in order:
   - Take the unit direction from the Part's vertex centroid (the mean of its vertex positions) to its farthest vertex and project it onto the Tied_Eigenspace. When several vertices lie within `1e-9` times the farthest distance of that distance, choose among them with an intrinsic geometric rule such as the largest area-weighted moment, which the design may refine. Vertex index order alone SHALL NOT decide this choice.
   - IF that projection has length at most `1e-9`, THEN project the unit outward face normal of the Part's largest-area triangle onto the Tied_Eigenspace instead.
   - Normalize the projection to obtain the next PCA_Axis. IF a tied subspace of 2 or more dimensions remains orthogonal to the axes chosen so far, THEN repeat these steps inside that subspace. Complete the frame with cross products, so that the PCA_Axes are unit length within `1e-9`, pairwise orthogonal within `1e-9`, and right-handed.
   - IF every geometric step above yields a projection of length at most `1e-9`, THEN the Part is a Frame_Ambiguous_Part, and the Axis_Generator SHALL resolve the remaining axes with a deterministic fallback, defined in the design, that uses only the Part's own vertex positions taken in triangle index order or the vertex positions of the other Parts of the Assembly, except in an All_Collinear_Assembly, where the exemption of criterion 7 applies.
6. THE Axis_Generator SHALL choose the sign of the first and second PCA_Axes with the Intrinsic_Frame_Rule, so that the third central moment (skewness) of the Part's vertex projections onto each of those axes is positive. IF that third central moment has absolute value at most `1e-9` times the cube of the standard deviation along the axis, THEN the sign SHALL make the dot product of the axis with the farthest-vertex direction of criterion 5 positive. IF that dot product is also within `1e-9` of 0, THEN the Part is a Frame_Ambiguous_Part and the fallback of criterion 5 SHALL decide the sign. THE Axis_Generator SHALL set the third PCA_Axis to the cross product of the first and second, so that two computations on the same Part with the same Solver_Config produce bitwise-identical PCA_Axes and OBB values.
7. THE Axis_Generator SHALL derive every PCA_Axis and every sign only from the Assembly's vertex positions and triangles, and SHALL NOT seed from or snap to fixed world-space directions such as `(1, 0, 0)`, `(0, 1, 0)`, or `(0, 0, 1)`, with exactly one exemption: for a Frame_Ambiguous_Part of an All_Collinear_Assembly, after the PCA_Axis along the common line is derived from the vertices, THE Axis_Generator SHALL complete the remaining PCA_Axes with the deterministic fallback F3 defined in the design, whose result may depend on world-space components. This exemption SHALL apply to no other Part and no other Assembly.
8. FOR ALL Frame_Unique_Parts and all SE3_Transforms with rotation `R` and translation `t` drawn from the SE3_Arbitrary, the PCA_Axes computed for the Part after the SE3_Transform is applied to the Assembly SHALL equal `R` applied to the PCA_Axes of the untransformed Part within `1e-6` per component, in the same order and with the same signs. After both OBBs are mapped back to pre-normalization world space with their Normalization_Transforms, the transformed OBB center SHALL equal `R` applied to the untransformed OBB center plus `t`, and the half-extents SHALL be equal, each within `1e-6` times the Assembly bounding-box diagonal (equivariance property).
9. IF a Part is a Frame_Ambiguous_Part, THEN THE Axis_Generator SHALL still produce PCA_Axes that meet criteria 3 and 6, criterion 8 SHALL NOT apply to that Part, and THE Core_Engine SHALL complete the solve without an exception or error status caused by that Part's frame.
10. THE BVH_Builder SHALL preserve triangle identity, such that a triangle index returned by a ray query against a Part's `MeshBVH` identifies the triangle at that same index in the Part's triangle list.
11. IF `MeshBVH` construction or PCA_Axes computation fails for a Part, or produces a non-finite axis component, OBB center coordinate, or half-extent, THEN THE Core_Engine SHALL reject the solve with an error that identifies the Part_ID and the failing Stage 1 component, and SHALL NOT return a Disassembly_Plan.

### Requirement 10: Stage 1 candidate extraction axes

**User Story:** As a solver maintainer, I want each Part to have a fixed set of candidate directions plus its own local axes, so that both world-aligned and Part-aligned extractions are considered.

#### Acceptance Criteria

1. THE Axis_Generator SHALL produce the 26 Canonical_Directions as pairwise-distinct vectors. Each one SHALL be a nonzero vector whose components are each in {−1, 0, +1}, divided by its Euclidean length. The set SHALL contain 6 face directions (±X, ±Y, ±Z, exactly one nonzero component), 12 edge diagonals (exactly two nonzero components), and 8 corner diagonals (exactly three nonzero components).
2. THE Axis_Generator SHALL produce exactly 32 Candidate_Axes for each Part: the 26 Canonical_Directions plus the positive and negative direction of each of the Part's 3 PCA_Axes. A PCA_Axes direction SHALL be kept even when it matches a Canonical_Direction within `1e-9` per component.
3. THE Axis_Generator SHALL order each Part's Candidate_Axes as follows. Indices 0 to 25 SHALL hold the 26 Canonical_Directions in the same fixed order for every Part: the face directions first in the order +X, −X, +Y, −Y, +Z, −Z, then the 12 edge diagonals, then the 8 corner diagonals. Indices 26 to 31 SHALL hold +PCA1, −PCA1, +PCA2, −PCA2, +PCA3, −PCA3, where PCA1, PCA2 and PCA3 are the Part's PCA_Axes sorted by descending variance of the Part's vertices along each axis.
4. THE Axis_Generator SHALL produce every Candidate_Axis with three finite components and a Euclidean length equal to 1 within `1e-9`.
5. THE Axis_Generator SHALL produce each Part's 3 PCA_Axes so that the absolute value of the dot product of every pair of PCA_Axes is at most `1e-9`.
6. WHEN the Axis_Generator runs twice on the same Assembly with the same Solver_Config, THE Axis_Generator SHALL produce Candidate_Axes for every Part that are identical in count, in order, and in the bit-for-bit value of every component.
7. IF a Part's vertex distribution is degenerate (all vertices coincident, collinear, or coplanar, or the Part has a Tied_Eigenspace), THEN THE Axis_Generator SHALL still produce 3 PCA_Axes, resolved with the Intrinsic_Frame_Rule of Requirement 9 criteria 5 and 6 and without any fixed world-space direction except under the All_Collinear_Assembly exemption of Requirement 9 criterion 7, and 32 Candidate_Axes that meet criteria 3, 4, 5 and 6, without throwing an exception and without producing any non-finite component.

### Requirement 11: Stage 2 OBB pair pruning

**User Story:** As a solver maintainer, I want Part pairs that cannot interact along a direction to be skipped cheaply, so that ray casting focuses on pairs that can actually block.

#### Acceptance Criteria

1. WHEN the DBG_Builder evaluates an ordered Part pair `(A, B)` with A ≠ B along a direction `d` taken from A's Candidate_Axes, THE DBG_Builder SHALL project the OBBs of A and B onto `d` and onto the plane perpendicular to `d`, using the Assembly coordinates after the Normalizer has applied the Normalization_Transform (`maxExtent = 1.0`).
2. IF the OBB projection of B onto the plane perpendicular to `d` and the OBB projection of A onto that plane are separated by a gap strictly greater than 1e-9 normalized units, THEN THE DBG_Builder SHALL classify the pair `(A, B, d)` as non-blocking, cast zero rays for that pair, and record no Blocking_Edge `(A, B, d)`. Projections that touch, or that are separated by 1e-9 normalized units or less, SHALL count as overlapping. This rule also applies when either OBB has a zero-length extent.
3. IF the maximum projection of B's OBB onto `d` is less than the minimum projection of A's OBB onto `d` by strictly more than 1e-9 normalized units, THEN THE DBG_Builder SHALL classify the pair `(A, B, d)` as non-blocking, cast zero rays for that pair, and record no Blocking_Edge `(A, B, d)`. Projection intervals that are equal at the boundary, or within 1e-9 normalized units of each other, SHALL NOT be pruned by this rule.
4. WHEN the DBG_Builder is run twice on the same Assembly whose Parts are all Watertight_Solid_Parts (closed, outward-wound, and thicker than the active Micro_Shrink) with the same Solver_Config, once with OBB pruning enabled and once with OBB pruning disabled, THE DBG_Builder SHALL produce identical Blocking_Graphs in both runs (pruning soundness). Identical means the same set of `(A, B, d)` triples and the same clashing triangle indices on both Parts for every Blocking_Edge. Pruning soundness is guaranteed only under this precondition, and the `1e-9` margins of criteria 2 and 3 apply unchanged.
5. WHEN a pair `(A, B, d)` is not classified as non-blocking by criterion 2 or criterion 3, THE DBG_Builder SHALL cast the bidirectional swept rays for that pair and determine Blocking_Edges from Opposing_Normal_Collisions, using the configured Micro_Shrink, Clearance_Epsilon, and Tau.
6. THE Core_Engine test suite SHALL verify criterion 4, comparing a run with OBB pruning enabled against a run with OBB pruning fully disabled over every Candidate_Axis of every Part, on exactly these fixed Assemblies: the 2 Deadlock_Cages, the Haunted Clockwork Lockbox, the 3-Stage Planetary Gearbox, and the Keyboard_Fixture. Every Part of these Assemblies is a Watertight_Solid_Part under the default Solver_Config (Requirement 22 criterion 16). THE Core_Engine test suite SHALL NOT run the DBG_Builder with OBB pruning disabled on the full default 65% Mechanical Keyboard layout.
7. THE Core_Engine test suite SHALL also verify criterion 4 with a `fast-check` property test that uses an explicit seed and a Seeded_PRNG, runs at least 100 generated Assemblies, limits every generated Assembly to at least 2 and at most 8 Parts, and generates only Assemblies whose Parts are all Watertight_Solid_Parts under the Micro_Shrink of the Solver_Config used for that run.
8. WHEN the DBG_Builder evaluates the same pair `(A, B, d)` with the same Assembly and Solver_Config across repeated runs, THE DBG_Builder SHALL make the same pruning classification (pruned or not pruned) in every run.

### Requirement 12: Stage 2 bidirectional swept-ray sampling

**User Story:** As a solver maintainer, I want blocking detected from both Parts of a pair, so that a thin Part cannot slip through gaps between one-sided samples.

#### Acceptance Criteria

1. WHEN the DBG_Builder evaluates an unpruned Part pair `(A, B)` along direction `d`, THE DBG_Builder SHALL cast exactly N rays into the `MeshBVH` of B only. N is the configured samples per Part per direction. Each ray starts at one stratified surface sample of A, with its origin moved inward by Micro_Shrink opposite the sampled triangle's face normal, and travels along `+d`.
2. WHEN the DBG_Builder evaluates an unpruned Part pair `(A, B)` along direction `d`, THE DBG_Builder SHALL cast exactly N rays into the `MeshBVH` of A only. N is the configured samples per Part per direction. Each ray starts at one stratified surface sample of B, with its origin moved inward by Micro_Shrink opposite the sampled triangle's face normal, and travels along `-d`.
3. WHEN at least one ray from criterion 1 produces an Opposing_Normal_Collision evaluated with `dir = +d`, or at least one ray from criterion 2 produces an Opposing_Normal_Collision evaluated with `dir = -d`, THE DBG_Builder SHALL record exactly one Blocking_Edge `(A, B, d)` for that pair and direction, including when both ray sets produce collisions.
4. THE DBG_Builder SHALL generate the N stratified surface samples of a Part by dividing the Part's cumulative triangle-area range into N equal-width strata and drawing exactly one sample per stratum, so that triangles are selected in proportion to their area and zero-area triangles are never selected. The DBG_Builder SHALL draw every random value, both the position within a stratum and the point within the selected triangle, from the Seeded_PRNG initialized with the Solver_Config seed.
5. THE DBG_Builder SHALL record in each Blocking_Edge two non-empty lists of triangle indices, each sorted in ascending order with no duplicates and indexing into that Part's own triangle list. A's list holds the source triangles of A-origin rays that produced an Opposing_Normal_Collision plus the A triangles hit by B-origin rays that produced an Opposing_Normal_Collision. B's list holds the B triangles hit by A-origin rays that produced an Opposing_Normal_Collision plus the source triangles of B-origin rays that produced an Opposing_Normal_Collision.
6. IF no ray from criterion 1 or criterion 2 produces an Opposing_Normal_Collision, including when every hit is discarded because it is below Clearance_Epsilon or fails the Tau test, THEN THE DBG_Builder SHALL NOT record a Blocking_Edge `(A, B, d)`.
7. WHEN the DBG_Builder runs twice on the same Assembly with identical Solver_Config values, including the same PRNG seed, THE DBG_Builder SHALL produce identical sample positions, identical sets of Blocking_Edges, and identical triangle index lists in every Blocking_Edge.
8. IF the configured samples per Part per direction is not an integer greater than or equal to 1 when the DBG_Builder stage function is called directly, THEN THE DBG_Builder SHALL throw an error indicating an invalid sample count before casting any ray, and SHALL NOT return a Blocking_Graph. This is a defensive stage-level check: the pipeline entry function rejects such a value earlier through the Requirement 2 configuration validation and returns a configuration error instead of throwing, consistent with Requirement 30 criterion 7.

### Requirement 13: Stage 2 hit classification

**User Story:** As a solver maintainer, I want grazing and coincident hits filtered, so that a screw shaft sliding inside a countersunk hole does not create a false Blocking_Edge.

#### Acceptance Criteria

1. WHEN the DBG_Builder creates a ray from a surface sample on a Part's triangle, THE DBG_Builder SHALL place the ray origin at the sample point moved by exactly Micro_Shrink, measured in normalized Assembly coordinates (`maxExtent = 1.0`), along the negation of that triangle's unit-length outward face normal, with an absolute positional tolerance of 1e-9.
2. IF a ray hit lies at a distance from the micro-shrunk origin, measured in normalized Assembly coordinates along the unit ray direction, that is strictly less than Clearance_Epsilon, THEN THE DBG_Builder SHALL discard the hit so that it contributes to no Blocking_Edge.
3. IF a ray hit satisfies `dot(hitNormal, dir) >= -tau`, where `hitNormal` is the unit-length outward face normal of the hit triangle derived from its world-space vertex winding and `dir` is the unit Candidate_Axis being evaluated, THEN THE DBG_Builder SHALL discard the hit as grazing or back-facing so that it contributes to no Blocking_Edge.
4. WHEN a ray hit against a triangle of a Part other than the ray's source Part satisfies `dot(hitNormal, dir) < -tau` and lies at a distance of at least Clearance_Epsilon from the micro-shrunk origin, THE DBG_Builder SHALL classify the hit as an Opposing_Normal_Collision.
5. WHEN the DBG_Builder casts a ray, THE DBG_Builder SHALL collect every intersection along the full ray, without `firstHitOnly: true` or any other nearest-hit-only query. THE DBG_Builder SHALL then discard own-Part hits (criterion 8), hits closer than Clearance_Epsilon (criterion 2), and grazing or back-facing hits with `dot(hitNormal, dir) >= -tau` (criterion 3), and SHALL classify only the nearest remaining hit as that ray's Opposing_Normal_Collision.
6. WHEN a ray cast from Part A along `d` meets a triangle of Part B that is coincident (closer than Clearance_Epsilon) or grazing (`dot(hitNormal, dir) >= -tau`) before it meets a farther triangle of Part B whose hit satisfies criterion 4, THE DBG_Builder SHALL record the Blocking_Edge `(A, B, d)` and SHALL include the index of that farther opposing triangle in B's clashing triangle list (no masking by discarded hits).
7. WHEN a cylindrical screw shaft Part sits coaxially inside a countersunk-hole Part with radial clearance of at least Clearance_Epsilon plus Micro_Shrink and is evaluated along the screw's outward axis direction (the axis direction pointing from the shaft tip toward the screw head), THE DBG_Builder SHALL record no Blocking_Edge from the countersunk-hole Part against the screw shaft Part, for every Tau value in `[0, 1)`.
8. IF a ray hit lands on a triangle that belongs to the ray's own source Part, THEN THE DBG_Builder SHALL discard the hit, so that the Blocking_Graph never contains a Blocking_Edge `(A, A, d)` for any Part A and any direction `d`.
9. IF a sampled triangle has zero area, so that its outward face normal is undefined, THEN THE DBG_Builder SHALL cast no ray from that triangle, SHALL continue processing the remaining triangles of the Part without throwing, and SHALL compute no hit classification from that triangle.
10. WHEN a box-shaped Part A is evaluated along direction `d` and a second Part B has a face perpendicular to `d` whose outward normal points opposite `d`, lying in A's path at a gap of at least Clearance_Epsilon plus Micro_Shrink, with Tau below 1, THE DBG_Builder SHALL record a Blocking_Edge `(A, B, d)` that contains at least one clashing triangle index on Part A and at least one on Part B.

### Requirement 14: Stage 3 Kahn topological peel

**User Story:** As a consumer developer, I want Parts removed one at a time along an unblocked direction, so that the resulting plan is collision-free by construction.

#### Acceptance Criteria

1. WHILE unremoved Parts remain, THE Peel_Solver SHALL classify a Part as removable if and only if at least one of the Part's Candidate_Axes `d` has zero Blocking_Edges `(Part, B, d)` where B is an unremoved Part other than the Part itself, and SHALL ignore all Blocking_Edges whose blocking Part B has already been removed.
2. WHILE at least one removable Part exists, THE Peel_Solver SHALL, in each iteration, select exactly one removable Part using the tie-break rules of Requirement 15, append one Plan_Step for the selected Part to the end of the Plan_Step list, and mark the selected Part as removed before the next iteration begins, so that Plan_Step position 0 is the first Part removed.
3. WHEN the Peel_Solver selects a Part, THE Peel_Solver SHALL set the Plan_Step `dir` to the unblocked Candidate_Axis of that Part with the smallest Escape_Distance, computed against only the Parts that are still unremoved. THE Peel_Solver SHALL treat every unblocked axis whose Escape_Distance is within `1e-9` of the smallest Escape_Distance as identical, and SHALL choose among those axes the one that comes first in the Part's Candidate_Axes order.
4. THE Peel_Solver SHALL emit every Plan_Step with a `dir` equal to one of that Part's Candidate_Axes, a Euclidean length of `dir` within 1e-6 of 1.0, and an Escape_Distance that is finite and greater than or equal to 0.
5. WHEN all Parts are removed, THE Peel_Solver SHALL return a Disassembly_Plan with `status === 'solved'`, exactly one Plan_Step per Part in the Assembly, no Deadlock_Witness, the Normalization_Transform, and the Sampling_Metadata.
6. FOR ALL solved Disassembly_Plans, each Part_ID of the Assembly SHALL appear in exactly one Plan_Step, and the Plan_Step list SHALL contain no Part_ID absent from the Assembly (permutation invariant).
7. FOR ALL Plan_Steps at position `i` of a Disassembly_Plan, the Blocking_Graph SHALL contain no Blocking_Edge `(partId, B, dir)` for any Part B whose Plan_Step is at a position greater than `i`, and no such Blocking_Edge for any Part B left unremoved in a deadlocked plan (dependency-order validity).
8. IF exactly one unremoved Part remains, THEN THE Peel_Solver SHALL classify that Part as removable along every one of its Candidate_Axes, set its Plan_Step `dir` to the first axis in its Candidate_Axes order, and set its Escape_Distance to 0.
9. WHEN the Peel_Solver runs more than once on the same Assembly, Blocking_Graph, and Solver_Config, THE Peel_Solver SHALL produce identical Plan_Step lists, with the same Part_IDs, `dir` vectors, and Escape_Distance values in the same order.
10. THE Peel_Solver SHALL set the `secondary` field of every Plan_Step it emits to `null`. Plan_Steps with a non-null `secondary` field come only from consumers or tests (Requirement 19 criterion 10).
11. WHEN `stage3Peel` has selected a Part A and its axis `d` (index `k`) by criteria 2 and 3 and at least one other Part is unremoved, THE Peel_Solver SHALL verify the move before appending its Plan_Step (lazy exact step verification). For every unremoved Part B other than A whose AABB, grown by Micro_Shrink plus `1e-9` like A's, is reached by A's grown AABB swept along `+d`, the verifier SHALL cast one ray along `+d` into B from every welded vertex and every positive-area triangle centroid of A, and one ray along `−d` into A from every welded vertex and every positive-area triangle centroid of B. Each vertex origin SHALL be moved Micro_Shrink against the normalized area-weighted sum of its incident face normals, or against the normal of its largest incident face when that sum has length at most `1e-12`, and each centroid origin SHALL be moved Micro_Shrink against its face normal. Hits SHALL be collected and filtered by the rules of Requirement 13 criteria 2 to 6, using the DBG_Builder's own ray caster and hit filter and not the Clash_Checker. IF any ray between A and B produces an Opposing_Normal_Collision, THEN THE Peel_Solver SHALL add the Blocking_Edge `(A, B, k)` with sorted, duplicate-free `fromTriangles` and `toTriangles` to the edges it peels with and to the edges the SCC_Analyzer of Requirement 16 sees, SHALL NOT append a Plan_Step for A in that iteration, and SHALL repeat the iteration from criterion 1. Each repetition adds at least one `(A, B, k)` triple absent before, so the peel terminates. The verifier SHALL be deterministic, SHALL compute each Part's ray sources at most once per `stage3Peel` call, and SHALL NOT change the Blocking_Graph returned by Stage 2 or its `stats`. `runPeel` called without a verifier SHALL behave as criteria 1 to 10 describe.

### Requirement 15: Stage 3 peel tie-breaking

**User Story:** As an end user of a consumer app, I want outer fasteners and covers removed before internal boards, so that the plan reads like a real teardown.

#### Acceptance Criteria

1. WHEN more than one Part is removable in a Peel_Solver iteration, THE Peel_Solver SHALL select one Part with a per-component tolerance cascade: starting with the candidate set equal to all removable Parts, for each key component (a) to (d) of criterion 2 in priority order, keep only the candidates whose value of that component is within the tolerance of criterion 3 of the best value of that component among the candidates that remain at that step, comparing Fastener classification exactly (Fastener Parts are kept whenever at least one remains); after component (d), select the remaining candidate with the smallest Part_ID by UTF-16 code-unit order (component (e)). Because each step compares against one best value, the cascade cannot form comparison cycles and always yields exactly one Part.
2. THE Peel_Solver SHALL build each removable Part's tie-break key from these components, in priority order: (a) Fastener classification, with Fastener Parts ordered before non-Fastener Parts; (b) Slenderness, descending; (c) Radial_Exposure, descending; (d) Escape_Distance along the removal direction that Requirement 14 criterion 3 would choose for that Part, ascending; (e) Part_ID, ascending by UTF-16 code unit order, independent of locale.
3. WHEN the Peel_Solver applies a cascade step of criterion 1 to the Slenderness, Radial_Exposure, or Escape_Distance component, THE Peel_Solver SHALL keep a candidate if and only if the absolute difference between its value and the best value is at most 1e-9, where the best value is the maximum Slenderness, the maximum Radial_Exposure, or the minimum Escape_Distance among the remaining candidates. WHEN the best Slenderness is positive infinity, THE Peel_Solver SHALL keep exactly the candidates whose Slenderness is positive infinity. Radial_Exposure and Escape_Distance are measured in the normalized coordinates where `maxExtent = 1.0`.
4. WHEN a Peel_Solver iteration begins, THE Peel_Solver SHALL recompute Slenderness, Radial_Exposure, and Escape_Distance for every removable Part using only the Parts still unremoved at the start of that iteration. The Radial_Exposure centroid SHALL exclude all previously removed Parts. Each Escape_Distance SHALL be measured against the union of the other unremoved Parts only.
5. IF both shorter OBB extents of a Part equal 0, THEN THE Peel_Solver SHALL treat that Part's Slenderness as positive infinity for tie-break comparison, so that no tie-break key component is NaN.
6. THE Peel_Solver SHALL derive every tie-break value from Part geometry and from the Solver_Config Fastener symmetry tolerance and Fastener slenderness threshold only, with no per-kit, per-Part_ID, or per-source-node-name overrides.
7. FOR ALL Disassembly_Plans and every Plan_Step at position `i`, the Part in Plan_Step `i` SHALL be the Part that the tolerance cascade of criteria 1 and 3 selects from the Parts removable at the start of iteration `i`, with key components computed per criteria 2, 4, and 5: the Part survives every cascade step (a) to (d), and has the smallest Part_ID by UTF-16 code-unit order among the Parts that survive step (d) (tie-break optimality invariant).
8. WHEN the Core_Engine solves the same input `Object3D` hierarchy twice with identical Solver_Config values, THE Peel_Solver SHALL produce the same sequence of Plan_Step Part_IDs and removal directions both times.

### Requirement 16: Stage 3 Tarjan deadlock witness

**User Story:** As a consumer developer, I want a minimal, triangle-level explanation when an Assembly cannot be taken apart, so that my app can highlight exactly which Parts interlock.

#### Acceptance Criteria

1. IF no removable Part exists while at least one unremoved Part remains, THEN THE Peel_Solver SHALL return a Disassembly_Plan with `status === 'deadlocked'`, a DeadlockWitness, the Normalization_Transform, the Sampling_Metadata, and the Plan_Steps completed so far. The Plan_Steps SHALL be listed in the order the Parts were peeled, and their count SHALL equal the number of Parts removed before the deadlock.
2. WHEN the Peel_Solver reports `status === 'deadlocked'`, THE SCC_Analyzer SHALL run Tarjan's Strongly Connected Components algorithm on the union, over all Candidate_Axes, of the Blocking_Edges whose two Parts are both unremoved.
3. WHEN the SCC_Analyzer completes, THE SCC_Analyzer SHALL include in the DeadlockWitness every SCC that contains at least 2 Parts and has no Blocking_Edge `(A, B, d)` with A inside that SCC and B an unremoved Part outside that SCC. Part_IDs within each SCC SHALL be listed in ascending order by code-unit string comparison. SCCs SHALL be ordered by their smallest Part_ID in the same ascending order.
4. WHEN the SCC_Analyzer includes an SCC in the DeadlockWitness, THE SCC_Analyzer SHALL include every Blocking_Edge `(A, B, d)` in which both A and B belong to that SCC. Each such edge SHALL record the Part_IDs of A and B, the unit direction `d`, and at least 1 clashing triangle index on each of A and B. Each index SHALL be unique within its list and lie in the range 0 to that Part's triangle count minus 1.
5. WHEN the SCC_Analyzer completes, THE SCC_Analyzer SHALL list in the DeadlockWitness, in ascending Part_ID order, each unremoved Part that belongs to no reported SCC, exactly once. The union of this list and the Parts of all reported SCCs SHALL equal the set of unremoved Parts, and the two SHALL share no Part.
6. THE SCC_Analyzer SHALL produce a DeadlockWitness in which, for every Part in a reported SCC and for every Candidate_Axis of that Part, at least one Blocking_Edge runs from that Part to another Part of the same SCC along that direction (witness completeness).
7. IF the SCC_Analyzer finds no SCC that meets the conditions of criterion 3, THEN THE Core_Engine SHALL throw an error indicating that the deadlock witness invariant was violated. It SHALL NOT return a Disassembly_Plan with an empty DeadlockWitness.
8. WHEN the Core_Engine is run twice on the same Assembly with the same Solver_Config, THE Core_Engine SHALL return the same DeadlockWitness both times: the same SCCs, Part_IDs, Blocking_Edges, directions, clashing triangle indices, and order.
9. WHEN the Core_Engine solves an Assembly produced by a Deadlock_Cage Kit_Builder with its default Solver_Config, THE Peel_Solver SHALL return a Disassembly_Plan with `status === 'deadlocked'`, 0 Plan_Steps, and a DeadlockWitness containing at least 1 SCC.

### Requirement 17: Stage 4 motion primitives registry

**User Story:** As a solver maintainer, I want motion primitives registered behind one extensible interface, so that new primitives can be added (and later auto-wired by Kiro hooks) without changing the Trajectory_Compiler.

#### Acceptance Criteria

1. THE Core_Engine SHALL place the Primitive_Registry and every built-in Motion_Primitive under `packages/unbolt-core/src/primitives/`, with one source file per Motion_Primitive.
2. WHEN a Primitive_Registry is created, THE Primitive_Registry SHALL contain exactly the 3 built-in Motion_Primitives `linear_slide`, `helical_unscrew`, and `two_step_l_slide`, and no other Motion_Primitive.
3. THE Primitive_Registry SHALL require each Motion_Primitive to declare five members: a name of 1 to 64 characters that starts with a lowercase ASCII letter and contains only lowercase ASCII letters, digits, and underscores; a priority that is a finite number; an applicability predicate that takes a Plan_Step and its Part and returns a boolean; a parameter builder that takes a Plan_Step and its Part and returns that primitive's parameters; and a pose function that maps `t` in `[0, 1]` to an SE3_Transform.
4. WHEN a Motion_Primitive whose name is not yet registered is registered, THE Primitive_Registry SHALL return that Motion_Primitive for every later lookup that uses the exact, case-sensitive name, and SHALL include it in the listing defined in criterion 7.
5. IF a Motion_Primitive is registered under a name that exactly matches (case-sensitive) an already registered name, THEN THE Primitive_Registry SHALL return a duplicate-name error that names the conflicting primitive, SHALL keep the existing registration, and SHALL leave the registry's contents and listing order unchanged.
6. IF a lookup requests a name that is not registered, THEN THE Primitive_Registry SHALL return an unknown-primitive error that names the requested primitive, and SHALL leave the registry's contents unchanged.
7. THE Primitive_Registry SHALL list registered Motion_Primitives sorted first by descending priority and then by ascending name using UTF-16 code-unit comparison, so that the listing for a given set of registered Motion_Primitives is identical whatever order they were registered in.
8. IF a Motion_Primitive is registered with a missing member, a name that breaks the format in criterion 3, or a priority that is `NaN`, `Infinity`, or `-Infinity`, THEN THE Primitive_Registry SHALL return an invalid-primitive error that names the missing or invalid member, and SHALL leave the registry's contents unchanged.
9. WHEN the Trajectory_Compiler requests a Motion_Primitive for a Plan_Step and its Part, THE Primitive_Registry SHALL return the first Motion_Primitive in the listing order of criterion 7 whose applicability predicate returns `true` for that Plan_Step and Part.
10. IF no registered Motion_Primitive's applicability predicate returns `true` for a requested Plan_Step and Part, THEN THE Primitive_Registry SHALL return a no-applicable-primitive error that names the Plan_Step's Part_ID.

### Requirement 18: Built-in motion primitive behavior

**User Story:** As a consumer developer, I want each built-in primitive to produce a well-defined rigid motion, so that apps can animate steps faithfully.

#### Acceptance Criteria

1. WHEN any Motion_Primitive is evaluated at `t = 0` with valid parameters, THE Motion_Primitive SHALL return a pose whose rotation matrix differs from the 3×3 identity matrix by at most `1e-9` in every element and whose translation vector has every component within `1e-9` of 0.
2. WHEN any Motion_Primitive is evaluated at any `t` in the closed interval `[0, 1]` with valid parameters, THE Motion_Primitive SHALL return an SE3_Transform whose rotation matrix `R` satisfies: every element of `Rᵀ·R − I` is within `1e-9` of 0, and `det(R)` is within `1e-9` of 1.
3. WHEN the `linear_slide` primitive is evaluated at `t` in `[0, 1]` with a unit step direction `dir` and a step distance `s`, THE `linear_slide` primitive SHALL return a pose whose rotation matrix matches the identity matrix within `1e-9` in every element and whose translation vector equals `t · s · dir` within `1e-9` in every component.
4. WHEN the `helical_unscrew` primitive is evaluated at `t` in `[0, 1]` with a unit step direction `dir`, a step distance `s`, and a thread pitch `p` taken from the Solver_Config thread pitch (Requirement 2), THE `helical_unscrew` primitive SHALL return the pose that first rotates the Part by angle `θ(t) = 2π · t · s / p` radians, positive by the right-hand rule, about the Part's principal PCA_Axes vector (sign chosen so that its dot product with `dir` is non-negative) through the Part's OBB center, and then translates it by `t · s · dir`, with each pose matrix element within `1e-9` of that reference pose.
5. WHEN the `two_step_l_slide` primitive is evaluated with unit first direction `d1`, first distance `s1`, unit second direction `d2`, and second distance `s2`, THE `two_step_l_slide` primitive SHALL return a pose whose rotation matrix matches the identity matrix within `1e-9` in every element, and whose translation vector is within `1e-9` in every component of `(2t) · s1 · d1` for `t` in `[0, 0.5]` and of `s1 · d1 + (2t − 1) · s2 · d2` for `t` in `(0.5, 1]`.
6. WHEN the `linear_slide` or `helical_unscrew` primitive is evaluated at `t = 1` with step direction `dir` and step distance `s`, THE Motion_Primitive SHALL return a pose that maps the Part's OBB center to a point within `1e-9`, in every component, of the OBB center plus `s · dir`.
7. IF a Motion_Primitive is evaluated with a `t` that is less than 0, greater than 1, or not a finite number, THEN THE Motion_Primitive SHALL reject the call with an error indicating that `t` is out of range, and SHALL NOT return a pose.
8. IF a Motion_Primitive is evaluated with invalid parameters, THEN THE Motion_Primitive SHALL reject the call with an error naming the invalid parameter, and SHALL NOT return a pose. Invalid parameters are: a direction vector whose length differs from 1 by more than `1e-9`, a distance that is negative or not finite, a thread pitch that is not finite or is less than or equal to 0, or, for `two_step_l_slide`, directions `d1` and `d2` whose absolute dot product exceeds `1e-9`.

### Requirement 19: Stage 4 trajectory compiler

**User Story:** As a consumer developer, I want the peel order compiled into a ready-to-animate step list, so that apps do not reimplement motion logic.

#### Acceptance Criteria

1. WHEN a Disassembly_Plan with `status === 'solved'` is provided, THE Trajectory_Compiler SHALL return exactly one Trajectory_Step per Plan_Step, in the same order as the Plan_Steps. A plan with 0 Plan_Steps SHALL produce an empty list. The Trajectory_Compiler SHALL leave the input Disassembly_Plan unmodified.
2. WHEN the Trajectory_Compiler compiles a Plan_Step, THE Trajectory_Compiler SHALL output a Trajectory_Step with three fields: a Part_ID equal to the Plan_Step's Part_ID, the name of the selected Motion_Primitive, and the parameters returned by that Motion_Primitive's parameter builder for that Plan_Step and its Part.
3. WHEN the Trajectory_Compiler compiles a Plan_Step, THE Trajectory_Compiler SHALL select, from the Motion_Primitives whose applicability predicate returns `true`, the one with the greatest priority number. IF two or more of those Motion_Primitives have equal priority numbers, THEN THE Trajectory_Compiler SHALL select the one whose name comes first in ascending string order.
4. WHEN the Part of a Plan_Step is a Fastener and the angle between the step direction and either sign of the Part's principal PCA axis is at most the configured helical angular tolerance, THE `helical_unscrew` applicability predicate SHALL return `true`. The tolerance is the Solver_Config helical angular tolerance (Requirement 2), set in degrees, defaults to 5 degrees, and must be greater than 0 and less than 90 degrees.
5. WHEN a Plan_Step has a non-null `secondary` field, THE `two_step_l_slide` applicability predicate SHALL return `true`.
6. THE `linear_slide` applicability predicate SHALL return `true` for every Plan_Step.
7. IF a Disassembly_Plan with `status` other than `'solved'` is provided, THEN THE Trajectory_Compiler SHALL return an error that states the received status and SHALL return no Trajectory_Steps.
8. IF the Part of a Plan_Step is not a Fastener, or the angle between the step direction and both signs of the Part's principal PCA axis is greater than the configured helical angular tolerance, THEN THE `helical_unscrew` applicability predicate SHALL return `false`.
9. IF a Plan_Step has `secondary: null`, THEN THE `two_step_l_slide` applicability predicate SHALL return `false`.
10. WHERE a consumer or test supplies a solved Disassembly_Plan containing a Plan_Step with a non-null `secondary` field, THE Trajectory_Compiler SHALL apply criteria 3 and 5 to that Plan_Step, so that `two_step_l_slide`, which stays registered under Requirement 17 criterion 2, is selected for that Plan_Step whenever it is the highest-priority applicable Motion_Primitive. Plan_Steps emitted by the Peel_Solver always have `secondary: null` (Requirement 14 criterion 10), so `two_step_l_slide` applies only to such consumer- or test-supplied Plan_Steps.

### Requirement 20: Clash checking oracle

**User Story:** As a test author, I want an independent clash counter, so that solver validity is checked against a second method rather than against the DBG_Builder itself.

#### Acceptance Criteria

1. WHEN a test calls the Clash_Checker with a moving Part, a unit direction, a set of 0 or more static Parts, and a Solver_Config, THE Clash_Checker SHALL return three things: the total count of Opposing_Normal_Collisions; the colliding triangle indices on the moving Part; and, for each static Part_ID with at least 1 collision, the colliding triangle indices on that static Part. Each index list SHALL be sorted ascending with no duplicates, and an empty static set SHALL produce a count of 0 and empty index lists.
2. THE Clash_Checker SHALL cast exactly one ray from every vertex and from every triangle centroid of the moving Part along the direction. It SHALL also cast exactly one ray from every vertex and from every triangle centroid of each static Part along the negated direction. The only exceptions are the vertices and centroids from which criterion 6 casts no ray, and every ray origin SHALL be micro-shrunk as defined in criteria 3 to 5. Every ray SHALL have no maximum length. Rays from the moving Part SHALL be tested only against the static Parts' triangles, rays from a static Part SHALL be tested only against the moving Part's triangles, and hits on the ray's own Part SHALL be ignored.
3. WHEN the Clash_Checker casts a ray from a vertex of a Part, THE Clash_Checker SHALL move the ray origin by Micro_Shrink opposite that vertex's normal. The vertex normal is the normalized area-weighted sum of the unit outward face normals of all triangles of the same Part incident to that vertex, where a triangle is incident if one of its corners is the same welded vertex (Requirement 5 criterion 2).
4. IF the area-weighted normal sum of a vertex has length at most `1e-12` and at least one incident triangle has nonzero area, THEN THE Clash_Checker SHALL use the unit outward face normal of the largest-area incident triangle as the vertex normal, choosing the lowest triangle index among triangles of equal area.
5. WHEN the Clash_Checker casts a ray from a triangle centroid, THE Clash_Checker SHALL move the ray origin by Micro_Shrink opposite that triangle's unit outward face normal.
6. IF a triangle has zero area, or every triangle incident to a vertex has zero area, THEN THE Clash_Checker SHALL cast no ray from that triangle's centroid or from that vertex.
7. THE Clash_Checker SHALL count each cast ray as at most 1 Opposing_Normal_Collision, at that ray's nearest hit that meets the Opposing_Normal_Collision definition. The definition SHALL be evaluated against the direction that ray was cast along: the direction for moving-Part rays, the negated direction for static-Part rays.
8. WHEN the Clash_Checker casts a ray, THE Clash_Checker SHALL collect every intersection along the full ray, without a first-hit-only or any other nearest-hit-only query. THE Clash_Checker SHALL then discard own-Part hits, hits closer than Clearance_Epsilon, and grazing or back-facing hits with `dot(hitNormal, dir) >= -tau`, and SHALL count only the nearest remaining hit under criterion 7.
9. WHEN a ray cast by the Clash_Checker meets a coincident (closer than Clearance_Epsilon) or grazing (`dot(hitNormal, dir) >= -tau`) triangle of a target Part before it meets a farther triangle of that Part whose hit meets the Opposing_Normal_Collision definition, THE Clash_Checker SHALL count that ray as 1 Opposing_Normal_Collision and SHALL report the index of the farther opposing triangle (no masking by discarded hits).
10. THE Clash_Checker SHALL take Micro_Shrink, Clearance_Epsilon, and Tau from the Solver_Config passed to it, and SHALL NOT substitute default or adjusted values. When given the same Solver_Config as the DBG_Builder, it SHALL therefore apply the same Micro_Shrink, Clearance_Epsilon, and Tau as the DBG_Builder.
11. THE Clash_Checker SHALL share no sample-generation code with the DBG_Builder's stratified sampler. It SHALL not import the module that contains the stratified sampler, directly or through other modules, and SHALL not use the Seeded_PRNG.
12. IF the direction passed to the Clash_Checker has any non-finite component, or its length differs from 1 by more than 1e-6, THEN THE Clash_Checker SHALL throw an error indicating an invalid direction and SHALL cast no rays.
13. IF the set of static Parts contains a Part whose Part_ID equals the moving Part's Part_ID, THEN THE Clash_Checker SHALL throw an error indicating that the moving Part appears in the static set, and SHALL return no clash count.
14. WHEN the Clash_Checker is called twice with identical moving Part, direction, static Parts, and Solver_Config, THE Clash_Checker SHALL return the same clash count and the same index lists both times.

### Requirement 21: Naive radial explosion baseline

**User Story:** As a consumer developer, I want to compare a naive radial explosion against the UnboltKit DBG plan, so that my app can show why dependency-ordered disassembly matters.

#### Acceptance Criteria

1. THE Core_Engine SHALL export a function named `computeNaiveRadialClashes()` from the `@unboltkit/core` package entry point.
2. WHEN `computeNaiveRadialClashes()` is called with an Assembly produced by the Normalizer and a Solver_Config, THE Naive_Baseline SHALL assign each Part a radial direction equal to the unit vector from the Assembly centroid to the Part's OBB center, where the Assembly centroid is the arithmetic mean of the OBB centers of all Parts in the Assembly.
3. IF a Part's OBB center lies within a Euclidean distance of `1e-9` (in normalized coordinates) of the Assembly centroid, THEN THE Naive_Baseline SHALL assign that Part the `+Y` direction, the unit vector `(0, 1, 0)`.
4. WHEN radial directions have been assigned, THE Naive_Baseline SHALL evaluate each Part's radial direction against all other Parts held at their original normalized positions, using the Clash_Checker with only the Micro_Shrink, Clearance_Epsilon, and Tau values from the supplied Solver_Config.
5. WHEN the evaluation completes, THE Naive_Baseline SHALL return: a clash count for every Part in the Assembly, keyed by Part_ID and including Parts with a count of 0; for each counted clash, the Part_ID of the obstructing Part and the clashing triangle index on both the moving Part and the obstructing Part; and a total clash count equal to the sum of the per-Part clash counts.
6. FOR ALL solved Disassembly_Plans, evaluating each Plan_Step's `dir` with the Clash_Checker, using the same Solver_Config, against only the Parts not removed by earlier Plan_Steps (excluding the Plan_Step's own Part) SHALL report a total clash count of 0, which consumers can display alongside the Naive_Baseline total.
7. IF `computeNaiveRadialClashes()` is called with an Assembly whose axis-aligned bounding-box `maxExtent` differs from `1.0` by more than `1e-6`, THEN THE Naive_Baseline SHALL throw an error indicating that the Assembly is not normalized and reporting the measured `maxExtent`, and SHALL return no partial clash result.
8. WHEN `computeNaiveRadialClashes()` is called twice with the same Assembly and the same Solver_Config, THE Naive_Baseline SHALL return identical per-Part clash counts, identical clashing triangle indices in identical order, and an identical total clash count.
9. WHEN `computeNaiveRadialClashes()` returns or throws, THE Naive_Baseline SHALL leave every Part's triangles, positions, and Part_ID in the input Assembly unchanged from their values before the call.

### Requirement 22: Sample kits common properties

**User Story:** As a consumer developer, I want license-clean, deterministic procedural assemblies, so that demos and tests work offline with no third-party assets.

#### Acceptance Criteria

1. THE Sample_Kits SHALL export one Kit_Builder per kit. Each Kit_Builder SHALL be callable with no arguments, which uses that kit's documented default parameters. Each call SHALL return a `THREE.Group` that has at least 2 descendant `THREE.Mesh` nodes, and these Mesh nodes are the kit's Parts.
2. THE Sample_Kits SHALL give every descendant `THREE.Mesh` a `BufferGeometry` with a `position` attribute, a `normal` attribute, and an index buffer. Each such geometry SHALL contain at least 1 triangle, and none of its position or normal components SHALL be `NaN` or infinite.
3. THE Sample_Kits SHALL generate all kit geometry and materials in code. A Kit_Builder SHALL NOT load files, textures, image maps, fonts, or network resources, and SHALL make no I/O call at import time or when called.
4. THE Sample_Kits SHALL build every gear, case, frame, plate, keycap, housing, carrier, box body, and lid Part of each showcase kit with `ExtrudeGeometry` or `LatheGeometry`. The kit's remaining Parts MAY use other `three` built-in geometries.
5. THE Sample_Kits SHALL assign every mesh exactly one `MeshStandardMaterial` or `MeshPhysicalMaterial` instance, with no texture map set on that material.
6. THE Sample_Kits SHALL list `three` as its only runtime package dependency, with `@types/three` allowed for types only. Its source SHALL NOT import `three-bvh-csg` or any module outside `three` and the Sample_Kits package itself.
7. THE Sample_Kits SHALL give every mesh node a `name` that is unique within the hierarchy returned by its Kit_Builder. The `name` SHALL be 1 to 64 characters long, contain only lowercase letters, digits, `_`, and `-`, and consist of a role word of at least 3 letters followed by an optional `_<index>` suffix (for example `case_screw_3`).
8. FOR ALL Kit_Builders and valid parameter values, two calls with the same parameters SHALL produce hierarchies with the same node names in the same traversal order. The two hierarchies SHALL also have identical world matrices and byte-identical position, normal, and index buffers. The `uuid` property of `three` objects is excluded from this comparison (determinism).
9. THE Sample_Kits SHALL produce Kit_Builder output that does not depend on `Math.random`, the current date or time, or any other unseeded source of randomness. Any randomness SHALL come from a Seeded_PRNG initialized from an explicit integer seed parameter.
10. IF a Kit_Builder is called with a parameter that is non-finite, of the wrong type, or outside the range documented for that Kit_Builder, THEN THE Sample_Kits SHALL throw an error that names the invalid parameter, and SHALL NOT return a `THREE.Group`.
11. WHEN any Kit_Builder is called with its default parameters, THE Sample_Kits SHALL return an Assembly whose total triangle count across all meshes is at most the Poly_Budget of 150,000 triangles.
12. THE Sample_Kits SHALL import and run every Kit_Builder in a Node.js environment where `window`, `document`, all other DOM APIs, and any WebGL context are undefined, and SHALL complete without throwing.
13. WHEN a showcase Kit_Builder is called with its default parameters, THE Sample_Kits SHALL return an Assembly with at most 60,000 triangles in total.
14. WHEN a Deadlock_Cage Kit_Builder is called with its default parameters, or the 65% Mechanical Keyboard Kit_Builder is called with the Keyboard_Fixture layout, THE Sample_Kits SHALL return an Assembly with at most 10,000 triangles in total.
15. WHEN the Assembly returned by any Kit_Builder called with its default parameters, or the Keyboard_Fixture, is normalized by the Normalizer to `maxExtent = 1.0`, THE Sample_Kits SHALL guarantee by construction that every wall, pin, shaft, and plate of every Part is thicker than 4 times the default Micro_Shrink, that is thicker than `4e-4` normalized units, so that no micro-shrunk ray origin passes through to the opposite face of its source Part. Thickness is the distance from a surface point, along the negated outward face normal, to the nearest other surface of the same Part.
16. THE Sample_Kits SHALL construct every Part of every Kit_Builder output at default parameters, and every Part of the Keyboard_Fixture, as a Watertight_Solid_Part under the default Solver_Config, so that the pruning soundness precondition of Requirement 11 criterion 4 holds for these Assemblies.
17. THE Sample_Kits SHALL construct every Kit_Builder output at default parameters, and the Keyboard_Fixture, with blocking contact areas large enough that every Expected_Blocking_Edge of the Assembly is detected by at least 2 Sample_Rays under the default Solver_Config, including the default of 48 samples per Part per direction.
18. THE Core_Engine test suite SHALL include a kit coverage diagnostic test that, for each Assembly of criterion 17, determines every Expected_Blocking_Edge `(A, B, d)` with the Clash_Checker, counts the Sample_Rays of the pair `(A, B)` along `d` (A-origin rays along `+d` and B-origin rays along `-d`) that produce an Opposing_Normal_Collision under the default Solver_Config, reports the kit name, the edge, and the count for every edge, and fails if any Expected_Blocking_Edge has a count below 2.

### Requirement 23: Showcase sample kits

**User Story:** As a consumer developer, I want three recognizable showcase assemblies, so that apps have engaging, solvable demos.

#### Acceptance Criteria

1. THE Sample_Kits SHALL provide a 65% Mechanical Keyboard Kit_Builder whose output at its default parameters contains, as separate mesh nodes, at least 1 bottom case, 1 top case or frame, 1 PCB, 1 plate, at least 60 keycaps, exactly 1 switch per keycap, and at least 4 case screws, where every case screw satisfies the Fastener definition under the default Solver_Config Fastener thresholds.
2. THE Sample_Kits SHALL provide a 3-Stage Planetary Gearbox Kit_Builder whose output contains, as separate mesh nodes, exactly 3 stages that each have 1 sun gear, at least 3 planet gears, and 1 carrier, plus at least 1 ring gear or housing and at least 2 housing fasteners, where every housing fastener satisfies the Fastener definition under the default Solver_Config Fastener thresholds.
3. THE Sample_Kits SHALL provide a Haunted Clockwork Lockbox Kit_Builder whose output contains, as separate mesh nodes, at least 1 box body, 1 lid, a gear train of at least 2 gears, 1 latch, and at least 2 fasteners, where every fastener satisfies the Fastener definition under the default Solver_Config Fastener thresholds.
4. WHEN the Core_Engine solves the output of any showcase Kit_Builder called with its default parameters, or the Keyboard_Fixture, with the default Solver_Config, THE Core_Engine SHALL return a Disassembly_Plan with `status === 'solved'` that contains exactly one Plan_Step for each Part of the Assembly, with no Part_ID repeated.
5. WHEN the Core_Engine solves the output of the 65% Mechanical Keyboard Kit_Builder called with its default parameters and the default Solver_Config, THE Peel_Solver SHALL place every case screw Plan_Step at a lower index in the ordered Plan_Step list than the PCB Plan_Step.
6. WHEN the Island_Splitter processes the output of any showcase Kit_Builder called with its default parameters and the default Solver_Config, THE Island_Splitter SHALL produce exactly 1 Island per mesh node, so that the Part count equals the mesh node count.
7. WHEN the Core_Engine solves the output of any showcase Kit_Builder called with its default parameters, THE Core_Engine SHALL report a total Assembly triangle count of at most 150,000 and set the Sampling_Metadata Poly_Budget warning flag to `false`.
8. THE Sample_Kits SHALL include in the `name` of every showcase mesh node the component category from criteria 1 to 3 that the node belongs to (for example case screw, PCB, planet gear, latch), so that a test can select all Parts of one category by node name without hardcoded Part_IDs.
9. THE Sample_Kits SHALL give the 65% Mechanical Keyboard Kit_Builder an optional layout parameter that is either the full 65% layout, which is the default, or a rectangular grid given as an integer `rows` from 1 to 5 and an integer `columns` from 1 to 15.
10. WHEN the 65% Mechanical Keyboard Kit_Builder is called with a grid layout of `rows` by `columns`, THE Sample_Kits SHALL return an Assembly sized to that grid that contains, as separate mesh nodes, exactly `rows × columns` keycaps, exactly 1 switch per keycap, 1 bottom case, 1 top case or frame, 1 PCB, 1 plate, and at least 4 case screws that satisfy the Fastener definition under the default Solver_Config Fastener thresholds.
11. THE Sample_Kits SHALL construct every showcase Part at default parameters, and every Part of the Keyboard_Fixture, including keycaps, switches, gears, and screws, as a Frame_Unique_Part, so that each Part's PCA_Axes rotate with the Part under the SE3_Arbitrary. Each such Part SHALL either have three principal variances that pairwise differ by at least 5% of the larger value, or have an intrinsic asymmetric feature, such as a screw head slot, keycap taper, or gear hub offset, that resolves each Tied_Eigenspace under Requirement 9 criterion 5. Each such Part SHALL also have an intrinsic asymmetric feature that decides the signs of its first and second PCA_Axes under Requirement 9 criterion 6, because distinct principal variances alone fix the axis lines but not their signs.
12. THE Sample_Kits SHALL construct every showcase Part at default parameters, and every Part of the Keyboard_Fixture, so that the angle in radians between the Part's Construction_Axis and the nearest of its PCA_Axes (the smallest value of `arccos(|a · PCAk|)` over k = 1, 2, 3) is at most `0.25 × Radial_Clearance / L`, where `L` is the Part's extent along its Construction_Axis, with Radial_Clearance and `L` both measured in normalized units after the Normalizer sets `maxExtent = 1.0`.
13. THE Core_Engine test suite SHALL include a kit-level test that checks criterion 12 for every showcase Part at default parameters and every Part of the Keyboard_Fixture, and that reports the kit name, the mesh node name, the measured angle, and the bound for every Part that exceeds the bound.

### Requirement 24: Adversarial deadlock cages

**User Story:** As a test author, I want assemblies that are provably impossible to disassemble by translation, so that deadlock detection and the Tarjan witness are exercised.

#### Acceptance Criteria

1. THE Sample_Kits SHALL export exactly 2 Deadlock_Cage Kit_Builders, each returning a `THREE.Group` with at least 2 Parts, and the 2 Deadlock_Cages SHALL have geometrically distinct interlocking topologies, meaning they differ in Part count or in the multiset of per-Part triangle counts.
2. THE Sample_Kits SHALL construct each Deadlock_Cage by geometric construction, with no hardcoded Part IDs, bounding boxes, or blocking data, so that WHEN the Clash_Checker is run with the default Solver_Config on any Part of that Deadlock_Cage, translated along any of that Part's Candidate_Axes, against all other Parts of the same Deadlock_Cage, THE Clash_Checker reports at least 1 Opposing_Normal_Collision.
3. THE Sample_Kits SHALL construct each Deadlock_Cage so that no vertex of one Part lies within a distance of the default Weld_Tolerance multiplied by the Assembly's bounding-box diagonal from any vertex of a different Part.
4. WHEN a Deadlock_Cage is normalized by the Normalizer to `maxExtent = 1.0`, THE Sample_Kits SHALL guarantee by construction that the minimum distance between any two triangles of different Parts is at least 10 times the default Clearance_Epsilon (at least `5e-4` normalized units, which exceeds the default Clearance_Epsilon plus the default Micro_Shrink of `1.5e-4`), that no triangle of one Part intersects a triangle of a different Part, and that every Part meets the thickness rule of Requirement 22 criterion 15.
5. WHEN the Island_Splitter processes a Deadlock_Cage with the default Weld_Tolerance, THE Island_Splitter SHALL produce exactly 1 Island per mesh node, so that the Part count equals the mesh node count and no MonolithicMeshError is returned.
6. THE Sample_Kits SHALL construct each Deadlock_Cage with fewer than 150,000 total triangles (the Poly_Budget), so that the Sampling_Metadata Poly_Budget warning flag is false.

### Requirement 25: Property-based test harness

**User Story:** As a test author, I want property tests that are seeded and run under the normal test command, so that invariant failures are reproducible in CI.

#### Acceptance Criteria

1. THE Core_Engine SHALL implement the invariant property tests with `fast-check` and `vitest`, in test files inside `packages/unbolt-core` that `npm run test` in `packages/unbolt-core` discovers and executes.
2. THE Core_Engine SHALL run every `fast-check` property with an explicit integer seed written in the test source and at least 100 runs, with exactly one documented exception: each Invariant 1, Invariant 2, and Invariant 4 property for the Full_Keyboard SHALL run Full_Keyboard_Run_Count runs (criteria 10 to 12) with an explicit integer seed written in the test source. THE Core_Engine SHALL derive all generated test inputs only from `fast-check` arbitraries or from a Seeded_PRNG initialized from that seed, with no use of `Math.random` or clock-derived values.
3. WHEN a property test fails, THE property test SHALL report in the `vitest` output the `fast-check` seed, the counterexample, the shrink path, and the number of runs executed before the failure.
4. THE Core_Engine SHALL include in every property test at least one assertion whose outcome depends on solver output (Parts, Blocking_Graph, Disassembly_Plan, Trajectory_Steps, or a Clash_Checker result computed on solver output), and SHALL include no assertion that passes for every possible solver output, such as asserting a constant, comparing a value with itself, or returning `true` unconditionally.
5. THE Core_Engine SHALL contain no empty `catch` block and no `catch` block that discards an error without rethrowing it or returning it as a structured error state (for example, MonolithicMeshError), in either solver code or property test code.
6. WHEN `npm run test` is executed in `packages/unbolt-core`, THE Core_Engine test suite SHALL execute every property test exactly once without entering watch mode, SHALL exit with status 0 if all tests pass, and SHALL exit with a non-zero status if any test fails.
7. IF solver code throws an error during any property run, THEN THE property test SHALL be marked failed and SHALL report the thrown error together with the `fast-check` seed and the counterexample that triggered it.
8. WHEN a failed property test is re-run with the reported `fast-check` seed and shrink path, THE property test SHALL fail again with the same counterexample.
9. THE Core_Engine test suite SHALL define exactly one shared seeded `fast-check` SE3_Arbitrary that generates SE3_Transforms consisting of a unit quaternion whose norm is within `1e-6` of 1.0 and a translation whose X, Y, and Z components each lie in the closed range `[-100, 100]` in the kit's source units, and the Invariant 1, Invariant 2, and Invariant 3 property tests SHALL draw every SE3_Transform from that SE3_Arbitrary.
10. WHEN the environment variable `UNBOLT_FULL_KB_RUNS` is not set, THE Core_Engine test suite SHALL use a Full_Keyboard_Run_Count of 10.
11. WHEN the environment variable `UNBOLT_FULL_KB_RUNS` is set to a string that matches `^[1-9][0-9]*$` and denotes an integer no greater than `Number.MAX_SAFE_INTEGER`, THE Core_Engine test suite SHALL use that integer as the Full_Keyboard_Run_Count.
12. IF the environment variable `UNBOLT_FULL_KB_RUNS` is set to any other value, including an empty string, `0`, a negative number, a non-integer, or a non-numeric string, THEN THE Core_Engine test suite SHALL fail the test run with a message that names `UNBOLT_FULL_KB_RUNS`, the rejected value, and the accepted format, and SHALL NOT substitute the default of 10.

### Requirement 26: Invariant 1, zero-clash steps

**User Story:** As a test author, I want every step of a solved plan verified collision-free, so that the solver's core promise is checked directly.

#### Acceptance Criteria

1. FOR ALL solved Disassembly_Plans produced by the Invariant 1 property test, each Plan_Step at position `i` with `(partId, dir)` SHALL have a count of 0 Opposing_Normal_Collisions, as reported by the Clash_Checker. The Clash_Checker run for the step SHALL use the Part `partId` as the moving Part, translated along `dir`. The static set SHALL be exactly the Parts of the Plan_Steps at positions greater than `i`, held at their unmoved positions in the same normalized coordinates the solver used. The run SHALL use the Micro_Shrink, Clearance_Epsilon, and Tau of the Solver_Config that produced the plan.
2. THE Invariant 1 property test SHALL run one `fast-check` property for each Invariant_Kit. Each property SHALL use an explicit `fast-check` seed. The properties for the Haunted Clockwork Lockbox, the 3-Stage Planetary Gearbox, and the Keyboard_Fixture SHALL each run at least 100 runs, and the property for the Full_Keyboard SHALL run Full_Keyboard_Run_Count runs (Requirement 25 criteria 2 and 10 to 12). Each run SHALL apply an SE3_Transform drawn from the shared SE3_Arbitrary defined in Requirement 25 criterion 9 to the kit root before solving. Each run SHALL also use a generated integer Solver_Config seed in `[0, 4294967295]`, with every other Solver_Config field at its documented default.
3. IF the Core_Engine returns a Disassembly_Plan with a `status` other than `'solved'` for any generated input of the Invariant 1 property test, THEN the Invariant 1 property test SHALL fail. The failure SHALL report the kit name, the SE3_Transform, the Solver_Config seed, and the returned `status`. A non-solved plan SHALL NOT pass the property vacuously.
4. IF the Clash_Checker reports more than 0 Opposing_Normal_Collisions for any Plan_Step, THEN the Invariant 1 property test SHALL fail. The failure SHALL report the kit name, the SE3_Transform, the Solver_Config seed, the Plan_Step position `i`, the `partId`, the `dir`, the clash count, and the colliding triangle indices on the moving Part and on each static Part.

### Requirement 27: Invariant 2, SE(3) rigid-motion equivariance

**User Story:** As a test author, I want the solver's result to be independent of where and how the assembly is posed, so that world-aligned candidate directions do not hide bugs.

#### Acceptance Criteria

1. THE Invariant 2 property test SHALL generate SE3_Transforms from the shared SE3_Arbitrary defined in Requirement 25 criterion 9, run one property per Invariant_Kit with a fixed, explicitly declared integer seed, with at least 100 runs each for the Haunted Clockwork Lockbox, the 3-Stage Planetary Gearbox, and the Keyboard_Fixture, and Full_Keyboard_Run_Count runs for the Full_Keyboard, consistent with Requirement 25 criteria 2 and 10 to 12.
2. WHEN the Invariant 2 property test solves an Invariant_Kit under a generated SE3_Transform, THE Invariant 2 property test SHALL build a fresh instance of that kit from its Kit_Builder with the kit's parameters, compose the SE3_Transform onto the kit root's existing transform, update world matrices, and solve the transformed kit and an untransformed fresh instance with the same Solver_Config and the same Seeded_PRNG seed.
3. WHEN the Invariant 2 property test compares the two solves of an Invariant_Kit, THE Invariant 2 property test SHALL assert that the `status` of the transformed kit's Disassembly_Plan equals the `status` of the untransformed kit's Disassembly_Plan.
4. IF the untransformed kit's Disassembly_Plan has `status === 'solved'`, THEN THE Invariant 2 property test SHALL assert, for every Plan_Step of the transformed kit's Disassembly_Plan, that the Clash_Checker reports 0 Opposing_Normal_Collisions. The Clash_Checker SHALL use that Plan_Step's Part as the moving Part translated along its `dir`, against the Parts not yet removed by earlier Plan_Steps, using the Micro_Shrink, Clearance_Epsilon, and Tau of the Solver_Config.
5. IF the untransformed kit's Disassembly_Plan has `status === 'solved'`, THEN THE Invariant 2 property test SHALL assert that the transformed kit's Disassembly_Plan has the same number of Plan_Steps as the untransformed kit's plan, and that each Part_ID of the untransformed plan appears exactly once in the transformed plan.
6. IF solving the transformed or untransformed kit throws an exception or returns a MonolithicMeshError, THEN THE Invariant 2 property test SHALL fail that run and not catch or suppress the error.
7. IF any assertion of the Invariant 2 property test fails, THEN THE Invariant 2 property test SHALL report the Invariant_Kit name, the `fast-check` seed, and the counterexample's quaternion components and translation components.
8. FOR ALL Parts of every Invariant_Kit and all generated SE3_Transforms with rotation `R`, the Invariant 2 property test SHALL assert that Candidate_Axes 26 to 31 (the signed PCA_Axes) of each transformed Part equal `R` applied to Candidate_Axes 26 to 31 of the untransformed Part with the same Part_ID, within `1e-6` per component. Invariant 2 relies on the Intrinsic_Frame_Rule and equivariance property of Requirement 9 criteria 5 to 8 and on every showcase Part being a Frame_Unique_Part (Requirement 23 criterion 11). Candidate_Axes 0 to 25 are fixed world-space directions and are excluded from this check.

### Requirement 28: Invariant 3, deadlock cages

**User Story:** As a test author, I want interlocking cages to always be reported as deadlocked, so that the solver never fabricates an impossible plan.

#### Acceptance Criteria

1. FOR ALL Assemblies built by each of the 2 Deadlock_Cage Kit_Builders, with the kit root transformed by an SE3_Transform drawn from the shared SE3_Arbitrary defined in Requirement 25 criterion 9 (the same arbitrary used by the Invariant 1 and Invariant 2 property tests), and solved with a Solver_Config whose PRNG seed is a generated integer and whose other fields take their documented default values, THE Core_Engine SHALL return a Disassembly_Plan with `status === 'deadlocked'`, never `'solved'` or `'error'`.
2. FOR ALL inputs defined in criterion 1, the DeadlockWitness SHALL contain at least one SCC with at least 2 distinct Part_IDs, and every Part_ID listed in any SCC SHALL be the Part_ID of a Part of the input Assembly.
3. FOR ALL Blocking_Edges `(A, B, d)` reported in a DeadlockWitness, the clashing triangle index list of A and the clashing triangle index list of B SHALL both be non-empty. Each list SHALL be in ascending order with no duplicates, and each index SHALL be an integer from 0 to the triangle count of the corresponding Part minus 1, inclusive.
4. FOR ALL inputs defined in criterion 1, the Disassembly_Plan SHALL contain zero Plan_Steps.
5. FOR ALL Blocking_Edges `(A, B, d)` reported in a DeadlockWitness for an input defined in criterion 1, the Clash_Checker SHALL report at least 1 Opposing_Normal_Collision when Part A is translated along `d` against the static Part B.
6. FOR ALL Blocking_Edges `(A, B, d)` reported in a DeadlockWitness, Parts A and B SHALL belong to the same reported SCC, and `d` SHALL equal one of Part A's Candidate_Axes within `1e-9` per component.
7. THE Invariant 3 property test SHALL run at least 100 seeded runs for each of the 2 Deadlock_Cages, with an explicit `fast-check` seed written in the test source (Requirement 25 criterion 2).

### Requirement 29: Invariant 4, merged-mesh island recovery

**User Story:** As a test author, I want assemblies baked into one mesh to remain solvable, so that Stage 0 island splitting is verified end to end.

#### Acceptance Criteria

1. THE Invariant 4 property test SHALL build each merged input as follows. It runs one `fast-check` property per Invariant_Kit, and each run selects a generated subset of at least 2 and at most all of that kit's Parts. It bakes each selected Part's world transform into its vertex positions and normals, and combines the result into one `BufferGeometry` inside one `THREE.Mesh` that has an identity local transform. The generator chooses whether that `BufferGeometry` is indexed or non-indexed.
2. THE Invariant 4 property test SHALL accept a generated Part subset only if no two Parts in the subset have vertex positions closer than the default Weld_Tolerance. That distance is measured in baked world space, relative to the bounding-box diagonal of the subset's combined geometry.
3. THE Invariant 4 property test SHALL count only accepted Part subsets toward the required run count of Requirement 25 criterion 2, which is at least 100 accepted subsets each for the Haunted Clockwork Lockbox, the 3-Stage Planetary Gearbox, and the Keyboard_Fixture, and Full_Keyboard_Run_Count accepted subsets for the Full_Keyboard, and SHALL fail if `fast-check` cannot generate the required number of accepted subsets for an Invariant_Kit.
4. FOR ALL merged inputs, the Island_Splitter SHALL produce exactly as many Parts as there are source Parts. A source Part is a Part that the Island_Splitter produces from the same subset left unmerged, with each Part in its own mesh node.
5. FOR ALL merged inputs, the Island_Splitter SHALL map each Island one-to-one to a source Part, with no two Islands matched to the same source Part. An Island matches a source Part when both have the same triangle count and each Island triangle has a corresponding source triangle whose 3 vertex positions each lie within the default Weld_Tolerance of the matching source vertex positions.
6. FOR ALL merged inputs, the Core_Engine SHALL return no MonolithicMeshError.
7. FOR ALL merged inputs whose unmerged source subset solves to `status === 'solved'` with a given Solver_Config, solving the merged input with the same Solver_Config, including the same seed, SHALL return `status === 'solved'` and a Disassembly_Plan with these properties:
   - The plan has exactly one Plan_Step per merged Part.
   - Each merged Part_ID appears exactly once.
   - The Clash_Checker reports 0 Opposing_Normal_Collisions for every Plan_Step against the merged Parts that remain unremoved at that step.

### Requirement 30: Public API surface

**User Story:** As a consumer developer, I want a small, stable set of exports, so that apps and tools integrate without reaching into internals.

#### Acceptance Criteria

1. THE Core_Engine SHALL export from `packages/unbolt-core/src/index.ts`, importable through the package root specifier `@unboltkit/core` with no subpath, a single pipeline entry function that accepts an `Object3D` and an optional Solver_Config and returns a result whose `status` is `'solved'`, `'deadlocked'`, or `'error'`.
2. THE Core_Engine SHALL export from the `@unboltkit/core` package root one directly callable function for each of Stage 0, Stage 1, Stage 2, Stage 3, and Stage 4, plus the Primitive_Registry, the Trajectory_Compiler, the Clash_Checker, and `computeNaiveRadialClashes()`, so that a consumer needs no import path into the package's `src/` subdirectories.
3. THE Core_Engine SHALL export from the `@unboltkit/core` package root TypeScript types for Disassembly_Plan, Plan_Step, DeadlockWitness, MonolithicMeshError, `EmptyAssemblyError`, `InvalidGeometryError`, the configuration error, Solver_Config, Sampling_Metadata, Trajectory_Step, and Motion_Primitive.
4. THE Core_Engine SHALL type the `status` field of Disassembly_Plan as the string literal union `'solved' | 'deadlocked' | 'error'`, discriminated so that a `tsc --noEmit` type check accepts access to the ordered Plan_Steps only after narrowing to `'solved'` or `'deadlocked'` (consistent with Requirement 16 criterion 1, which includes the Plan_Steps completed before a deadlock), to the DeadlockWitness only after narrowing to `'deadlocked'`, and to the error only after narrowing to `'error'`.
5. THE Core_Engine SHALL continue to export `UNBOLT_CORE_VERSION` as a string constant equal to the `version` field of the `@unboltkit/core` package manifest.
6. WHEN the exported Stage 0 through Stage 4 functions are called in order on the same `Object3D` with the same Solver_Config, THE Core_Engine SHALL produce a Disassembly_Plan deep-equal to the one the pipeline entry function returns for that input and Solver_Config.
7. IF the pipeline entry function's input meets a MonolithicMeshError, `EmptyAssemblyError`, `InvalidGeometryError`, or configuration error condition, THEN THE Core_Engine SHALL return a result with `status === 'error'` that contains an error of the matching kind, and SHALL NOT throw an exception for that condition.
