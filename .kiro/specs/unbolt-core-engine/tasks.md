# Implementation Plan: UnboltKit Core Engine

## Overview

This plan builds `packages/unbolt-core` (`@unboltkit/core`) and `packages/sample-kits` (`@unboltkit/sample-kits`) in TypeScript, in the order of the design's data flow: package setup, shared types and configuration, Stage 0 to Stage 3, the `solveDisassembly()` pipeline, Stage 4 primitives and the Trajectory_Compiler, the independent Clash_Checker oracle, the Naive_Baseline, the public API, the procedural Sample_Kits, kit guarantee tests, and finally the four invariant property suites. Nothing under `apps/*` or `tools/*` is touched.

Rules that apply to every task (from `.kiro/steering`):

- `src/` in `@unboltkit/core` imports only `three`, `three-mesh-bvh` and its own files. No DOM, WebGL, `window`, `process` or Node built-ins.
- Normalize to `maxExtent = 1.0` before any DBG raycasting. Sample_Kits use `ExtrudeGeometry` and `LatheGeometry` with PBR materials, and no `three-bvh-csg`.
- No hardcoded Part_IDs, bounding boxes or step orders. No empty or swallowing `catch`. No trivial assertions. No unseeded `Math.random()`. Every `fc.assert` has a literal seed and checks a real geometric or graph property.
- Run tests one command at a time with `npm run test` (`vitest run`, never watch mode) from `"/Users/sarvesh/Dev/Kiroween 2027/packages/unbolt-core"` or `".../packages/sample-kits"`, always double-quoting the path. Do not use GNU `timeout`. Read stdout for the real result when the exit code is `-1`.

## Tasks

- [ ] 1. Set up packages and shared test foundations
  - [x] 1.1 Update the `@unboltkit/core` manifest, tsconfig and Vitest config
    - In `packages/unbolt-core/package.json`, move `@types/three` to `devDependencies` so `dependencies` is exactly `three` and `three-mesh-bvh`; add `"@unboltkit/sample-kits": "*"` to `devDependencies`; keep `fast-check`, `vitest`, `typescript`; keep `"test": "vitest run"`; add a developer-only `"test:quick"` script that excludes `test/invariants/`
    - Set `tsconfig.json` `include` to `["src", "test"]`
    - Create `vitest.config.ts` with `environment: 'node'`, no `setupFiles`, `pool: 'forks'`, and `include` covering `test/**/*.test.ts` (the `globalSetup` entry is added in task 21.1)
    - Move the existing `src/index.test.ts` to `test/unit/version.test.ts` and make it assert that `UNBOLT_CORE_VERSION` equals the `version` field read from `package.json`
    - _Requirements: 1.1, 1.3, 25.1, 25.6, 30.5_

  - [x] 1.2 Update the `@unboltkit/sample-kits` manifest, tsconfig and Vitest config
    - Keep `three` as the only runtime dependency (`@types/three` allowed); add `vitest` and `fast-check` to `devDependencies`; add `"test": "vitest run"`
    - Set `tsconfig.json` `include` to `["src", "test"]`; create `vitest.config.ts` with `environment: 'node'` and no setup files
    - _Requirements: 22.6, 22.12, 25.6_

  - [x] 1.3 Create the shared core test helpers
    - `test/helpers/plainData.ts`: recursive checker that accepts only strings, finite numbers, booleans, `null`, arrays, typed arrays and `Object.prototype` objects, and rejects cycles, `Map`, `Set`, class instances, functions and `THREE` objects
    - `test/helpers/snapshot.ts`: deep snapshot and compare of an `Object3D` hierarchy (position, quaternion, scale, matrix, matrixWorld, child order, geometry attribute and index arrays, material references), plus snapshots of config objects, plans and `Stage1Result` Part buffers
    - `test/helpers/failWith.ts`: adds domain context (kit name, quaternion, translation, config seed, step index, Part_ID, `dir`, triangle lists) through `fc.context().log` and the `expect` message
    - `test/helpers/applySe3.ts`: composes an SE3_Transform onto a test-owned kit root's existing transform and updates its world matrices
    - _Requirements: 1.5, 1.8, 25.3, 25.7, 27.2, 27.7_

  - [x] 1.4 Create the single shared SE3_Arbitrary in `test/arbitraries/se3.ts`
    - Draw four doubles in `[-1, 1]`, reject tuples with norm below `0.1`, normalize; mix in identity and exact quarter- and half-turns about each axis with `fc.oneof`; translations are `fc.double({ min: -100, max: 100, noNaN: true })` per component
    - Export it as the only SE3 arbitrary in the test suite
    - _Requirements: 25.2, 25.9_

  - [ ]* 1.5 Write unit test for the SE3_Arbitrary
    - `test/unit/se3-arbitrary.test.ts`: `fc.sample(se3Arbitrary, { seed, numRuns: 1000 })` with a literal seed; check quaternion norm within `1e-6` of 1 and every translation component in `[-100, 100]`
    - _Requirements: 25.9_

- [x] 2. Core types, errors, configuration, PRNG and math helpers
  - [x] 2.1 Define all public and internal data types in `src/types.ts`
    - `Vec3`, `NodePath`, `Diagnostic`, `NormalizationTransform`, `SamplingMetadata`, `PlanStep` (with `secondary`), `WitnessEdge`, `DeadlockWitness`, `ConfigurationIssue`, `ConfigurationError`, `EmptyAssemblyError`, `InvalidGeometryError`, `MonolithicMeshError`, `CoreError`, `SolvedPlan`, `DeadlockedPlan`, `ErrorResult`, the discriminated `DisassemblyPlan` union, `BlockingEdge`, `BlockingGraph` (with optional `diagnostics`), `PrimitiveParams`, `TrajectoryStep`, `Pose`, `NaiveBaselineResult`, `ClashResult`, `RegistryError`, `RegistryResult`, `CompileError`
    - Internal types: `Part`, `Stage0Result`, `PartFrame`, `FrameDecision`, `NormalizedPart`, `Stage1Result`
    - _Requirements: 1.5, 30.3, 30.4_

  - [x] 2.2 Implement `src/errors.ts`
    - `UnboltCoreError extends Error` with `code`, and subclasses `InvalidSampleCountError`, `Stage1FailureError { partId, component, cause }`, `DeadlockWitnessInvariantError`, `PrimitiveRangeError { t }`, `PrimitiveParamError { param }`, `InvalidDirectionError { dir }`, `MovingPartInStaticSetError { partId }`, `AssemblyNotNormalizedError { measuredMaxExtent }`, `InvalidSolverConfigError { configurationError }`, with structured fields kept as plain data
    - Builders for the returned error values (`ConfigurationError`, `InvalidGeometryError`, `EmptyAssemblyError`, `MonolithicMeshError`) with deterministic, non-empty messages built only from input-derived values
    - _Requirements: 6.2, 6.4, 6.5, 9.11, 12.8, 16.7, 18.7, 18.8, 20.12, 20.13, 21.7_

  - [x] 2.3 Implement `src/config.ts`
    - `SolverConfig`, `ResolvedSolverConfig`, `DEFAULT_SOLVER_CONFIG` (samples 48, microShrink `1e-4`, clearanceEpsilon `5e-5`, tau `0.05`, helicalAngularToleranceDeg 5, weldTolerance `1e-6`, fastenerSymmetryTolerance `0.1`, fastenerSlendernessThreshold `2.0`, threadPitch `0.01`), `DEFAULT_SEED = 0x5EED2027`, with TSDoc for every default and for ignored unknown keys
    - `validateConfig(input)`: never throws or mutates; `undefined` means all defaults; `null` or non-object gives a `"(config)"` issue; per-field rules of Req 2.4 to 2.10; joint `clearanceEpsilon`/`microShrink` issue only when both pass Req 2.5; issues sorted by field; rejected values formatted with `formatRejected`
    - `resolveConfig()` overlays defined fields on the defaults
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 3.6, 3.7_

  - [x]* 2.4 Write unit tests for configuration defaults
    - `test/unit/config.test.ts`: defaults pass validation, equal the documented values, and satisfy `clearanceEpsilon < microShrink`
    - _Requirements: 2.3, 2.12_

  - [x] 2.5 Implement the Seeded_PRNG in `src/prng.ts`
    - `sfc32` seeded through `splitmix32`, `fnv1a32` over UTF-16 code units, `createPrng(seed)` with `nextUint32()` and `nextFloat()` in `[0, 1)`, and `substreamSeed(seed, key) = splitmix32(seed ^ fnv1a32(key)) >>> 0`
    - _Requirements: 3.1, 3.2, 3.7, 12.4_

  - [x]* 2.6 Write unit tests for the PRNG
    - `test/unit/prng.test.ts`: two instances with the same seed give the same sequence; `nextFloat` stays in `[0, 1)`; distinct keys give distinct substream seeds
    - _Requirements: 3.1_

  - [x] 2.7 Implement `src/math/vec3.ts` and `src/math/aabb.ts`
    - Tuple vector helpers with no `THREE` dependency; AABB build, union, expansion, ray slab test and swept-AABB overlap test
    - _Requirements: 1.2, 20.11_

  - [x] 2.8 Implement `src/math/eigen3.ts`, `src/math/hull2d.ts` and `src/math/onb.ts`
    - Cyclic Jacobi for symmetric 3×3 matrices (at most 64 sweeps, stop when the off-diagonal sum is 0 or below `1e-300`)
    - Monotone-chain convex hull that handles segment and point hulls; exact Euclidean distance between two convex polygons (SAT overlap test, else minimum vertex-to-edge distance)
    - Duff et al. 2017 branchless orthonormal basis
    - _Requirements: 9.3, 11.1, 11.2_

  - [x]* 2.9 Write unit tests for the math helpers
    - `test/unit/math.test.ts`: Jacobi reconstructs diagonal, rotated and repeated-eigenvalue matrices within `1e-12`; hull distance matches brute force for corner-facing hulls, segments and points; `onb` returns a right-handed orthonormal basis
    - _Requirements: 9.3, 11.2_

- [ ] 3. Stage 0: scene parsing and island splitting
  - [x] 3.1 Implement the Scene_Parser in `src/stage0/sceneParser.ts`
    - `parseScene(root)`: iterative pre-order traversal with children in ascending index order, ignoring `visible`; mesh detection by `isMesh`; `instancing-ignored` and `skinning-ignored` diagnostics
    - World matrix composed fresh from local `position`, `quaternion`, `scale` up to the provided root; never read `matrixWorld` or call `updateMatrixWorld`
    - Positions by `W`, normals by the normalized normal matrix; attributes read with `getX/getY/getZ`; winding flipped `(a, b, c) → (a, c, b)` when `det(W) < 0`
    - `excluded-node` diagnostics for non-Mesh and zero-triangle nodes while still visiting children; per-triangle derived normals plus `derived-normals` diagnostic when the normal attribute is missing
    - Collect `malformed` issues (missing position, index or position count not divisible by 3, out-of-range index) and `non-finite` issues (source or world component) for every mesh node in traversal order
    - _Requirements: 1.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9, 4.10, 5.10, 6.5_

  - [x] 3.2 Implement welding and Union-Find in `src/stage0/weld.ts` and `src/stage0/unionFind.ts`
    - Spatial hash with cell size `h`, vertices inserted in ascending source index, 27-neighbor comparison, union at distance `<= h`; exact-coordinate keys with `-0 → 0` when `h = 0`
    - Union by rank with path halving; the smaller index always becomes the representative
    - _Requirements: 5.2, 5.3, 5.5_

  - [x] 3.3 Implement the Island_Splitter in `src/stage0/islandSplitter.ts`
    - `splitIslands(meshes, weldTolerance)`: weld radius `weldTolerance × diag` over all referenced vertices; weld per mesh node only; union the three corners of every triangle, including zero-area ones
    - Islands ordered by smallest source triangle index and numbered from 0; `partId = "/" + nodePath.join("/") + "#" + islandIndex`, never using names, `uuid` or `id`
    - Build each `Part`: `sourceTriangleIndices`, local `positions`, outward-wound `triangles`, `weldIds`, `weldRepresentatives`, `faceNormals`, `triangleAreas`, `cornerNormals`
    - _Requirements: 3.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [x] 3.4 Implement `stage0ParseScene()` and `computeSamplingMetadata()` in `src/stage0/stage0.ts`
    - Check order: `validateConfig` (no geometry read on failure), then `InvalidGeometryError` (`non-finite` if any non-finite issue, else `malformed`, with every offending node path), then `EmptyAssemblyError` with diagnostics, then `MonolithicMeshError { totalTriangles, nodePath, message }` for exactly 1 Part, else `Stage0Result`
    - `computeSamplingMetadata(T)` returns stride `1` and `false` for `T <= 150000`, else `ceil(T / 150000)` and `true`; export `POLY_BUDGET = 150000`; Parts are never stride-reduced
    - _Requirements: 4.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.5, 30.7_

  - [ ]* 3.5 Write property test for scene traversal
    - Create `test/arbitraries/hierarchies.ts` with every feature the design's generator table lists (mixed node types, duplicate and empty names, TRS including negative and non-uniform scale, stale `matrixWorld`, indexed, non-indexed, empty and invisible meshes, missing normals, optional injected defects); test in `test/properties/p06-scene-traversal.property.test.ts`
    - **Property 6: Scene traversal matches a reference walk**
    - **Validates: Requirements 4.1, 4.5, 4.6**

  - [ ]* 3.6 Write property test for world-space transform preservation
    - Reuse `test/arbitraries/hierarchies.ts`; test in `test/properties/p07-world-transform.property.test.ts`
    - **Property 7: World-space transform preservation**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.10**

  - [ ]* 3.7 Write property test for island splitting
    - Create `test/arbitraries/meshSets.ts` and the O(n²) weld plus BFS reference in `test/helpers/reference/weld.ts`; test in `test/properties/p08-island-partition.property.test.ts`
    - **Property 8: Island splitting is a weld-consistent partition**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9**

  - [x]* 3.8 Write unit tests for Stage 0 edge cases
    - `test/unit/stage0.test.ts`: `InstancedMesh` and `SkinnedMesh` diagnostics; a mirrored transform keeps face normals outward; non-indexed source triangle indices `3k..3k+2`; a hierarchy with only lights and cameras gives `EmptyAssemblyError` with diagnostics; a non-finite and a malformed node in one tree are both listed in traversal order
    - _Requirements: 4.5, 4.6, 4.8, 4.9, 5.10, 6.5_

- [x] 4. Checkpoint - Stage 0
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Stage 1: normalization, BVHs, frames and Candidate_Axes
  - [x] 5.1 Implement the Normalizer in `src/stage1/normalizer.ts`
    - AABB over all Part positions; `maxExtent === 0` gives `InvalidGeometryError` `zero-extent`; a non-finite or non-positive `scale = 1 / maxExtent` gives `non-finite-scale`
    - `translation = −center × scale`; compute `q = p × scale + translation[k]` in that order into new `Float64Array`s; scale areas by `scale²`; leave face normals and the caller's hierarchy unchanged
    - _Requirements: 8.1, 8.2, 8.5, 8.6, 8.7, 8.8_

  - [x] 5.2 Implement the BVH_Builder in `src/stage1/bvhBuilder.ts`
    - Per Part, a private `BufferGeometry` with a `Float64Array` position attribute and `Uint32Array` index; `new MeshBVH(geom, { strategy: SAH, indirect: true, maxLeafTris: 10, setBoundingBox: false, verbose: false })` over the full, unsampled triangle set
    - After building, check that the root box contains the exact float64 `part.aabb` on every coordinate and exceeds it by at most `1e-6`; throw `Stage1FailureError { partId, component: 'BVH_Builder' }` on failure, and rethrow construction errors with `cause` (no swallowing)
    - _Requirements: 7.5, 9.1, 9.2, 9.10, 9.11_

  - [x] 5.3 Implement Part metrics in `src/stage1/partMetrics.ts`
    - `extentsSorted` from `2 × halfExtents`; `slenderness = +Infinity` when `e2 + e3 === 0`, else `e1 / ((e2 + e3) / 2)`; `isFastener = abs(e2 − e3) <= tolSym × max(e2, e3) && slenderness >= tolSlender`, using only geometry and config values
    - _Requirements: 15.2, 15.5, 15.6, 19.4, 19.8_

  - [x] 5.4 Implement PCA, tie detection, the Intrinsic_Frame_Rule and sign rules in `src/stage1/axisGenerator.ts`
    - Use weld-cluster representatives in normalized coordinates; two-pass centroid and covariance; Jacobi eigen-decomposition with descending eigenvalues
    - Tie groups within `1e-9 × λ1` (all three when `λ1 = 0`); gaps between `1e-9` and `1e-6` relative mark the frame not Frame_Unique
    - Inside each tied subspace: farthest-vertex candidates within `1e-9 × rmax`, scored by incident triangle area and summed (never decided by vertex index order); else the summed unit normals of the largest-area faces; record each decision
    - Signs of PCA1 and PCA2 from the third central moment, else from the farthest-vertex direction; `PCA3 = PCA1 × PCA2`; record `frameUnique` and `minRelativeMargin`
    - _Requirements: 9.3, 9.5, 9.6, 9.8, 10.5, 10.7_

  - [x] 5.5 Add the F1/F2/F3 fallback chain, OBB and finiteness checks to `src/stage1/axisGenerator.ts`
    - F1: the Part's own vertices in triangle order; F2: other Parts' vertices in ascending Part_ID then triangle order; F3: only after asserting the Assembly is an All_Collinear_Assembly (else throw `Stage1FailureError { component: 'Axis_Generator' }`), completing the frame with `math/onb.ts`; F3 is the only caller of `onb.ts` inside `stage1/`
    - Sign fallback through F1 then F2 marks the Part Frame_Ambiguous; OBB center and half-extents from exact min/max projections without padding; any non-finite axis, center or half-extent throws `Stage1FailureError`
    - _Requirements: 9.4, 9.5, 9.6, 9.7, 9.9, 9.11, 10.7_

  - [x] 5.6 Implement Candidate_Axes in `src/stage1/candidateAxes.ts`
    - Frozen `CANONICAL_DIRECTIONS` (26 entries in the design's index order, built from exact constants so each negation is bitwise equal to its opposite entry); per-Part 32 axes with `+PCA1, −PCA1, +PCA2, −PCA2, +PCA3, −PCA3` at indices 26 to 31, kept even when they match a canonical direction
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_

  - [x] 5.7 Implement `stage1Prepare()` in `src/stage1/stage1.ts`
    - Return an incoming `ErrorResult` unchanged; validate the config when called directly; run the Normalizer (returning its `InvalidGeometryError`), then BVHs, frames, Candidate_Axes and metrics; emit `NormalizedPart`s in ascending Part_ID order with exact `aabb`, plus `normalization`, `sampling`, `diagnostics` and the resolved config
    - _Requirements: 3.5, 8.3, 8.4, 8.6, 8.7, 9.1, 9.11_

  - [x] 5.8 Implement the watertight assembly generator and the independent watertightness checker
    - `test/arbitraries/assemblies.ts`: draws the Solver_Config first (Micro_Shrink in `[1e-5, 2e-4]`, Clearance_Epsilon below it), then 2 to 8 Parts (configurable maximum) in free, stacked, peg-in-hole and sleeve-on-rod layouts, built only from closed outward boxes, `ExtrudeGeometry` of jittered star-shaped outlines with inset holes and no bevel, and axis-closed `LatheGeometry` profiles; gaps and walls at least `1e-3` of the layout extent; collapsed triangles dropped; a rigid transform per Part
    - `test/helpers/watertight.ts`: checks closedness (every welded edge shared by exactly 2 oppositely oriented triangles), positive signed volume, and thickness greater than a given Micro_Shrink by brute-force inward rays from every centroid; imports nothing from `src/` except types
    - _Requirements: 11.7, 22.15, 22.16_

  - [x]* 5.9 Write unit test for the assembly generator
    - `test/unit/assemblies-generator.test.ts`: `fc.sample` 200 generated Assemblies with a literal seed and assert every Part passes `watertight.ts` under that Assembly's Micro_Shrink
    - _Requirements: 11.7_

  - [x]* 5.10 Write unit tests for Stage 1 edge cases
    - `test/unit/stage1.test.ts`: subnormal extent gives `non-finite-scale`; `vi.mock('three-mesh-bvh')` with a throwing constructor gives `Stage1FailureError` with the Part_ID and component; the 26 canonical directions have the right counts and component patterns; hand-built Parts reach the farthest-vertex, largest-face, F1, F2 and F3 branches; a collinear Part inside a non-collinear Assembly resolves through F2 and never F3
    - _Requirements: 8.7, 9.5, 9.7, 9.11, 10.1_

  - [ ]* 5.11 Write property test for BVH construction
    - Uses `test/arbitraries/assemblies.ts`; test in `test/properties/p13-bvh-identity.property.test.ts`
    - **Property 13: One BVH per Part with preserved triangle identity**
    - **Validates: Requirements 9.1, 9.2, 9.10**

  - [ ]* 5.12 Write property test for PCA frames and OBBs
    - Create `test/arbitraries/frames.ts` (distinct, tied, collinear, coplanar and coincident spectra, tied Parts made unique by an asymmetric feature, all-collinear Assemblies and collinear Parts in non-collinear Assemblies); test in `test/properties/p14-pca-frames.property.test.ts`
    - **Property 14: PCA frames and OBBs are valid for every Part**
    - **Validates: Requirements 9.3, 9.4, 9.6, 9.7, 9.9, 10.5, 10.7**

  - [ ]* 5.13 Write property test for frame equivariance
    - Uses `test/arbitraries/frames.ts` and the shared `test/arbitraries/se3.ts`; test in `test/properties/p15-frame-equivariance.property.test.ts`
    - **Property 15: Frames of Frame_Unique_Parts are SE(3)-equivariant**
    - **Validates: Requirements 9.5, 9.7, 9.8**

  - [ ]* 5.14 Write property test for Candidate_Axes layout
    - Uses `test/arbitraries/frames.ts`, including axis-aligned Parts; test in `test/properties/p16-candidate-axes.property.test.ts`
    - **Property 16: Candidate_Axes have the fixed layout**
    - **Validates: Requirements 10.2, 10.3, 10.4**

- [x] 6. Checkpoint - Stage 1
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Stage 2: Directional Blocking Graph
  - [x] 7.1 Implement OBB pair pruning in `src/stage2/obbPruning.ts`
    - Along `d`: intervals from `center·d ± Σ h_i |a_i·d|`, prune when `maxB < minA − 1e-9`
    - Perpendicular plane: `onb(d)` basis, projected 8-corner hulls, exact hull distance from `math/hull2d.ts`, prune when the distance is `> 1e-9`; cache hulls per (Part, canonical direction index) and compute PCA-direction hulls on demand
    - _Requirements: 11.1, 11.2, 11.3, 11.8_

  - [x] 7.2 Implement the stratified sampler in `src/stage2/sampler.ts`
    - The only importer of `prng.ts`; eligible triangles have a local index divisible by the stride; cumulative areas in index order; per-Part PRNG `createPrng(substreamSeed(seed, partId))`; per stratum draw `r0, r1, r2`, binary-search the triangle (never zero-width), barycentrics `(1 − s, s(1 − r2), s·r2)` with `s = sqrt(r1)`
    - `origin = point − microShrink × faceNormal`; zero eligible area gives no samples; store `originX/Y/Z` as `Float64Array` and `sourceTri` as `Uint32Array`
    - _Requirements: 3.1, 3.5, 7.4, 7.7, 12.4, 13.1, 13.9_

  - [x] 7.3 Implement all-hit ray casting in `src/stage2/rayCast.ts`
    - `castAllHits(bvh, origin, dir, out)` reuses one `THREE.Ray`, runs an exact slab test against the target AABB expanded by `1e-9`, then calls `bvh.raycast(ray, DoubleSide, 0, Infinity)`; never uses `firstHitOnly` or `raycastFirst`; no per-hit allocation
    - _Requirements: 13.5_

  - [x] 7.4 Implement the DBG hit filter in `src/stage2/hitFilter.ts`
    - `filterNearest(hits, dir, targetFaceNormals, eps, tau)` drops hits with `distance < eps` and with `dot(n, dir) >= −tau` using the engine's own outward face normals by `faceIndex`, then returns the nearest survivor with ties broken by lower triangle index
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.10_

  - [x] 7.5 Implement `stage2BuildDbg()` in `src/stage2/dbgBuilder.ts`
    - Throw `InvalidSampleCountError` before any sampling when the sample count is not an integer `>= 1`; return an incoming `ErrorResult` unchanged
    - Loop A (ascending Part_ID) → axis index 0..31 → B ≠ A; optional `obbPruning` (default `true`); memoized `raySet(X → Y, dir)` keyed by Part_IDs and float64 direction bits; one edge per triple when either side collides, with sorted unique `fromTriangles` and `toTriangles` built as Req 12.5 specifies
    - Edges sorted by `(from, dirIndex, to)`; `stats { pairsTested, pairsPruned, raysCast, zeroAreaParts }`; TSDoc states that pruning soundness needs Watertight_Solid_Parts
    - _Requirements: 3.5, 11.4, 11.5, 12.1, 12.2, 12.3, 12.5, 12.6, 12.7, 12.8, 13.8_

  - [x] 7.6 Add the optional ray-count collector to `src/stage2/dbgBuilder.ts`
    - With `collectRayCounts: true`, add `diagnostics.rayCounts` records `{ from, to, dirIndex, forwardRays, backwardRays }` for unpruned triples with at least 1 colliding ray, and `diagnostics.prunedTriples`, both sorted by `(from, dirIndex, to)`; cast no extra rays and leave `edges` and `stats` unchanged; omit `diagnostics` when the option is false
    - _Requirements: 22.17, 22.18, 30.6_

  - [ ]* 7.7 Write property test for pruning classification
    - Create the brute-force reference `test/helpers/reference/pruning.ts`; generate OBB pairs with zero extents, touching boxes and gaps within `±2e-9` of the threshold; test in `test/properties/p17-obb-pruning-reference.property.test.ts`
    - **Property 17: OBB pruning classification matches a reference**
    - **Validates: Requirements 11.1, 11.2, 11.3**

  - [ ]* 7.8 Write property test for the stratified sampler
    - Uses `test/arbitraries/assemblies.ts` plus zero-area triangles; test in `test/properties/p11-stratified-sampler.property.test.ts`
    - **Property 11: Stratified samples are area-stratified, stride-eligible and correctly offset**
    - **Validates: Requirements 7.4, 8.3, 12.4, 13.1, 13.9**

  - [x] 7.9 Write property test for pruning soundness
    - Uses `test/arbitraries/assemblies.ts` (2 to 8 Parts) with a literal seed and at least 100 runs; first assert every Part passes `test/helpers/watertight.ts` under the run's Micro_Shrink, then compare `stage2BuildDbg` with pruning enabled and disabled (same triples, same triangle lists); test in `test/properties/p18-pruning-soundness.property.test.ts`
    - **Property 18: OBB pruning is sound**
    - **Validates: Requirements 11.4, 11.7**

  - [ ]* 7.10 Write property test for the DBG against a brute-force reference
    - Create `test/helpers/reference/raycast.ts` (all-triangle raycaster) and `test/helpers/reference/dbg.ts`; 2 to 5 Parts, N in `[1, 16]`; also check `collectRayCounts` records; test in `test/properties/p19-dbg-reference.property.test.ts`
    - **Property 19: The DBG matches a brute-force reference DBG**
    - **Validates: Requirements 11.5, 12.1, 12.2, 12.3, 12.5, 12.6, 13.2, 13.3, 13.4, 13.5, 13.8, 22.18**

  - [ ]* 7.11 Write property test for coaxial clearance
    - Create `test/arbitraries/fixtures.ts` with parametric screw-in-countersunk-hole and box-facing-wall pairs; test in `test/properties/p21-coaxial-clearance.property.test.ts`
    - **Property 21: Coaxial clearance never blocks the outward axis**
    - **Validates: Requirements 13.7**

  - [ ]* 7.12 Write property test for facing walls
    - Uses `test/arbitraries/fixtures.ts`; test in `test/properties/p22-facing-wall.property.test.ts`
    - **Property 22: A facing wall always blocks**
    - **Validates: Requirements 13.10**

- [x] 8. Checkpoint - Stage 2
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Stage 3: Kahn peel and Tarjan witness
  - [x] 9.1 Implement Escape_Distance in `src/stage3/escapeDistance.ts`
    - Per-axis slab formula against the AABB union of the other unremoved Parts, `max(0, min_j s_j)`, `0` when A already misses the union or is the last Part; per-axis top-2 and bottom-2 extremes so excluding A costs O(1)
    - _Requirements: 14.3, 14.4, 14.8, 15.4_

  - [x] 9.2 Implement the tie-break cascade in `src/stage3/tieBreak.ts`
    - Key computation (Fastener, Slenderness, Radial_Exposure against the mean OBB center of unremoved Parts, Escape_Distance along the chosen direction) and the cascade: exact Fastener filter; slenderness within `1e-9` of the max (exactly the `+Infinity` ones when the max is `+Infinity`); radial exposure within `1e-9` of the max; escape distance within `1e-9` of the min; smallest Part_ID by `a < b`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [x] 9.3 Implement `runPeel()` and `stage3Peel()` in `src/stage3/peelSolver.ts`
    - Plain-data `PeelInput`; `blockers[A][k]` counters and `edgesByBlocker[B]` decrement lists; per iteration compute the removable set, choose each Part's direction (lowest axis index among unblocked axes within `1e-9` of the minimum escape distance), select with the cascade, append `{ partId, dir, dirIndex, escapeDistance, secondary: null }`
    - Optional `trace` with the removable set, key components and survivors per cascade step; `stage3Peel()` builds `PeelInput` from `Stage1Result` and `BlockingGraph`, returns an incoming `ErrorResult` unchanged, and attaches normalization, sampling and diagnostics to the plan
    - _Requirements: 3.5, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 15.4, 15.8_

  - [x] 9.4 Implement iterative Tarjan in `src/stage3/tarjan.ts`
    - No recursion; nodes and neighbors visited in Part_ID order
    - _Requirements: 16.2_

  - [x] 9.5 Implement the SCC_Analyzer in `src/stage3/sccAnalyzer.ts` and wire it into the deadlock branch of `src/stage3/peelSolver.ts`
    - Graph over unremoved Parts; witness SCCs are sink SCCs with at least 2 members; members and SCCs sorted by code unit; every internal edge with its triangle lists; `unassignedPartIds` sorted; throw `DeadlockWitnessInvariantError` when no witness SCC exists
    - Deadlocked plan carries the completed steps, the witness, normalization and sampling
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_

  - [ ]* 9.6 Write property test for peel order validity
    - Create `test/arbitraries/graphs.ts` (synthetic `PeelInput`s biased toward exact ties, `1e-9` near-ties, deadlocks with chains and multiple sink components); test in `test/properties/p24-peel-order.property.test.ts`
    - **Property 24: Peeling is a valid, confluent topological order**
    - **Validates: Requirements 14.1, 14.2, 14.4, 14.5, 14.6, 14.7, 14.8, 14.10, 16.1**

  - [ ]* 9.7 Write property test for the removal direction
    - Create the bisection reference `test/helpers/reference/escape.ts`; keep generated differences at least `1e-11` away from the `1e-9` threshold; test in `test/properties/p25-escape-direction.property.test.ts`
    - **Property 25: The removal direction minimizes the escape distance**
    - **Validates: Requirements 14.3**

  - [ ]* 9.8 Write property test for tie-breaking
    - Uses `test/arbitraries/graphs.ts` and the `runPeel` trace with an independent reference cascade; test in `test/properties/p26-tie-break.property.test.ts`
    - **Property 26: Tie-breaking picks an optimal Part**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.7**

  - [ ]* 9.9 Write property test for deadlock witnesses
    - Create the reachability-matrix reference `test/helpers/reference/scc.ts`; test in `test/properties/p27-deadlock-witness.property.test.ts`
    - **Property 27: Deadlock witnesses are exact and complete**
    - **Validates: Requirements 16.2, 16.3, 16.4, 16.5, 16.6**

  - [x]* 9.10 Write unit tests for Stage 3 edge cases
    - `test/unit/stage3.test.ts`: the SCC_Analyzer throws `DeadlockWitnessInvariantError` on an inconsistent input; the last remaining Part uses axis 0 with escape distance 0; a Part with both shorter extents 0 has `+Infinity` slenderness and no `NaN` key
    - _Requirements: 14.8, 15.5, 16.7_

- [ ] 10. Pipeline entry point
  - [x] 10.1 Implement `solveDisassembly()` in `src/pipeline.ts`
    - Exactly `validateConfig → stage0ParseScene → stage1Prepare → stage2BuildDbg → stage3Peel`, returning error results as values without throwing and without mutating the input
    - _Requirements: 2.11, 3.3, 6.3, 6.6, 6.7, 7.1, 7.6, 8.4, 14.5, 16.1, 30.1, 30.6, 30.7_

  - [ ]* 10.2 Write property test for configuration validation
    - Create `test/arbitraries/configs.ts`; compare `validateConfig` and `solveDisassembly` with a per-field reference predicate, including hierarchies that would also trigger a geometry error; test in `test/properties/p03-config-validation.property.test.ts`
    - **Property 3: Configuration validation matches a reference model**
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 3.6, 6.6**

  - [ ]* 10.3 Write property test for geometry error precedence
    - Uses `test/arbitraries/hierarchies.ts` with injected defects; test in `test/properties/p09-geometry-errors.property.test.ts`
    - **Property 9: Geometry errors are classified by precedence and returned as values**
    - **Validates: Requirements 4.8, 4.9, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.6, 30.7**

  - [ ]* 10.4 Write property test for sampling metadata
    - Dense triangle counts near 150,000, 300,000 and 300,001, plus plans from small generated Assemblies; test in `test/properties/p10-sampling-metadata.property.test.ts`
    - **Property 10: Sampling metadata follows the stride formula**
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [ ]* 10.5 Write property test for normalization
    - Assemblies placed within `[-1e4, 1e4]` with extents over six orders of magnitude; test in `test/properties/p12-normalization.property.test.ts`
    - **Property 12: Normalization fixes extent and center and round-trips**
    - **Validates: Requirements 8.1, 8.2, 8.4, 8.5**

  - [ ]* 10.6 Write unit tests for pipeline examples
    - `test/unit/pipeline.test.ts`: an omitted seed gives the same plan as `DEFAULT_SEED`; a 150,001-triangle two-Part Assembly (tagged `slow`) gives stride 2 and the poly-budget flag, keeps full Part and BVH triangle counts, and still returns a plan without throwing
    - _Requirements: 3.7, 7.5, 7.6_

- [x] 11. Checkpoint - Stages 0 to 3 and pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Stage 4: motion primitives and Trajectory_Compiler
  - [x] 12.1 Implement `src/primitives/types.ts` and `src/primitives/se3.ts`
    - `MotionPrimitive`, `PrimitivePartInfo`, `PrimitiveContext`, `PrimitiveRegistry` interfaces; pose math: Rodrigues rotation about an axis through a pivot, composition, and applying a pose to a point; row-major 9-element rotation
    - _Requirements: 17.3, 18.2_

  - [x] 12.2 Implement `createPrimitiveRegistry()` in `src/primitives/registry.ts`
    - `register` validates the five members (name `/^[a-z][a-z0-9_]{0,63}$/`, finite priority, three functions) and rejects duplicates; `get` with exact case-sensitive lookup; `list()` sorted by descending priority then ascending code-unit name on every call; `select` returns the first applicable listed primitive or `NoApplicablePrimitive` naming the Part_ID; rejected operations leave the registry unchanged
    - _Requirements: 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10_

  - [x] 12.3 Implement `linear_slide` in `src/primitives/linearSlide.ts`
    - Priority 0, always applicable, params `{ dir, distance }`, pose `R = I`, `T = t·s·dir`; validate `t` (`PrimitiveRangeError`) and params (`PrimitiveParamError`) before returning a pose
    - _Requirements: 17.1, 18.1, 18.2, 18.3, 18.6, 18.7, 18.8, 19.6_

  - [x] 12.4 Implement `helical_unscrew` in `src/primitives/helicalUnscrew.ts`
    - Priority 20; applicable when the Part is a Fastener and `atan2(|dir × a1|, |dir · a1|)` is at most the helical angular tolerance; params `{ dir, distance, axis: a1 × sign(a1 · dir), pivot: obbCenter, pitch: config.threadPitch }`; pose `θ = 2π·t·s/p`, `R = Rodrigues(axis, θ)`, `T = pivot − R·pivot + t·s·dir`; same `t` and param validation
    - _Requirements: 17.1, 18.1, 18.2, 18.4, 18.6, 18.7, 18.8, 19.4, 19.8_

  - [x] 12.5 Implement `two_step_l_slide` in `src/primitives/twoStepLSlide.ts`
    - Priority 30; applicable exactly when `step.secondary !== null`; params `{ d1, s1, d2, s2 }`; piecewise translation with `R = I`; reject `|d1·d2| > 1e-9` and the shared invalid cases
    - _Requirements: 17.1, 18.1, 18.2, 18.5, 18.7, 18.8, 19.5, 19.9_

  - [x] 12.6 Add `createDefaultPrimitiveRegistry()` to `src/primitives/registry.ts`
    - Registers exactly `linear_slide`, `helical_unscrew` and `two_step_l_slide`
    - _Requirements: 17.2_

  - [x] 12.7 Implement `stage4Compile()` in `src/stage4/trajectoryCompiler.ts`
    - Reject non-solved plans with `{ kind: 'PlanNotSolved', status }`; validate the config; for each Plan_Step in order, build `PrimitivePartInfo` from the `Stage1Result` (Fastener flag from `partMetrics`, PCA1, OBB) and emit `{ partId, primitive, params }` from `registry.select(...)` and `buildParams(...)`; default to `createDefaultPrimitiveRegistry()`; never write to the plan
    - _Requirements: 19.1, 19.2, 19.3, 19.7, 19.10_

  - [ ]* 12.8 Write property test for the Primitive_Registry
    - Create `test/arbitraries/primitives.ts` (valid and invalid primitives, params, `t` values, plans with Part info); test in `test/properties/p28-registry.property.test.ts`
    - **Property 28: The Primitive_Registry orders, looks up and rejects consistently**
    - **Validates: Requirements 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10**

  - [ ]* 12.9 Write property test for built-in poses
    - Uses `test/arbitraries/primitives.ts`; compares `helical_unscrew` with an independently built quaternion reference; test in `test/properties/p29-primitive-poses.property.test.ts`
    - **Property 29: Built-in poses are rigid and follow their formulas**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6**

  - [ ]* 12.10 Write property test for invalid primitive inputs
    - Uses `test/arbitraries/primitives.ts`; test in `test/properties/p30-primitive-rejection.property.test.ts`
    - **Property 30: Invalid primitive inputs are rejected**
    - **Validates: Requirements 18.7, 18.8**

  - [ ]* 12.11 Write property test for the Trajectory_Compiler
    - Uses `test/arbitraries/primitives.ts` with directions near the helical tolerance and steps with and without `secondary`; test in `test/properties/p31-trajectory-compiler.property.test.ts`
    - **Property 31: The Trajectory_Compiler selects the highest-priority applicable primitive**
    - **Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.8, 19.9, 19.10**

  - [x]* 12.12 Write unit tests for Stage 4 examples
    - `test/unit/stage4.test.ts`: the default registry lists exactly the 3 built-ins; deadlocked and error plans are rejected with their status; a supplied solved plan with a non-null `secondary` compiles that step to `two_step_l_slide`
    - _Requirements: 17.2, 19.7, 19.10_

- [x] 13. Clash_Checker oracle
  - [x] 13.1 Implement `checkClashes()` in `src/oracle/clashChecker.ts`
    - Import only `three`, `three-mesh-bvh`, `../types`, `../math/vec3` and `../math/aabb`; validate the config (throw `InvalidSolverConfigError`), the direction (`InvalidDirectionError`) and the static set (`MovingPartInStaticSetError`) before casting
    - Recompute face normals and areas from winding; welded-vertex sources with area-weighted normals, the largest-incident-triangle fallback at `|Σ| <= 1e-12`, and no ray when every incident triangle has zero area; positive-area centroid sources; Micro_Shrink offsets; per-Part source cache in a `WeakMap`
    - Own all-hit loop around `bvh.raycast(ray, DoubleSide, 0, Infinity)` and own filter (drop `distance < eps` and `dot(n, rayDir) >= −tau`, keep the nearest across all targets, ties by Part_ID then triangle); exact swept-AABB culling; sorted plain-data `ClashResult`
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10, 20.11, 20.12, 20.13, 20.14_

  - [x] 13.2 Write the Clash_Checker import-isolation static test
    - `test/static/clash-independence.test.ts`: follow import specifiers from `src/oracle/clashChecker.ts` recursively and fail if `src/stage2/sampler.ts`, `src/prng.ts`, `src/stage2/hitFilter.ts` or `src/stage2/rayCast.ts` is reachable
    - _Requirements: 20.11_

  - [x] 13.3 Write property test for the Clash_Checker against a brute-force reference
    - Create `test/helpers/reference/clash.ts` (enumerates welded vertices and positive-area centroids, computes origins independently, intersects every triangle without a BVH; may use `test/helpers/reference/raycast.ts`, creating it if absent); include knife-edge vertices, zero-area triangles and empty static sets; literal seed, at least 100 runs; test in `test/properties/p23-clash-checker-reference.property.test.ts`
    - **Property 23: The Clash_Checker matches a brute-force reference**
    - **Validates: Requirements 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.10**

  - [x] 13.4 Write property test for hit masking in both filters
    - Create `test/arbitraries/layers.ts` (stacks of 1 to 4 coincident, grazing, back-facing or opposing triangles along a ray); assert both `src/stage2/hitFilter.ts` and `checkClashes` report an Opposing_Normal_Collision exactly when an opposing layer lies at distance `>= Clearance_Epsilon`, with the nearest such layer's index; literal seed, at least 100 runs; test in `test/properties/p20-no-masking.property.test.ts`
    - **Property 20: Discarded hits never mask a farther opposing hit**
    - **Validates: Requirements 13.5, 13.6, 20.8, 20.9**

  - [x]* 13.5 Write unit tests for Clash_Checker edge cases
    - `test/unit/clash-checker.test.ts`: a knife-edge vertex uses the largest incident triangle (lowest index on ties); an empty static set gives count 0 and empty lists
    - _Requirements: 20.1, 20.4_

- [ ] 14. Naive radial explosion baseline
  - [x] 14.1 Implement `computeNaiveRadialClashes()` in `src/stage4/naiveBaseline.ts`
    - Validate the config; throw `AssemblyNotNormalizedError { measuredMaxExtent }` when `|maxExtent − 1| > 1e-6` from exact AABBs; directions from the mean OBB center (or `[0, 1, 0]` within `1e-9`); `checkClashes` per Part in Part_ID order against all other Parts; per-Part results including zero counts, sorted clashes, and `totalClashes`; never mutate the input
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.7, 21.8, 21.9_

  - [ ]* 14.2 Write property test for the Naive_Baseline
    - Uses `test/arbitraries/assemblies.ts` plus symmetric layouts with a Part at the centroid; test in `test/properties/p32-naive-baseline.property.test.ts`
    - **Property 32: The Naive_Baseline agrees with the Clash_Checker**
    - **Validates: Requirements 21.2, 21.3, 21.4, 21.5**

  - [ ]* 14.3 Write property test for stage misuse
    - Test in `test/properties/p33-stage-misuse.property.test.ts`; assert the ray counter stays 0 in every case
    - **Property 33: Misusing a stage function throws a typed error before any ray is cast**
    - **Validates: Requirements 12.8, 20.12, 20.13, 21.7**

- [x] 15. Public API surface
  - [x] 15.1 Wire all exports in `src/index.ts`
    - Functions `solveDisassembly`, `stage0ParseScene`, `stage1Prepare`, `stage2BuildDbg`, `stage3Peel`, `stage4Compile`, `createPrimitiveRegistry`, `createDefaultPrimitiveRegistry`, `checkClashes`, `computeNaiveRadialClashes`, `validateConfig`, `computeSamplingMetadata`; constants `DEFAULT_SOLVER_CONFIG`, `DEFAULT_SEED`, `CANONICAL_DIRECTIONS`, `POLY_BUDGET`, `UNBOLT_CORE_VERSION = "0.1.0"`; all thrown error classes and all types from `types.ts` and `primitives/types.ts`
    - _Requirements: 1.4, 21.1, 30.1, 30.2, 30.3, 30.4, 30.5_

  - [x]* 15.2 Write the type-narrowing test
    - `test/types/narrowing.test-d.ts`, checked by `tsc --noEmit`: `@ts-expect-error` shows `steps`, `witness` and `error` are reachable only after narrowing on `status`; import every Req 30.3 type from `@unboltkit/core`
    - _Requirements: 30.3, 30.4_

  - [x]* 15.3 Write unit tests for the public API
    - `test/unit/public-api.test.ts`: every Req 30.1 and 30.2 export exists at the package root; stage results are not thenables
    - _Requirements: 1.4, 30.1, 30.2_

- [x] 16. Checkpoint - Core engine complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Sample kits
  - [x] 17.1 Implement parameter, naming and material helpers in `packages/sample-kits/src/shared/`
    - `params.ts`: `KitParameterError { param, value }` and validators for unknown keys, wrong types, non-finite values, non-integers and out-of-range values, run before any geometry is built
    - `naming.ts`: the mesh-name pattern `^(?=.{1,64}$)[a-z]{3,}(?:[_-][a-z]+)*(?:_\d+)?$`, indexed category names and a uniqueness guard
    - `materials.ts`: a fresh palette per kit call of untextured `MeshStandardMaterial`/`MeshPhysicalMaterial`, one per mesh
    - _Requirements: 22.5, 22.7, 22.10, 23.8_

  - [x] 17.2 Implement geometry and Construction_Axis helpers in `packages/sample-kits/src/shared/`
    - `geometry.ts`: `ensureIndexed`, `dropCollapsedTriangles`, `assertFiniteGeometry`, outline helpers, gear tooth outline with keyed bore, and the keyed lathe screw recipe (pan head and shaft, two clamped flats, one index flat)
    - `constructionAxis.ts`: sets `mesh.userData.constructionAxis = [x, y, z]` in the mesh's local geometry frame
    - No `three-bvh-csg`, no randomness, no clock reads, no I/O
    - _Requirements: 3.2, 22.2, 22.3, 22.6, 22.9, 22.15, 22.16, 23.11, 23.12_

  - [x] 17.3 Implement `buildMechanicalKeyboard65()` in `packages/sample-kits/src/keyboard65.ts`
    - `layout` parameter: `'full65'` (default: 68 keycaps, 68 switches, `bottom_case`, `top_frame`, `plate`, `pcb`, 6 keyed `case_screw`s inserted from below) or `{ rows: 1..5, columns: 1..15 }` (case, frame, plate and PCB sized to the grid, 4 corner screws); export `KEYBOARD_FIXTURE_LAYOUT = { rows: 2, columns: 3 }`
    - Keycaps as extruded rounded rectangles with a chamfered corner, taper and tilt; switches as 4-segment lathes with a flange and an off-center stem; every Part one connected Watertight_Solid_Part with gaps and walls of at least `1e-3 × maxExtent`, Frame_Unique features balanced for the PCA tilt bound, full-footprint blocking contacts, Construction_Axis recorded, and triangle totals within the showcase and fixture caps
    - _Requirements: 3.8, 22.1, 22.4, 22.11, 22.13, 22.14, 22.15, 22.16, 22.17, 23.1, 23.5, 23.6, 23.8, 23.9, 23.10, 23.11, 23.12_

  - [x] 17.4 Implement `buildPlanetaryGearbox3Stage()` in `packages/sample-kits/src/planetaryGearbox.ts`
    - `planetsPerStage` integer 3..6 (default 3); child `Group`s `stage_1` to `stage_3`, each with `sun_gear_N`, `planet_gear_N`s, `carrier_N` and `ring_gear_N`; `housing`, `housing_base`, `housing_cover` and 4 keyed `housing_fastener_N`s; extruded gears with keyed bores and at least 0.3 mm backlash; same construction rules as the keyboard
    - _Requirements: 3.8, 22.1, 22.4, 22.11, 22.13, 22.15, 22.16, 22.17, 23.2, 23.6, 23.8, 23.11, 23.12_

  - [x] 17.5 Implement `buildHauntedClockworkLockbox()` in `packages/sample-kits/src/hauntedLockbox.ts`
    - `gearCount` integer 2..5 (default 3); lathe `box_body` with a keyed outer flat, extruded `lid` with fastener and spindle holes, `clock_gear_N`s and `gear_spindle_N`s, extruded `latch`, 2 keyed `lid_fastener_N`s into 2 `screw_standoff_N`s; same construction rules as the keyboard
    - _Requirements: 3.8, 22.1, 22.4, 22.11, 22.13, 22.15, 22.16, 22.17, 23.3, 23.6, 23.8, 23.11, 23.12_

  - [x] 17.6 Implement `buildDeadlockCageDumbbellRing()` in `packages/sample-kits/src/cageDumbbellRing.ts`
    - Lathe `dumbbell` (knob radius above the ring's outer radius) and lathe `captive_ring` (bore between the bar radius plus gap and the knob radius); interlock purely by geometry; gaps of at least `5e-4` normalized, no cross-Part intersections or weld-distance vertices, thickness rule met, under the cage triangle cap
    - _Requirements: 22.14, 22.15, 22.16, 22.17, 24.1, 24.2, 24.3, 24.4, 24.5, 24.6_

  - [x] 17.7 Implement `buildDeadlockCageShipInBottle()` in `packages/sample-kits/src/cageShipInBottle.ts`
    - `ballCount` integer 1..3 (default 2); closed lathe `bottle` with a narrow neck and wall thickness, and `ship_ball_N` spheres larger than the neck; same cage construction rules
    - _Requirements: 22.14, 22.15, 22.16, 22.17, 24.1, 24.2, 24.3, 24.4, 24.5, 24.6_

  - [x] 17.8 Export the kits from `packages/sample-kits/src/index.ts`
    - All five Kit_Builders, `KEYBOARD_FIXTURE_LAYOUT`, `KitParameterError`, and the `SHOWCASE_KITS` and `DEADLOCK_CAGES` registries of `{ name, build }` entries
    - _Requirements: 22.1, 23.9, 24.1_

  - [x]* 17.9 Write sample-kits unit tests
    - `packages/sample-kits/test/unit/`: naming pattern and uniqueness, one untextured PBR material per mesh, and a Node import and build of every kit with `window` and `document` undefined
    - _Requirements: 22.5, 22.7, 22.12_

  - [x]* 17.10 Write property test for kit well-formedness and determinism
    - Create `packages/sample-kits/test/arbitraries/kitParams.ts` (valid and single-invalid parameter objects per Kit_Builder, all keyboard grids); test in `packages/sample-kits/test/properties/p38-kit-wellformed.property.test.ts`
    - **Property 38: Kit builders are well-formed and deterministic**
    - **Validates: Requirements 3.8, 22.1, 22.2, 22.5, 22.7, 22.8, 23.10**

  - [x]* 17.11 Write property test for invalid kit parameters
    - Uses `packages/sample-kits/test/arbitraries/kitParams.ts`; test in `packages/sample-kits/test/properties/p39-kit-params.property.test.ts`
    - **Property 39: Invalid kit parameters are rejected**
    - **Validates: Requirements 22.10, 23.9**

- [x] 18. Kit guarantee tests in the core suite
  - [x] 18.1 Implement kit geometry test helpers in `test/helpers/kitGeometry.ts`
    - AABB-culled brute-force triangle-triangle distance, triangle-triangle intersection test, inward-ray thickness measurement, and lookup of a Part's source mesh by node path for reading `userData.constructionAxis`; imports nothing from `src/` except types
    - _Requirements: 22.15, 23.12, 24.3, 24.4_

  - [x] 18.2 Write the node-environment smoke test
    - `test/unit/environment-smoke.test.ts`: assert `typeof window === 'undefined'` and `typeof document === 'undefined'`, then run Stages 0 to 4 and `computeNaiveRadialClashes()` on the lockbox and assert on their outputs (solved status, one Trajectory_Step per Plan_Step, one baseline entry per Part)
    - _Requirements: 1.3, 22.12_

  - [x] 18.3 Write the PCA tilt kit test in `test/kits/pca-tilt.test.ts`
    - For every showcase kit at defaults and the Keyboard_Fixture: run Stages 0 and 1, match Parts to meshes by node path, require a finite unit `constructionAxis`, map it with `transformDirection(mesh.matrixWorld)`, compute `L`, the Radial_Clearance lower bound with `kitGeometry.ts`, and `min_k arccos(min(1, |a · PCAk|))`
    - Collect every Part whose angle exceeds `0.25 × Radial_Clearance / L` and fail with the kit name, node name, angle and bound of each
    - _Requirements: 23.12, 23.13_

  - [x] 18.4 Write the sample coverage diagnostic in `test/kits/sample-coverage.test.ts`
    - For all 5 kits at defaults and the Keyboard_Fixture: find every Expected_Blocking_Edge with `checkClashes` for each ordered pair and each of A's 32 Candidate_Axes with B as the only static Part; run `stage2BuildDbg(stage1, config, { collectRayCounts: true })`; count `forwardRays + backwardRays` (0 and a `pruned` flag when absent)
    - Report one line per edge (kit, `from`, `to`, `dirIndex`, count, pruned flag), then fail listing every edge with a count below 2
    - _Requirements: 22.17, 22.18_

  - [x] 18.5 Write the fixed-assembly pruning soundness test in `test/kits/pruning-soundness.test.ts`
    - For both cages, the lockbox, the gearbox and the Keyboard_Fixture, assert every Part passes `test/helpers/watertight.ts` under the default Micro_Shrink, then compare `stage2BuildDbg` with pruning enabled and fully disabled over every Candidate_Axis; never run the unpruned DBG on the full keyboard
    - _Requirements: 11.4, 11.6, 22.16_

  - [x]* 18.6 Write kit solve example tests
    - `test/kits/kits-solve.test.ts`: each showcase kit and the Keyboard_Fixture solve at defaults with one Plan_Step per Part and no repeated Part_ID; in the default keyboard plan every `case_screw` step precedes the `pcb` step, selected by node name; each cage is deadlocked with 0 steps and at least 1 SCC; solving a kit with every `userData` cleared deep-equals solving it unchanged
    - _Requirements: 16.9, 23.4, 23.5_

  - [x]* 18.7 Write kit structure and budget tests
    - `test/kits/structure.test.ts`: composition counts by name category and Fastener status via `partMetrics` (keyboard, gearbox, lockbox, grid layouts); category names; `ExtrudeGeometry`/`LatheGeometry` for gears, cases, frames, plates, keycaps, housings, carriers, box bodies and lids; triangle budgets; one Island per mesh; cage Part-count or triangle-count distinctness
    - _Requirements: 22.4, 22.11, 22.13, 22.14, 23.1, 23.2, 23.3, 23.6, 23.7, 23.8, 23.10, 24.1, 24.5, 24.6_

  - [x]* 18.8 Write kit geometry guarantee tests
    - `test/kits/geometry.test.ts`: every Part at defaults and in the Keyboard_Fixture is watertight with positive signed volume and thickness above `4e-4`; showcase and fixture Parts are Frame_Unique with `minRelativeMargin >= 1e-3`; every kit Part's BVH root box contains its exact AABB within `1e-6`; cage gaps of at least `5e-4`, no cross-Part intersections and no weld-distance vertices; every cage Part is blocked along every Candidate_Axis per `checkClashes`
    - _Requirements: 9.2, 22.15, 22.16, 23.11, 24.2, 24.3, 24.4_

- [x] 19. Checkpoint - Kits
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. Cross-cutting properties and static checks
  - [ ]* 20.1 Write property test for plain-data results
    - All 5 kits at defaults as examples plus `test/arbitraries/assemblies.ts`; check plans, witnesses, errors, Trajectory_Steps, baseline and clash results with `plainData.ts` and `structuredClone`; test in `test/properties/p01-plain-data.property.test.ts`
    - **Property 1: Public results are plain data and survive structuredClone**
    - **Validates: Requirements 1.5, 1.6**

  - [ ]* 20.2 Write property test for input immutability
    - Uses `test/arbitraries/hierarchies.ts` and `test/helpers/snapshot.ts` across every stage function, `solveDisassembly`, `stage4Compile`, `computeNaiveRadialClashes` and `checkClashes`, on both returning and throwing paths; test in `test/properties/p02-no-mutation.property.test.ts`
    - **Property 2: Inputs are never mutated**
    - **Validates: Requirements 1.8, 2.11, 4.7, 6.7, 8.8, 19.1, 21.9**

  - [ ]* 20.3 Write property test for determinism
    - Build each generated Assembly twice from one description and compare every output under `Object.is`; include each kit at defaults as an example; test in `test/properties/p04-determinism.property.test.ts`
    - **Property 4: Deterministic outputs for identical inputs**
    - **Validates: Requirements 3.1, 3.3, 3.4, 3.5, 7.7, 9.6, 10.6, 11.8, 12.7, 14.9, 15.8, 16.8, 20.14, 21.8**

  - [ ]* 20.4 Write property test for stage chaining
    - Uses `test/arbitraries/hierarchies.ts` with valid and invalid configs; test in `test/properties/p05-stage-chaining.property.test.ts`
    - **Property 5: Chaining the stage functions equals the pipeline**
    - **Validates: Requirements 30.6**

  - [x]* 20.5 Write purity and determinism-source static tests
    - `test/static/purity.test.ts`: manifest dependency sets for both packages; `src/` imports only `three`, `three-mesh-bvh` and relative files; no DOM or WebGL globals, `process`, Node built-ins or `node:` specifiers; no `userData`; no kit node-name literals; one source file per built-in primitive; inside `stage1/`, `math/onb.ts` is called only from the F3 branch; sample-kits imports only `three` and has no I/O
    - `test/static/determinism-sources.test.ts`: no `Math.random`, `crypto`, `Date` or `performance.now` in either package's `src/` or in any test file
    - _Requirements: 1.1, 1.2, 1.7, 3.2, 9.7, 15.6, 17.1, 22.3, 22.6, 22.9_

  - [x]* 20.6 Write no-swallow and no-trivial-assert static tests
    - `test/static/no-swallow.test.ts`: every `catch` in `src/` and `test/` rethrows or returns a structured error value; `test/static/no-trivial-assert.test.ts`: rejects `expect(true)`, identical-operand `toBe`, and properties returning a constant
    - _Requirements: 25.4, 25.5_

  - [ ]* 20.7 Write the harness meta-test
    - `test/unit/harness-meta.test.ts`: `fc.check` Property 24's predicate against a test-only peel wrapper that swaps the last two steps; assert `failed`, seed, counterexample, path and `numRuns`, and that `{ seed, path }` reproduces the counterexample; a second variant with a throwing stub reports the error with the seed
    - _Requirements: 25.3, 25.7, 25.8_

- [x] 21. Invariant test harness
  - [x] 21.1 Implement the Full_Keyboard_Run_Count parser and Vitest global setup
    - `test/helpers/fullKeyboardRuns.ts`: pure `parseFullKeyboardRunCount(raw)` (unset gives 10; `^[1-9][0-9]*$` with `BigInt(raw) <= BigInt(Number.MAX_SAFE_INTEGER)` gives that integer; anything else gives `ok: false` with a message naming `UNBOLT_FULL_KB_RUNS`, the `JSON.stringify`-quoted value and the accepted format); `FULL_KB_RUNS` computed at load, throwing on failure and never substituting 10
    - `test/helpers/fullKeyboardRuns.global.ts` calls the same parser and throws on failure; register it as `globalSetup` in `vitest.config.ts`
    - _Requirements: 1.7, 25.10, 25.11, 25.12_

  - [x]* 21.2 Write unit tests for the run-count parser
    - `test/unit/full-keyboard-runs.test.ts`: table of unset, `'1'`, `'10'`, `'100'`, `'9007199254740991'`, and rejected `''`, `'0'`, `'01'`, `'-3'`, `'1.5'`, `' 10'`, `'1e3'`, `'ten'`, `'9007199254740992'` with message content checks
    - _Requirements: 25.10, 25.11, 25.12_

  - [x]* 21.3 Write property-config and SE3 single-source static tests
    - `test/static/property-config.test.ts`: every `fc.assert` in `*.property.test.ts` has a literal seed and `numRuns` that is a literal `>= 100` or `FULL_KB_RUNS`, and `FULL_KB_RUNS` appears only in the three Full_Keyboard invariant files; `test/static/se3-single-source.test.ts`: Invariant 1, 2 and 3 files import `test/arbitraries/se3.ts` and no other file builds an SE3 arbitrary
    - _Requirements: 25.2, 25.9, 26.2, 27.1, 28.7, 29.3_

- [x] 22. Invariant 1: zero-clash steps
  - [x] 22.1 Write the Invariant 1 property test for the lockbox
    - `test/invariants/invariant1-lockbox.property.test.ts`: literal `SEED`, `numRuns: 100`; per run, a fresh kit, an SE3_Transform from the shared arbitrary applied to the root, a generated config seed in `[0, 4294967295]` with other fields at defaults; fail on non-solved status with kit, transform, seed and status; for every step `i`, `checkClashes` against exactly the Parts of later steps must report 0, else fail with step, Part_ID, `dir`, count and triangle lists; per-file `testTimeout` of 10 minutes and no `interruptAfterTimeLimit`
    - **Property 34: Invariant 1, every step of a solved Invariant_Kit plan is clash-free**
    - **Validates: Requirements 26.1, 26.2, 26.3, 26.4, 21.6, 23.4, 14.7**

  - [x] 22.2 Write the Invariant 1 property test for the gearbox
    - `test/invariants/invariant1-gearbox.property.test.ts`: same structure as 22.1 with its own literal seed and `numRuns: 100`
    - **Property 34: Invariant 1, every step of a solved Invariant_Kit plan is clash-free**
    - **Validates: Requirements 26.1, 26.2, 26.3, 26.4, 21.6, 23.4, 14.7**

  - [x] 22.3 Write the Invariant 1 property test for the Keyboard_Fixture
    - `test/invariants/invariant1-keyboard-fixture.property.test.ts`: kit built with `KEYBOARD_FIXTURE_LAYOUT`, own literal seed, `numRuns: 100`
    - **Property 34: Invariant 1, every step of a solved Invariant_Kit plan is clash-free**
    - **Validates: Requirements 26.1, 26.2, 26.3, 26.4, 21.6, 23.4, 14.7**

  - [x] 22.4 Write the Invariant 1 property test for the Full_Keyboard
    - `test/invariants/invariant1-full-keyboard.property.test.ts`: default layout, own literal seed, `numRuns: FULL_KB_RUNS` from `test/helpers/fullKeyboardRuns.ts`, `testTimeout` of 30 minutes
    - **Property 34: Invariant 1, every step of a solved Invariant_Kit plan is clash-free**
    - **Validates: Requirements 26.1, 26.2, 26.3, 26.4, 21.6, 23.4, 14.7, 25.10, 25.11, 25.12**

- [x] 23. Invariant 2: SE(3) rigid-motion equivariance
  - [x] 23.1 Write the Invariant 2 property test for the lockbox
    - `test/invariants/invariant2-lockbox.property.test.ts`: literal `SEED`, fixed config seed per property, `numRuns: 100`; per run, a fresh transformed instance (SE3 composed onto the root with `applySe3.ts`) and the memoized untransformed solve; assert equal status; when solved, equal step count, the same Part_ID set and 0 `checkClashes` collisions per transformed step against the Parts not yet removed; Candidate_Axes 26 to 31 of each transformed Part equal `R` times the untransformed ones within `1e-6`; never catch solver errors; failures report kit, seed, quaternion and translation
    - **Property 35: Invariant 2, solving is invariant under rigid motion**
    - **Validates: Requirements 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 27.8**

  - [x] 23.2 Write the Invariant 2 property test for the gearbox
    - `test/invariants/invariant2-gearbox.property.test.ts`: same structure as 23.1, own literal seed, `numRuns: 100`
    - **Property 35: Invariant 2, solving is invariant under rigid motion**
    - **Validates: Requirements 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 27.8**

  - [x] 23.3 Write the Invariant 2 property test for the Keyboard_Fixture
    - `test/invariants/invariant2-keyboard-fixture.property.test.ts`: kit built with `KEYBOARD_FIXTURE_LAYOUT`, own literal seed, `numRuns: 100`
    - **Property 35: Invariant 2, solving is invariant under rigid motion**
    - **Validates: Requirements 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 27.8**

  - [x] 23.4 Write the Invariant 2 property test for the Full_Keyboard
    - `test/invariants/invariant2-full-keyboard.property.test.ts`: default layout, own literal seed, `numRuns: FULL_KB_RUNS`, `testTimeout` of 30 minutes
    - **Property 35: Invariant 2, solving is invariant under rigid motion**
    - **Validates: Requirements 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 27.8, 25.10, 25.11, 25.12**

- [x] 24. Invariant 3: deadlock cages
  - [x] 24.1 Write the Invariant 3 property test for the dumbbell-and-ring cage
    - `test/invariants/invariant3-cages-dumbbell-ring.property.test.ts`: literal `SEED`, `numRuns: 100`, SE3_Transform from the shared arbitrary on the root, generated config seed with other fields at defaults; assert `deadlocked` with 0 steps, at least one SCC of at least 2 Assembly Part_IDs, and for every witness edge: both ends in the same SCC, `d` equal to one of A's Candidate_Axes within `1e-9`, non-empty sorted unique in-range triangle lists, and at least 1 collision from `checkClashes` with A moving along `d` against B alone
    - **Property 36: Invariant 3, deadlock cages are always reported as deadlocked**
    - **Validates: Requirements 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7**

  - [x] 24.2 Write the Invariant 3 property test for the ship-in-bottle cage
    - `test/invariants/invariant3-cages-ship-in-bottle.property.test.ts`: same structure as 24.1, own literal seed, `numRuns: 100`
    - **Property 36: Invariant 3, deadlock cages are always reported as deadlocked**
    - **Validates: Requirements 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7**

- [x] 25. Invariant 4: merged-mesh island recovery
  - [x] 25.1 Write the Invariant 4 property test for the lockbox
    - `test/invariants/invariant4-lockbox.property.test.ts`: literal `SEED`, `numRuns: 100` accepted subsets; generate a subset of 2 to all Parts (biased toward 2 to 16, "all" reachable) and an indexed/non-indexed flag; bake world transforms into positions and normals in one identity-transform Mesh; `fc.pre` rejects subsets with cross-Part vertices closer than the default Weld_Tolerance relative to the subset diagonal; fail if the skip limit is reached
    - Assert the merged Part count equals the unmerged count, a one-to-one Island match by triangle count and vertex positions within Weld_Tolerance, no MonolithicMeshError, and, when the unmerged subset solves, the merged input solves with one step per Part, unique Part_IDs and 0 `checkClashes` collisions per step against the still-unremoved merged Parts
    - **Property 37: Invariant 4, merged meshes split back into their source Parts**
    - **Validates: Requirements 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7**

  - [x] 25.2 Write the Invariant 4 property test for the gearbox
    - `test/invariants/invariant4-gearbox.property.test.ts`: same structure as 25.1, own literal seed, `numRuns: 100` accepted subsets
    - **Property 37: Invariant 4, merged meshes split back into their source Parts**
    - **Validates: Requirements 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7**

  - [x] 25.3 Write the Invariant 4 property test for the Keyboard_Fixture
    - `test/invariants/invariant4-keyboard-fixture.property.test.ts`: kit built with `KEYBOARD_FIXTURE_LAYOUT`, own literal seed, `numRuns: 100` accepted subsets
    - **Property 37: Invariant 4, merged meshes split back into their source Parts**
    - **Validates: Requirements 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7**

  - [x] 25.4 Write the Invariant 4 property test for the Full_Keyboard
    - `test/invariants/invariant4-full-keyboard.property.test.ts`: default layout, own literal seed, `numRuns: FULL_KB_RUNS` accepted subsets, `testTimeout` of 30 minutes
    - **Property 37: Invariant 4, merged meshes split back into their source Parts**
    - **Validates: Requirements 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7, 25.10, 25.11, 25.12**

- [x] 26. Ray budget regression
  - [x]* 26.1 Write the ray budget test
    - `test/kits/ray-budget.test.ts`: solve the default Full_Keyboard through `stage2BuildDbg` and assert `stats.raysCast <= 6_000_000` (a deterministic count, no timing)
    - _Requirements: 3.3, 11.5_

- [x] 27. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. The pruning soundness tests (7.9, 18.5), the oracle tests (13.2, 13.3, 13.4), the kit tests required by Req 1.3, 22.18 and 23.13 (18.2, 18.3, 18.4) and all invariant tests (Properties 34 to 37, tasks 22 to 25) are required.
- When an optional property task that creates a shared arbitrary or reference helper is skipped, the first later task that needs that file creates it as described.
- Each property task implements exactly one `fc.assert` with a literal seed, tagged `// Feature: unbolt-core-engine, Property N: <title>`. Each per-kit invariant file is one instance of its design property.
- The Invariant 3 property is split into one file per cage (`invariant3-cages-<cage>`) so each cage has its own `fc.assert` with at least 100 runs, as the design requires.
- Each task references requirement clauses for traceability; checkpoints run `npm run test` once per package, in sequence.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "2.2", "2.5", "2.7", "17.1", "17.2"] },
    { "id": 2, "tasks": ["1.5", "2.3", "2.6", "2.8", "17.3", "17.4", "17.5", "17.6", "17.7"] },
    { "id": 3, "tasks": ["2.4", "2.9", "3.1", "3.2", "17.8"] },
    { "id": 4, "tasks": ["3.3", "17.9", "17.10"] },
    { "id": 5, "tasks": ["3.4", "17.11"] },
    { "id": 6, "tasks": ["3.5", "3.7", "3.8", "5.1", "5.2", "5.3", "5.4", "5.6", "5.8"] },
    { "id": 7, "tasks": ["3.6", "5.5", "5.9"] },
    { "id": 8, "tasks": ["5.7"] },
    { "id": 9, "tasks": ["5.10", "5.11", "5.12", "7.1", "7.2", "7.3", "7.4", "9.1", "9.2", "9.4"] },
    { "id": 10, "tasks": ["5.13", "5.14", "7.5", "7.7", "7.8", "9.3"] },
    { "id": 11, "tasks": ["7.6", "9.5"] },
    { "id": 12, "tasks": ["7.9", "7.10", "7.11", "9.6", "10.1"] },
    { "id": 13, "tasks": ["7.12", "9.7", "9.8", "9.9", "9.10", "10.2", "10.3", "10.4", "10.5", "10.6", "12.1", "13.1"] },
    { "id": 14, "tasks": ["12.2", "12.3", "12.4", "12.5", "13.2", "13.3", "13.4", "13.5", "14.1"] },
    { "id": 15, "tasks": ["12.6", "12.8", "14.2", "14.3"] },
    { "id": 16, "tasks": ["12.7", "12.9", "12.10"] },
    { "id": 17, "tasks": ["12.11", "12.12", "15.1"] },
    { "id": 18, "tasks": ["15.2", "15.3", "18.1", "18.2", "21.1"] },
    { "id": 19, "tasks": ["18.3", "18.4", "18.5", "18.6", "18.7", "18.8", "20.1", "20.2", "20.3", "20.4", "20.5", "20.6", "20.7", "21.2"] },
    { "id": 20, "tasks": ["22.1", "22.2", "22.3", "22.4", "23.1", "23.2", "23.3", "23.4", "24.1", "24.2", "25.1", "25.2", "25.3", "25.4", "26.1"] },
    { "id": 21, "tasks": ["21.3"] }
  ]
}
```
