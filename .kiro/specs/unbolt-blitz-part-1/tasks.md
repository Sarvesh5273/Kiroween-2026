# Implementation Plan: Unbolt Blitz Part 1

## Overview

Implementation language: TypeScript (from the design). All work is in `apps/unbolt-blitz`. `packages/` stays untouched, and nothing imports from `apps/guide-forge`. The plan builds the solver layer first (payload, protocol, `runBlitzSolve`, worker), then the pure engine, then the reducer and store, then the presentation layer (theme, recovery, HUD, viewport and Arena), and finally the composition root. Part 2 features (hints, audio, stars, high scores) are out of scope.

Shell rules for every command task (macos-shell-guard): run one command at a time, double-quote every path, never use GNU `timeout`, never start `npm run dev`, and judge a reported `Exit Code: -1` by the printed output.

## Tasks

- [x] 1. Scaffold and test infrastructure
  - [x] 1.1 Configure the workspace app
    - Edit `apps/unbolt-blitz/package.json`: add dependencies `@unboltkit/core` `"*"`, `@unboltkit/sample-kits` `"*"`, `three` `^0.170.0`; add devDependencies `@types/three` `^0.170.0`, `@types/node` `^22.0.0` (needed for `node:fs` in test helpers; it is not installed at the repository root), `vitest` `^3.2.4`, `fast-check` `^3.23.2`; add the script `"test": "vitest run"`. Keep the existing React and Vite entries.
    - Edit `vite.config.ts`: `server: { port: 5174 }`, `worker: { format: "es" }`, `build: { chunkSizeWarningLimit: 1000 }`.
    - Create `vitest.config.ts` with `environment: "node"`, `testTimeout: 60000`, and `include: ["test/**/*.test.ts"]`.
    - Edit `tsconfig.json`: set `types: ["vite/client", "node"]`, add `test` and `vitest.config.ts` to `include`. In `src/`, type timer handles as `ReturnType<typeof setInterval>` because Node types change the timer return type.
    - Edit `index.html`: set the title to "Unbolt Blitz" and load no web fonts.
    - Do not touch any file under `packages/`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8, 18.1_

  - [x] 1.2 Create seeded test helpers
    - Create `test/helpers/prng.ts` exporting `mulberry32(seed)` and `shuffle(rng, array)`.
    - Create `test/helpers/seeds.ts` with one fixed numeric constant per property (`SEEDS[n]`).
    - Create `test/helpers/deepFreeze.ts` and `test/helpers/sourceScan.ts` (recursive source reader that returns file path plus text for `src/` and `test/`).
    - No helper may call `Math.random`.
    - _Requirements: 17.10, 17.11, 17.12_

- [x] 2. Scene payload, protocol and display names
  - [x] 2.1 Create protocol, level table, and scene payload modules
    - Create `src/protocol.ts` with the types from the design: `BundledLevelId`, `MaterialDescriptor`, `ScenePayloadNode`, `ScenePayload`, `SolveSource`, `SolveRequestMessage`, `StageName`, `PartRenderData`, `BlitzEdge`, `OverBudgetWarning`, `SolveResult` (with `overBudget: OverBudgetWarning | null`), `WorkerRejection` (only `monolithic` and `no-geometry`), `SolveFailure`, `WorkerOutMessage`. Use `import type` for core types and no React or DOM import.
    - Create `src/levels.ts` with `BUNDLED_LEVELS` (id, label, kit name) for Lockbox, Planetary Gearbox, 65% Keyboard, Dumbbell Cage, Ship-in-Bottle.
    - Create `src/recovery/recoveryCause.ts` (type-only `RecoveryCause` union: `monolithic`, `no-geometry`, `unsupported-extension`, `unexpected`; no over-budget cause) so the reducer can depend on it before the recovery UI exists.
    - Create `src/scene/materialDescriptor.ts` (Material to and from `MaterialDescriptor`) and `src/scene/scenePayload.ts` (`objectToPayload` returning `{ root, transfer }` with each `ArrayBuffer` once, and `payloadToObject` preserving child order, names, and local TRS).
    - Write these fresh. Do not import or copy from `apps/guide-forge`.
    - _Requirements: 1.5, 1.6, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.9_

  - [ ]* 2.2 Write property test for scene payload round trip
    - **Property 22: Scene payloads round-trip**
    - Build seeded random `Object3D` trees. Assert same child structure, names, local TRS, and mesh buffer values after `payloadToObject(objectToPayload(tree).root)`. Assert the payload holds no Three.js objects and `transfer` lists each buffer once.
    - File: `test/worker/scenePayload.property.test.ts`
    - **Validates: Requirements 2.6, 2.8**

  - [x] 2.3 Implement display name derivation
    - Create `src/game/displayNames.ts` with `deriveDisplayNames(parts: { partId; nodeName }[])`: split on `[_\-\s]+`, capitalize each piece, empty becomes "Part", duplicates get ` #k` in ascending `partId` order, remaining collisions get ` (partId)`.
    - _Requirements: 10.2, 12.4_

  - [ ]* 2.4 Write property test for display names
    - **Property 26: Display names are readable and unique**
    - Generate seeded node names (empty, repeated, mixed separators). Assert non-empty, pairwise distinct names, and that `lid_fastener_1` maps to `Lid Fastener 1`.
    - File: `test/engine/displayNames.property.test.ts`
    - **Validates: Requirements 10.2, 12.4**

- [x] 3. Worker solve pipeline
  - [x] 3.1 Implement `runBlitzSolve` and its helpers
    - Create `src/worker/buildKit.ts` (look up the kit in `[...SHOWCASE_KITS, ...DEADLOCK_CAGES]` via `BUNDLED_LEVELS`; throw `UnknownKitError` for an unknown id).
    - Create `src/worker/rejection.ts` (`mapCoreError`: `MonolithicMeshError` always to `monolithic` with its `totalTriangles`, whatever the count, and no over-budget case; `EmptyAssemblyError` and `InvalidGeometryError` to `no-geometry`; `ConfigurationError` throws `UnexpectedSolveError`; `toSolveFailure`).
    - Create `src/worker/renderData.ts` (`buildRenderData`: Float32 positions, smoothed normals with fallbacks, indices, material from the source node path, OBB, AABB, `isFastener`, `principalAxis` from `frame.axes[0]`, 32 `candidateAxes`, `displayName`).
    - Create `src/worker/transfer.ts` (`collectTransferables` listing each distinct `ArrayBuffer` once).
    - Create `src/worker/runBlitzSolve.ts` with injectable `BlitzSolveDeps`, `solveRoot`, and `runBlitzSolve`. Order: stage 0, stage 1, stage 2, stage 3, stage 4 only for solved plans. Add no early stop before `stage1Prepare` for multi-part scenes, because Core itself only stops on `MonolithicMeshError`, `EmptyAssemblyError`, `InvalidGeometryError`, and `ConfigurationError`. Set `SolveResult.overBudget` to `{ totalTriangles, polyBudget, stride }` from `stage0.sampling` when `polyBudgetExceeded` is true, else `null`. Slim edges to `{ from, to, dirIndex }`. Emit `onStage` started and completed events. `stage1Prepare` normalizes to `maxExtent = 1.0` before `stage2BuildDbg`, and every BVH and DBG build stays in the worker.
    - Only files under `src/worker/` may import `stage1Prepare`, `stage2BuildDbg`, `stage3Peel`, or `three-mesh-bvh`.
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Implement the worker entry
    - Create `src/worker/blitz.worker.ts`: structural `WorkerPort` interface (no WebWorker lib), `onmessage` calls `runBlitzSolve`, posts `progress`, `rejected`, `solved` (with `collectTransferables`), or `failure`. Every message carries `requestId`. No empty `catch`.
    - _Requirements: 2.1, 2.2, 2.7, 2.8, 3.5_

  - [x] 3.3 Create the memoized real-solve test helper
    - Create `test/helpers/solved.ts` that memoizes `solveRoot` for `buildHauntedClockworkLockbox({ gearCount })` (2 to 5) and for both deadlock cages, and a `runBlitzSolve` call for the default Lockbox through `{ type: "solve", requestId: 1, source: { kind: "bundled", levelId: "lockbox" } }`.
    - _Requirements: 17.6_

  - [x] 3.4 Write property test for solved Lockbox kits
    - **Property 23: Solved kits yield consistent, normalized, playable results**
    - Assert that the real Haunted Clockwork Lockbox (`haunted-clockwork-lockbox`, default `gearCount`, also through `runBlitzSolve` with the bundled `lockbox` request) returns a `solved` plan with non-null `trajectories`. For `gearCount` 2 to 5: `solved` plan, one part per builder mesh node (13 for the default Lockbox), union AABB max extent 1.0 within 1e-9, edges name known parts with `dirIndex` in 0..31, every `TrajectoryStep` and plan step names a Render_Data part once, plan order is a valid dependency order under an independent graph check. Spy stage call order 0 to 4.
    - File: `test/worker/lockbox.solve.test.ts`
    - **Validates: Requirements 2.1, 2.4, 2.5, 2.7, 17.6, 17.7**

  - [x] 3.5 Write real-solve test for the deadlock cages
    - **Property 24 (solve part): Deadlock cages are deadlocked**
    - Run `runBlitzSolve`/`solveRoot` on the real Dumbbell-in-Ring Deadlock Cage (`deadlock-cage-dumbbell-ring`) and on Ship-in-Bottle. Assert that the Dumbbell-in-Ring Deadlock Cage is deadlocked (`plan.status === "deadlocked"`, so the test fails if it comes back `solved`), and the same for Ship-in-Bottle. Also assert `trajectories` null, and a witness with at least 1 SCC of 2 or more parts.
    - File: `test/worker/cage.solve.test.ts`
    - **Validates: Requirements 17.6, 17.8**

  - [ ]* 3.6 Write property test and examples for rejections and the over-budget warning
    - **Property 25: Over-budget multi-part scenes stay playable with a warning, and single solid pieces are always monolithic**
    - Build multi-part scenes (a few disjoint grid-tessellated closed boxes) at 150,000 and 150,001 triangles plus seeded larger counts, and run the real five stages. Assert a `solved` outcome (never a rejection), that the injected `stage1Prepare` is called, that `overBudget` is non-null with `totalTriangles`, `polyBudget` 150,000, and `stride = ceil(T / 150000)` exactly when `T > 150000` and null otherwise, and that the union AABB max extent is 1.0 within 1e-9.
    - Build single-island closed meshes with seeded counts below, at, and above 150,000. Assert a `monolithic` rejection carrying the count and that `stage1Prepare` is never called.
    - Examples: real `EmptyAssemblyError` and `InvalidGeometryError` inputs map to `no-geometry`; `collectTransferables` lists each buffer once.
    - File: `test/worker/rejections.test.ts`
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.11, 2.7, 2.8**

- [x] 4. Checkpoint - Solver layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Pure rules engine
  - [x] 5.1 Implement scoring constants and axis math
    - Create `src/game/scoring.ts` with `BASE_POINTS`, `FASTENER_BONUS`, `COMBO_CAP`, `TRAP_BONUS`, `FALSE_ALARM_PENALTY`, `TIME_PENALTY_MS`, `EXIT_TRAVEL_FLOOR`, `ESCAPE_TIE_TOLERANCE`. Define no aligned-fastener angle constant: the tolerance is Core's `DEFAULT_SOLVER_CONFIG.helicalAngularToleranceDeg` (5 degrees), reached through the injected context.
    - Create `src/game/axisMath.ts` with `escapeDistance(box, dir, others)` (per-part interval formula, `TOUCH = 1e-9`) and vector helpers.
    - Import nothing from DOM, React, or Three.js.
    - _Requirements: 4.1, 4.5, 4.13, 5.2, 5.3, 5.4, 6.3, 7.1, 7.6_

  - [x] 5.2 Implement the engine and dependency factory
    - Create `src/game/blitzEngine.ts`: types (`EnginePart`, `EngineEdge`, `EngineLevelInput`, `EngineLevel`, `EngineState`, `UnboltResult`, `TrapResult`), `createEngineLevel` (throws `RangeError` for duplicate ids, unknown part in an edge, or bad `dirIndex`), `createEngine`, `attemptUnbolt`, `flagDeadlockTrap`, and the read-only queries `liveParts`, `activeEdges`, `unremovedBlockers`, `clearAxes`, `genuineDeadlockSccs`, `allLiveBlocked`, `removedCount`.
    - Legal unbolt: lowest Escape_Distance Clear_Axis with ties to the lowest `dirIndex`; primitive from `level.registry.select(planStep, info, level.ctx)` with `secondary: null`, so Core's helical rule decides and the engine holds no angle constant (the result is `helical_unscrew` or `linear_slide`); params from the selected primitive's `buildParams`; exit distance `max(escape, EXIT_TRAVEL_FLOOR)`; score, combo, removal, victory.
    - Blocked attempt: fewest-blocker axis, sorted ids, combo reset, mistakes and penalty.
    - Trap flag: exposed (+1000, fully live SCCs) or false alarm (combo 1, minus 250 floored at 0, penalty, counter).
    - Rejections return the same state object. A stalemate never completes the level.
    - Use `import type` only from `@unboltkit/core`.
    - Create `src/engineDeps.ts` with `createEngineDeps()` returning `createDefaultPrimitiveRegistry()` and `ctx = { config: DEFAULT_SOLVER_CONFIG }` with no override, so `helicalAngularToleranceDeg` is Core's default of 5. `engineDeps.ts` is the only file that imports `DEFAULT_SOLVER_CONFIG` by value. `blitzEngine.ts` receives the registry and context by injection and imports no DOM, React, or Three.js module.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 11.8_

  - [x] 5.3 Implement solve-result to engine-level conversion
    - Create `src/game/levelData.ts`: `SolveResult` to `EngineLevelInput`, merging `graph.edges` with witness SCC edges (deduplicated), and taking `deadlockSccs` from `plan.witness.sccs[].partIds` (empty for a solved plan).
    - _Requirements: 4.3, 7.3, 7.4_

  - [x] 5.4 Create synthetic level and reference model helpers
    - Create `test/helpers/syntheticLevel.ts`: seeded levels with boxes on a jittered grid, 32 canonical axes, DAG edges (solvable), or a DAG plus an injected mutual-block pair with an independently computed Tarjan witness (deadlocked), some fasteners with a principal axis along a candidate axis.
    - Create `test/helpers/referenceModel.ts`: independent scoring, blocked, false-alarm, and deadlock-oracle model, plus an independent AABB overlap function and a Kahn-style dependency checker.
    - _Requirements: 17.10, 17.11, 17.12_

  - [x] 5.5 Write property test for valid removal orders
    - **Property 1: Any valid removal order completes the level**
    - Multi-order legal unbolting: synthetic acyclic levels with several seeded valid orders each, and the real Lockbox with the plan order plus at least 2 other seeded valid orders (3 distinct orders in total, asserted distinct). Assert every call is `legal`, each removed part had an axis whose blockers (read from the edge list) were removed earlier, and the outcome ends `victory` with an empty live set.
    - File: `test/engine/removalOrder.property.test.ts`
    - **Validates: Requirements 4.2, 4.4, 7.11, 11.8, 17.1, 17.9**

  - [ ]* 5.6 Write property test for active edges and queries
    - **Property 2: Active edges and queries follow the removed set**
    - Assert `activeEdges`, `liveParts`, and `clearAxes` against values recomputed from the edge list after each legal removal.
    - File: `test/engine/queries.property.test.ts`
    - **Validates: Requirements 4.3, 4.4, 4.8, 4.12, 11.8**

  - [ ]* 5.7 Write property test for exit axis choice
    - **Property 3: The chosen exit axis has the smallest Escape_Distance**
    - Use the independent overlap function from the helpers. Check the clear-after and overlap-before translations, the minimum over Clear_Axes within 1e-9, and the lowest `dirIndex` tie rule.
    - File: `test/engine/axisChoice.property.test.ts`
    - **Validates: Requirements 4.5, 4.9**

  - [ ]* 5.8 Write property test for trajectory steps
    - **Property 4: The trajectory step matches the aligned-fastener rule and the geometry**
    - Assert `helical_unscrew` exactly for fasteners whose chosen axis is within `DEFAULT_SOLVER_CONFIG.helicalAngularToleranceDeg` (5 degrees, either sign) of `principalAxis`, using an independent angle function from the helpers, with seeded principal axes placed 0.1 degrees inside and outside the tolerance. Assert that `createEngineDeps().ctx.config` is `DEFAULT_SOLVER_CONFIG` (no override) and that `registry.select` under that context returns the same primitive name, `params.dir` equals `candidateAxes[axisIndex]`, `pose(0)` is identity, and `pose(1)` moves the OBB center by `distance * dir` within 1e-9.
    - File: `test/engine/trajectory.property.test.ts`
    - **Validates: Requirements 4.6, 4.7, 4.9, 4.13, 11.1**

  - [ ]* 5.9 Write property test for rejected calls
    - **Property 5: Rejected calls change nothing**
    - Unknown ids, removed ids, and calls after completion return `rejected` with the identical state object.
    - File: `test/engine/rejections.property.test.ts`
    - **Validates: Requirements 4.10, 7.12**

  - [ ]* 5.10 Write property test for engine determinism
    - **Property 6: The engine is deterministic**
    - Run each seeded call sequence twice from a fresh engine and compare results and final states with deep equality.
    - File: `test/engine/determinism.property.test.ts`
    - **Validates: Requirements 4.11**

  - [x] 5.11 Write property test for scoring against the reference model
    - **Property 7: Scoring, combo and penalties match an independent model**
    - Compare engine state after every call with the reference model. Check combo in 1..8, score at least 0, and `penaltyMs = 3000 * (mistakes + falseAlarms)`. Cover the score, combo, and penalty math explicitly with unit examples: 100 times the combo before the increment, the flat 50 fastener bonus unaffected by combo, the x8 combo cap, the combo reset to x1 on a blocked attempt, the mistakes count, and the 3-second Time_Penalty. Include the false-alarm strike: a `flagDeadlockTrap` on a solvable level subtracts 250 (floored at 0, so start from scores below and above 250), adds 3000 ms, resets the combo to x1, raises the false-alarm count by 1, and leaves mistakes and the live set unchanged.
    - File: `test/engine/scoring.property.test.ts`
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.6, 7.5, 7.6, 7.7, 7.8, 7.9, 17.3**

  - [x] 5.12 Write property test for blocker reporting
    - **Property 8: Blocked attempts report the real blockers**
    - On synthetic levels and on the real Dumbbell Cage graph, assert minimal blocker reporting: `blockerIds` equals the unremoved `to` ends of the fewest-blocker axis computed directly from the edges (lowest `dirIndex` on ties), the reported count equals the minimum over all axes so no other axis has fewer unremoved blockers, and the ids are sorted with no duplicates.
    - File: `test/engine/blockers.property.test.ts`
    - **Validates: Requirements 6.4, 6.5, 17.2**

  - [x] 5.13 Write property test for the trap flag
    - **Property 9: The trap flag agrees with an independent deadlock oracle**
    - Trap flagging: check genuine versus false alarm against the oracle, the +1000 and `interlock_exposed` outcome with the fully live SCCs, the false-alarm effects on a solvable level, and that an all-blocked level stays in play until a flag.
    - File: `test/engine/trap.property.test.ts`
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.10, 14.8, 17.4, 17.5**

  - [x] 5.14 Write engine test for the real deadlock cages
    - **Property 24 (engine part): Deadlock cages are stuck from the first move**
    - Build the engine from the real Dumbbell Cage and Ship-in-Bottle results through `levelData.ts`. Assert no live part has a Clear_Axis, the level stays in play after blocked clicks, and a flag gives +1000 with `interlock_exposed`.
    - File: `test/engine/cage.engine.test.ts`
    - **Validates: Requirements 7.1, 7.2, 7.10, 17.4, 17.5**

  - [ ]* 5.15 Write engine unit tests for edge cases
    - `createEngineLevel` throws `RangeError` for duplicate ids, unknown edge parts, and bad `dirIndex`. Boxes that only touch do not overlap in `escapeDistance`. The last live part gets an exit distance of at least `EXIT_TRAVEL_FLOOR`. Engine source imports no DOM, React, or Three.js module.
    - File: `test/engine/engine.unit.test.ts`
    - _Requirements: 4.1, 4.9_

- [x] 6. Reducer, events, store and Part 2 seam
  - [x] 6.1 Implement events, state, reducer, and selectors
    - Create `src/game/events.ts` (`GameEvent` union with `kind`, `seq`, `at`, and `CompletionSummary`).
    - Create `src/game/gameState.ts` (`LevelRef`, `LoadedLevel`, `Screen`, `GameState`, `GameAction`, initial state).
    - Create `src/game/reducer.ts` (`gameReducer`) with the actions `LEVEL_REQUESTED`, `LEVEL_LOADED`, `SOLVE_REJECTED`, `SOLVE_FAILED`, `ARENA_READY`, `PART_CLICKED`, `TRAP_FLAGGED`, `REPLAY`, `RECOVERY_DISMISSED`. Ignore stale `requestId`. Read no clock and set no timer. Hold no animation field. Freeze the clock at completion.
    - Create `src/game/selectors.ts` (`elapsedMs(state, now)`, score, combo, progress, outcome).
    - _Requirements: 2.10, 8.1, 8.2, 8.3, 8.4, 8.7, 11.6, 13.8, 13.9, 13.10, 14.7_

  - [x] 6.2 Implement the event bus, store, and module registry
    - Create `src/game/eventBus.ts` and `src/game/store.ts` (`createGameStore`: `getState`, `dispatch`, `subscribe`, `bus`). `dispatch` publishes the events appended by that action, in order, and lets listener errors propagate.
    - Create `src/modules/types.ts` (`GameModule`, `ModuleContext`) and `src/modules/registry.ts` (`GAME_MODULES` empty in Part 1).
    - Add no `AudioContext`, `new Audio`, or `localStorage` access.
    - _Requirements: 8.5, 8.6, 16.7_

  - [ ]* 6.3 Write property test for reducer purity and event log
    - **Property 10: The reducer is pure and its event log is ordered and serializable**
    - Deep-freeze previous states, assert no mutation, equal output for equal input, strictly increasing `seq`, and JSON round trip with a string `kind` for every event.
    - File: `test/reducer/purity.property.test.ts`
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [ ]* 6.4 Write property test for reset and latest-request-wins
    - **Property 11: A new level resets state and the latest request wins**
    - Interleave level requests and results in seeded arrival orders. Assert the loaded level is the highest `requestId`, stale results never change state, and load and replay reset engine, clock, counters, and events.
    - File: `test/reducer/latestWins.property.test.ts`
    - **Validates: Requirements 2.10, 8.7, 14.7**

  - [ ]* 6.5 Write property test for elapsed time
    - **Property 12: Elapsed time is the running time plus penalties**
    - Non-decreasing seeded timestamps. Check the formula, monotonicity while running, 0 before start, a constant value after completion, and +3000 per blocked attempt or false alarm.
    - File: `test/reducer/elapsed.property.test.ts`
    - **Validates: Requirements 6.3, 7.7, 13.8, 13.9, 13.10**

  - [ ]* 6.6 Write reducer and bus examples
    - A module registered through the bus receives events in order and stops after unsubscribe. A throwing listener propagates from `dispatch`. The completion summary equals the engine counters. Replay keeps the level data and bumps `epoch`. The reducer result for a click does not depend on running animations. Level completion on a deadlock cage requires a flag.
    - File: `test/reducer/store.test.ts`
    - _Requirements: 8.5, 8.7, 11.6, 14.2, 14.5, 14.7_

- [x] 7. Checkpoint - Engine and state layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Solver client and upload
  - [x] 8.1 Implement upload modules
    - Create `src/upload/fileKind.ts` (`classifyFile`: case-insensitive `.glb` and `.gltf`, otherwise unsupported).
    - Create `src/upload/gltfImport.ts` (`importGltfFile(file, loader?)` on the main thread: classify, `GLTFLoader.parseAsync`, empty scene to `no-geometry`, loader error to `unreadable-file`, `objectToPayload`, dispose the loaded scene).
    - Create `src/upload/dropTarget.ts` (window drop handling that forwards the first dropped file).
    - Write these fresh. Do not import from `apps/guide-forge`.
    - _Requirements: 2.6, 3.2, 3.9, 13.11, 13.12_

  - [x] 8.2 Implement the solver client
    - Create `src/solver/solverClient.ts`: `solve(source, transfer, handlers)` returns a `requestId`, terminates a pending worker and starts a fresh `Worker` from `new URL("../worker/blitz.worker.ts", import.meta.url)` with `{ type: "module" }`, drops messages whose `requestId` is not the latest, maps a worker `error` event to a `failure` handler call, and offers `dispose()`.
    - _Requirements: 2.2, 2.3, 2.10, 3.5_

  - [ ]* 8.3 Write unit tests for upload and client
    - `classifyFile` accepts `.glb` and `.gltf` in any case and rejects other extensions. `SolverClient` with a fake `Worker` terminates the earlier worker, discards older results, and turns an `error` event into a failure call.
    - File: `test/worker/solverClient.test.ts`
    - _Requirements: 2.10, 3.9_

- [x] 9. Theme
  - [x] 9.1 Create theme files
    - Create `src/theme/tokens.css` with the Palette custom properties (`--obsidian`, `--plate`, `--brass`, `--amber`, `--teal`, `--crimson`, `--crimson-text`, `--text`, `--text-muted`, font stacks).
    - Create `src/theme/app.css`: bevelled plates (chamfered `clip-path`, inset highlight, `--plate` fill), lever button, popups, callout, over-budget notice plate (`--text` on `--plate`, amber border), overlay, loading gear, combo pulse and shake keyframes, `font-variant-numeric: tabular-nums` for numbers, and a `prefers-reduced-motion: reduce` block that disables shake and pulse.
    - Copy no CSS, token, or class name from `apps/guide-forge`.
    - _Requirements: 1.6, 3.10, 15.1, 15.2, 15.3, 15.4, 15.6_

  - [ ]* 9.2 Write theme static test
    - Parse `tokens.css`. Assert every Palette value is present and every declared text and background pair has a WCAG contrast ratio of at least 4.5. Assert `app.css` contains the reduced-motion block and no `apps/guide-forge` reference.
    - File: `test/static/theme.test.ts`
    - _Requirements: 15.1, 15.2, 15.4, 15.5_

- [x] 10. Recovery screens
  - [x] 10.1 Implement recovery copy and screens
    - Create `src/recovery/recoveryCopy.ts` (pure `recoveryCopyFor(cause)`, re-export `RecoveryCause`): single solid piece (for any triangle count, with no over-budget variant), no playable geometry with detail, accepted extensions `.glb` and `.gltf`, unexpected with the error message.
    - Create `src/recovery/RecoveryScreen.tsx` with **Load Lockbox** (loads a Bundled_Level and dismisses the screen) and **Try another file** (opens the file picker) on a clockwork plate.
    - Create `src/recovery/WebglUnavailable.tsx` explaining that WebGL is required, in the same plate style.
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7, 3.8, 3.9, 9.10_

  - [ ]* 10.2 Write property test for recovery copy
    - **Property 21: Recovery copy states the facts the requirements name**
    - For any triangle count, including counts above 150,000, a `monolithic` cause yields the single-solid-piece copy; any error message string appears in the unexpected copy; any file name with another extension is unsupported and the copy names `.glb` and `.gltf`; every cause offers both actions.
    - File: `test/recovery/recoveryCopy.property.test.ts`
    - **Validates: Requirements 3.1, 3.5, 3.6, 3.7, 3.9**

- [x] 11. HUD
  - [x] 11.1 Implement the HUD model
    - Create `src/hud/hudModel.ts` with pure `popupsFromEvent`, `describeEvent`, `calloutText`, `calloutReducer`, `calloutVisible`, `formatElapsed`, `overBudgetNoticeText(overBudget)` (thousands-separated count, `150,000`, and the stride). Popups: `+N`, `+3s`, `FALSE ALARM -250`. The callout lasts 3000 ms from the latest blocked event.
    - _Requirements: 11.5, 12.4, 12.5, 12.7, 12.8, 12.9, 3.4, 13.2, 14.4, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

  - [ ]* 11.2 Write property test for the blocker callout
    - **Property 18: The blocker callout names every blocker and times out from the latest event**
    - Text starts with `BLOCKED BY: ` and lists each name in order. Visibility equals `now < lastEventAt + 3000`. Text is that of the latest event.
    - File: `test/hud/callout.property.test.ts`
    - **Validates: Requirements 12.4, 12.7, 12.8**

  - [ ]* 11.3 Write property test for event cues
    - **Property 19: Every game event has a text and a visual cue**
    - For generated `part_removed`, `part_blocked`, `false_alarm`, `trap_flagged`, and `level_completed` events, `describeEvent` is non-empty and `popupsFromEvent` or the completion model yields the named cue. The blocked text equals the callout text.
    - File: `test/hud/cues.property.test.ts`
    - **Validates: Requirements 11.5, 12.5, 12.9, 14.2, 14.4, 14.5, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6**

  - [ ]* 11.4 Write property test for elapsed formatting
    - **Property 20: Elapsed-time formatting preserves tenths**
    - `formatElapsed` returns `m:ss.t`, seconds in 00 to 59, tenths floored, and a parsed value within 100 ms below the input.
    - File: `test/hud/formatElapsed.property.test.ts`
    - **Validates: Requirements 13.2**

  - [x] 11.5 Implement HUD components
    - Create `src/hud/Hud.tsx` (floating layout, no panel layout, manifest list, or step timeline), `LevelSelector.tsx` (six entries; the last opens the file picker), `Stopwatch.tsx` (50 ms interval while running), `ScoreCombo.tsx` (pulse on change, crimson flash on reset), `ProgressBar.tsx`, `Counters.tsx` (mistakes and false alarms separately), `TrapLever.tsx` ("Flag Interlock Trap", always enabled in play), `NamePill.tsx`, `Popups.tsx`, `BlockerCallout.tsx`, `OverBudgetNotice.tsx` (non-blocking plate with `role="status"`, shown while the loaded level has an `overBudget` warning, `pointer-events: none` except its **Dismiss** button, dismissal keyed by `loaded.epoch`, never covering the lever or stopwatch), `LoadingPlate.tsx` (names the level), `CompletionOverlay.tsx` ("Victory" or "Interlock Exposed!" with score, time, mistakes, false alarms, **Replay**, **Choose level**), and `LiveRegion.tsx` (`role="status" aria-live="polite"`).
    - Components read state through `useSyncExternalStore` on the store and subscribe to the bus for transient cues.
    - _Requirements: 2.9, 3.4, 3.10, 3.11, 10.2, 10.3, 11.5, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.11, 13.13, 14.1, 14.2, 14.4, 14.5, 14.6, 14.8, 15.3, 16.2_

  - [ ]* 11.6 Write HUD examples
    - Level selector entries equal the six labels. The loading plate text names the level. The completion overlay model carries the summary values. The lever stays enabled when every part is blocked. `overBudgetNoticeText` names the count and `150,000`, and no notice model exists when `overBudget` is null.
    - File: `test/hud/hud.test.ts`
    - _Requirements: 2.9, 3.4, 3.11, 13.1, 14.2, 14.5, 14.8_

- [x] 12. Viewport logic (pure modules)
  - [x] 12.1 Implement pure viewport modules
    - Create `src/viewport/motion.ts` (reduced-motion policy: 600 ms normal, 150 ms reduced, flash instead of burst).
    - Create `src/viewport/framing.ts` (`frameBounds(aabb, fovDeg, aspect, margin = 1.25)`).
    - Create `src/viewport/picking.ts` (`isClick`: primary button, drift at most 5 px, at most 600 ms; `Picker` over live meshes with `Raycaster.intersectObjects(live, false)`; no BVH).
    - Create `src/viewport/exitAnimations.ts` (`exitProgress`, `poseToMatrix`, `ExitAnimator` with independent start times, using `createDefaultPrimitiveRegistry().get(primitive).value.pose(t, params)`).
    - Create `src/viewport/resourceTracker.ts` (dispose each tracked item once).
    - Create `src/viewport/partMeshes.ts` (`PartRenderData` to `Mesh`, own `MeshPhysicalMaterial` per part, id map).
    - Create `src/viewport/WebglUnavailableError.ts`.
    - _Requirements: 9.7, 9.8, 9.9, 10.4, 10.5, 10.6, 10.7, 11.1, 11.2, 11.3, 11.6, 11.7, 11.9_

  - [ ]* 12.2 Write property test for framing
    - **Property 17: Framing shows the whole assembly**
    - Seeded boxes inside `[-0.5, 0.5]^3` and aspect ratios 0.4 to 3. All 8 corners project inside NDC `[-1, 1]` and in front of the near plane.
    - File: `test/viewport/framing.property.test.ts`
    - **Validates: Requirements 9.8**

  - [ ]* 12.3 Write property test for click detection
    - **Property 16: Drags are never clicks**
    - `isClick` is true exactly when the button is primary, drift is at most 5 px, and elapsed time is at most 600 ms. A non-click never produces `PART_CLICKED`.
    - File: `test/viewport/isClick.property.test.ts`
    - **Validates: Requirements 10.5**

  - [ ]* 12.4 Write property test for concurrent exit animations
    - **Property 13: Concurrent exit animations are independent and never lock input**
    - Progress equals `clamp((now - start) / duration, 0, 1)`, is unaffected by adding, removing, or reordering other animations, is non-decreasing, and reaches 1 at `start + duration`. The reducer result for a click is identical with zero or many animations running, and the state has no animation field.
    - File: `test/viewport/exitAnimator.property.test.ts`
    - **Validates: Requirements 11.6, 11.7**

  - [ ]* 12.5 Write property test for pose matrices
    - **Property 14: Pose matrices apply the rigid motion**
    - For engine-produced steps and seeded `t` in `[0, 1]`, `poseToMatrix(pose)` applied to points equals `R*x + T` from the row-major rotation and translation, and the rotation block is orthonormal with determinant 1.
    - File: `test/viewport/poseMatrix.property.test.ts`
    - **Validates: Requirements 11.1, 11.2**

  - [ ]* 12.6 Write property test for picking
    - **Property 15: Picking resolves the nearest live part and ignores removed parts**
    - Seeded rays aimed at triangle centroids of the real Lockbox render parts. The picked id equals the owner of the nearest triangle among live parts by brute force. After removals the pickable set equals the live set.
    - File: `test/viewport/picking.property.test.ts`
    - **Validates: Requirements 10.4, 10.7**

  - [ ]* 12.7 Write viewport unit tests
    - Reduced motion shortens the duration and selects the flash effect. `ResourceTracker` disposes each tracked item once. `partMeshes` builds one mesh per part with a distinct material per part.
    - File: `test/viewport/viewport.unit.test.ts`
    - _Requirements: 9.7, 9.9, 11.3, 11.9_

- [x] 13. Arena
  - [x] 13.1 Implement Arena scene pieces
    - Create `src/viewport/environment.ts` (`RoomEnvironment` through `PMREMGenerator`, returning the texture and the disposables).
    - Create `src/viewport/pedestal.ts` (metallic turntable below the lowest AABB point).
    - Create `src/viewport/effects.ts` (teal burst with 28 particles from a seeded PRNG, crimson clash spark, shudder envelope, one-frame flash under reduced motion).
    - Create `src/viewport/highlights.ts` (brass hover glow, amber-to-crimson blocker flash, pulsing interlock highlight).
    - No `Math.random` anywhere.
    - _Requirements: 9.3, 9.4, 10.1, 10.3, 11.4, 11.9, 12.1, 12.2, 12.3, 14.3_

  - [x] 13.2 Implement the Arena class
    - Create `src/viewport/Arena.ts`: `WebGLRenderer` with `ACESFilmicToneMapping` and `SRGBColorSpace`, `Color(0x0D0F14)` background, PMREM environment, brass key and teal rim `DirectionalLight`s, pedestal, `OrbitControls` with damping, part meshes, `frameBounds` camera framing, one `requestAnimationFrame` loop (controls, `ExitAnimator`, effects, highlights, render), `ResizeObserver`, pointer handling through `isClick` and `Picker`, hover callbacks, and `dispose()` through the `ResourceTracker` (geometries, materials, textures, PMREM target, generator, `RoomEnvironment`, renderer). Throw `WebglUnavailableError` when no context is created. Remove a part from the `Picker` at click time, and dispose its mesh when its animation reaches `t = 1`. Rebuild meshes when `epoch` changes.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 10.1, 10.3, 10.4, 10.5, 10.6, 10.7, 11.1, 11.2, 11.3, 11.6, 11.7, 11.8_

  - [x] 13.3 Implement the Arena event bridge
    - Create `src/viewport/arenaBridge.ts`, the only mapping from `GameEvent` to Arena calls: `part_removed` (start exit animation with `startMs = event.at`, burst, picker removal), `part_blocked` (shudder, spark, blocker flashes), `level_completed` with `interlock_exposed` (highlight every SCC part), `level_loaded` (rebuild meshes).
    - _Requirements: 11.1, 11.4, 11.8, 12.1, 12.2, 12.3, 14.3, 16.1, 16.3_

  - [x] 13.4 Implement the React Arena host
    - Create `src/viewport/ArenaView.tsx`: create the Arena in an effect, call `dispose()` in cleanup, dispatch `ARENA_READY` after the meshes are shown, dispatch `PART_CLICKED` with `performance.now()`, report hover to the HUD name pill, and render `WebglUnavailable` when `WebglUnavailableError` is caught. Rethrow any other error to the error boundary.
    - _Requirements: 9.9, 9.10, 10.2, 10.4, 13.10_

  - [ ]* 13.5 Write Arena configuration tests
    - A canvas stub that returns no WebGL context makes the Arena constructor throw `WebglUnavailableError`. Exported configuration constants hold `ACESFilmicToneMapping`, `0x0D0F14`, damping enabled, brass `0xD99B38` and teal `0x2DD4BF` light colors.
    - File: `test/viewport/arena.config.test.ts`
    - _Requirements: 9.1, 9.2, 9.5, 9.6, 9.10_

- [x] 14. Composition root and static checks
  - [x] 14.1 Implement the app controller
    - Create `src/appController.ts` (framework-free): owns the store, `SolverClient`, and `createEngineDeps()`. `selectLevel(levelId)` dispatches `LEVEL_REQUESTED` and calls the client; on `solved` it builds `LoadedLevel` (including `overBudget` from the `SolveResult`) and `EngineLevel` (through `levelData.ts` and `deriveDisplayNames`) and dispatches `LEVEL_LOADED`, with no recovery screen for an over-budget result; on `rejected` or `failure` it dispatches `SOLVE_REJECTED` or `SOLVE_FAILED`. `handleFile(file)` uses `importGltfFile` and maps unsupported extension, unreadable file, and empty file to recovery causes without calling the worker where applicable. Also expose `flagTrap`, `replay`, `dismissRecovery`, and `registerModules(GAME_MODULES)` on the bus. Load the Lockbox at startup when no level is chosen.
    - _Requirements: 2.3, 2.10, 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 3.9, 8.5, 13.12, 13.13, 14.1, 14.7_

  - [x] 14.2 Wire `App.tsx` and `main.tsx`
    - Edit `src/App.tsx`: create the controller once, render `ArenaView`, `Hud`, `LoadingPlate`, `RecoveryScreen`, `CompletionOverlay`, and `LiveRegion` from `screen` state, a React error boundary that shows the "unexpected" Recovery_Screen, the hidden file input shared by the level selector and recovery screens, and the window drop handler.
    - Edit `src/main.tsx`: import `theme/tokens.css` and `theme/app.css`, then mount `<App />`.
    - _Requirements: 2.3, 2.9, 3.6, 3.7, 3.8, 9.10, 13.1, 13.11, 13.12, 14.6, 15.4_

  - [ ]* 14.3 Write controller wiring tests
    - With a fake solver client: boot requests the Lockbox once; selecting a level resets counters; a rejected solve shows the matching recovery cause; activating the bundled-level control dismisses recovery and requests a level; a dropped `.txt` file produces the unsupported-extension cause without a worker call; a solved result with an `overBudget` warning loads the level, shows no recovery screen, and keeps the warning on the loaded level; replay reloads the same level with fresh state.
    - File: `test/reducer/appController.test.ts`
    - _Requirements: 2.3, 3.4, 3.8, 3.9, 13.13, 14.7_

  - [ ]* 14.4 Write static architecture tests
    - File: `test/static/architecture.test.ts`, using `sourceScan.ts`.
    - `src/game/**` imports only relative modules and `import type` from `@unboltkit/core`.
    - `stage1Prepare`, `stage2BuildDbg`, `stage3Peel`, `three-mesh-bvh`, `computeBoundsTree` appear only under `src/worker/`.
    - No import specifier or path resolves into `apps/guide-forge`, and no CSS file here matches a guide-forge CSS file by content hash.
    - No `Math.random`, `AudioContext`, `new Audio`, `localStorage`, or `sessionStorage` under `src/` or `test/`; no empty `catch`; no trivial assertions such as `expect(true).toBe(true)`.
    - `package.json` and `vite.config.ts` hold the required dependencies, port 5174, and worker format `"es"`.
    - No source file under `packages/` (skipping `node_modules`, `dist`, and `*.tsbuildinfo`) has a modification time newer than the spec's `design.md`, and any newer file is listed in the failure message.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.2, 4.1, 8.6, 10.6, 16.7, 17.10, 17.11, 18.5_

- [x] 15. Checkpoint - Full app before final verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Final verification (one shell command at a time, quoted paths, no dev server)
  - [x] 16.1 Install dependencies at the repository root
    - Run `npm install` with `cwd` set to `"/Users/sarvesh/Dev/Kiroween 2027"`.
    - Confirm that the output shows a successful install and that `@unboltkit/core` and `@unboltkit/sample-kits` resolve to the local workspace packages and `apps/unbolt-blitz` is linked.
    - _Requirements: 1.8, 18.1, 18.6_

  - [x] 16.2 Type-check the app
    - Run `npx tsc --noEmit` with `cwd` set to `"/Users/sarvesh/Dev/Kiroween 2027/apps/unbolt-blitz"`.
    - Expect 0 type errors. Fix reported errors in `apps/unbolt-blitz` only.
    - _Requirements: 18.2, 18.6_

  - [x] 16.3 Run the test suite
    - Run `npm run test` with `cwd` set to `"/Users/sarvesh/Dev/Kiroween 2027/apps/unbolt-blitz"` (this is `vitest run`, never watch mode).
    - Read the printed summary (for example `Test Files ... passed`) instead of trusting the exit code alone. Expect 0 failing tests.
    - _Requirements: 17.1, 17.6, 17.9, 18.3, 18.6_

  - [x] 16.4 Build the production bundle
    - Run `npm run build` with `cwd` set to `"/Users/sarvesh/Dev/Kiroween 2027/apps/unbolt-blitz"`.
    - Confirm the output lists the Blitz_Worker chunk. Do not start `npm run dev` or `npm run preview`.
    - _Requirements: 18.4, 18.6_

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP. The required test files are the ones from tasks 3.3 to 3.5 (`test/helpers/solved.ts`, `test/worker/lockbox.solve.test.ts`, `test/worker/cage.solve.test.ts`) and 5.4 to 5.14 (the engine helpers plus the removal-order, scoring, blocker, trap, and cage-engine tests: tasks 5.4, 5.5, 5.11, 5.12, 5.13, and 5.14), together with the seeded helpers of task 1.2. Those files give `npm run test` in 16.3 real work to run, whatever optional tests are skipped. Tasks 5.6 to 5.10 and 5.15 stay optional.
- Each task lists the requirement clauses it implements. Property tasks carry the property number and the clauses it validates.
- Test inputs come from the seeded helpers in `test/helpers`. No test uses `Math.random`, and every expected value is computed from the geometry or the graph, never hard-coded to a Part_ID, bounding box, or step order.
- `packages/` must not change, and nothing may import from `apps/guide-forge`. Task 14.4 checks both.
- Shell rules for task 16: one command per call, quoted paths, no GNU `timeout`, retry a failing command at most twice, and ask the user to run it in Terminal if it keeps failing. Judge `Exit Code: -1` by the printed output.
- Checkpoints 4, 7, and 15 each run in their own wave between the groups they separate.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2", "2.4", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4", "3.5", "3.6"] },
    { "id": 5, "tasks": ["4"] },
    { "id": 6, "tasks": ["5.1"] },
    { "id": 7, "tasks": ["5.2"] },
    { "id": 8, "tasks": ["5.3", "5.4"] },
    { "id": 9, "tasks": ["5.5", "5.6", "5.7", "5.8", "5.9", "5.10", "5.11", "5.12", "5.13", "5.14", "5.15"] },
    { "id": 10, "tasks": ["6.1"] },
    { "id": 11, "tasks": ["6.2", "6.3", "6.4", "6.5"] },
    { "id": 12, "tasks": ["6.6"] },
    { "id": 13, "tasks": ["7"] },
    { "id": 14, "tasks": ["8.1", "8.2", "9.1", "11.1", "12.1"] },
    { "id": 15, "tasks": ["8.3", "9.2", "10.1", "11.2", "11.3", "11.4", "11.5", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "13.1"] },
    { "id": 16, "tasks": ["10.2", "11.6", "13.2"] },
    { "id": 17, "tasks": ["13.3", "13.5"] },
    { "id": 18, "tasks": ["13.4"] },
    { "id": 19, "tasks": ["14.1"] },
    { "id": 20, "tasks": ["14.2", "14.3"] },
    { "id": 21, "tasks": ["14.4"] },
    { "id": 22, "tasks": ["15"] },
    { "id": 23, "tasks": ["16.1"] },
    { "id": 24, "tasks": ["16.2"] },
    { "id": 25, "tasks": ["16.3"] },
    { "id": 26, "tasks": ["16.4"] }
  ]
}
```
