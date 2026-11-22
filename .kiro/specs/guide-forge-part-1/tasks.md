# Implementation Plan: Guide Forge Part 1

## Overview

Implementation language: TypeScript (the language of the workspace and of the design). All work happens inside `apps/guide-forge`. No file under `packages/` changes.

The plan builds bottom-up so that nothing is left unwired: shared protocol and pure logic first (`motion/`, `state/`, `scene/`), then the worker pipeline, the solver client and upload, then the viewport, header and panels, and last the provider and `App.tsx` that wire everything together. Property tests sit next to the code they check. The last tasks tune the real-pipeline test timeout and run the verification commands.

Part 1 scope: no offline `.html` exporter and no tool, torque or narration authoring toolbar. Do not create `export/` or `authoring/` modules.

Shell rules for every task that runs a command (macos-shell-guard):

- Quote the workspace path: `"/Users/sarvesh/Dev/Kiroween 2027"` (it contains a space).
- Run exactly one shell command at a time, never in parallel.
- Never use GNU `timeout`. Use the tool's `timeout` parameter.
- Use `vitest run`, never watch mode. Never start `npm run dev`. Ask the user to start it.
- Exit code `-1` is unreliable on the macOS PTY. Judge the result from stdout and stderr. Do not retry the same failing command more than twice. If a command keeps failing, stop and ask the user to run it in Terminal.

Code rules: no `Math.random()` anywhere (tests use the seeded fast-check config), no empty `catch`, no hardcoded part ids, bounding boxes or step orders, and every test asserts a geometric or graph property of a real or generated result.

## Tasks

- [x] 1. Configure package, Vite, Vitest and TypeScript for the app
  - Edit `apps/guide-forge/package.json`: add `"test": "vitest run"` script, `dependencies` `@unboltkit/core` `*`, `@unboltkit/sample-kits` `*`, `three` `^0.170.0`, and `devDependencies` `@types/three` `^0.170.0`, `fast-check` `^3.23.2`, `vitest` `^3.2.4` (keep the existing react, vite and plugin entries). Add no state-management library.
  - Edit `apps/guide-forge/vite.config.ts`: `server.port` 5173, `worker.format` `"es"`, `build.chunkSizeWarningLimit` 1000.
  - Create `apps/guide-forge/vitest.config.ts` with `environment: "node"`, `setupFiles: ["test/setup.ts"]` and the placeholder `testTimeout: 120_000` (tuned in task 15).
  - Create `apps/guide-forge/test/setup.ts` with `fc.configureGlobal({ seed: 0x5eed2027, numRuns: 100 })`.
  - Edit `apps/guide-forge/tsconfig.json`: `include` becomes `["src", "test", "vite.config.ts", "vitest.config.ts"]`.
  - Do not touch any file under `packages/unbolt-core`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.8, 4.2_

- [x] 2. Shared protocol and kit list
  - [x] 2.1 Create `src/protocol.ts`
    - Define `STAGE_NAMES`, `StageName`, `StageProgressEvent`, `MaterialDescriptor`, `ScenePayload*`, `SolveSource`, `SolveLabel`, `SolveRequestMessage`, `PartRenderData`, `OracleReport`, `SolveResult`, `SolveFailure` and `WorkerOutMessage` as in the design.
    - Import Core types with `import type` only. No React and no DOM type.
    - _Requirements: 5.5, 5.9, 5.12, 7.6, 17.4_

  - [x] 2.2 Create `src/kits.ts`
    - Export `KIT_NAMES` (the five names), a human title per name and the Showcase / Deadlock Cage groups as plain data.
    - _Requirements: 6.1_

  - [ ]* 2.3 Write unit test that `KIT_NAMES` equals the names in `SHOWCASE_KITS` and `DEADLOCK_CAGES`
    - File: `test/unit/kits.test.ts`.
    - _Requirements: 6.1, 6.3_

- [x] 3. Light-blueprint theme and icons
  - [x] 3.1 Create `src/theme/tokens.css` and `src/theme/app.css`
    - Tokens from the design table (`--canvas` `#F6F8FB`, `--accent` `#1E3A5F`, `--text` `#0F172A`, and the muted, panel, ok, warn, bad pairs). Colour literals appear only in `tokens.css`.
    - Layout: Header_Bar on top, Viewport in the centre, Manifest_Panel on the right. Monospace stack for telemetry and badges. `:focus-visible` outline `2px solid var(--accent)`. `@media (prefers-reduced-motion: reduce)` removes transitions and animations. Faint 8 px drafting grid on the canvas.
    - No import from `apps/unbolt-blitz`.
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 16.5, 16.6_

  - [x] 3.2 Create `src/ui/icons.tsx`
    - Inline SVG React components: check, warn, interlock, island, empty, geometry, config, file, worker, play, pause. Decorative icons use `aria-hidden`. No raster image and no icon font.
    - _Requirements: 2.3, 8.9, 10.6, 16.4_

  - [ ]* 3.3 Write unit test for theme contrast and base colours
    - File: `test/unit/theme.test.ts`. Parse `tokens.css` via `?raw`, check each declared text/background pair is at least 4.5:1 and the three base colours.
    - _Requirements: 2.1, 2.7_

- [x] 4. Pure motion modules (`src/motion/`, no React, no three)
  - [x] 4.1 Create `src/motion/timeline.ts` and `src/motion/playback.ts`
    - `localParameter`, `sliderToTimeline`, `timelineToSlider`, `activeStepIndex`.
    - `PLAYBACK_STEPS_PER_SECOND = 1`, `MAX_TICK_SECONDS = 0.1`.
    - _Requirements: 11.1, 11.2, 11.6, 11.7, 11.8_

  - [x] 4.2 Create `src/motion/naiveExplode.ts` and `src/motion/partTransforms.ts`
    - `NAIVE_TRAVEL_DISTANCE = Math.sqrt(3)`, `naiveOffset`, `Mat4`, `poseToMat4`, `computePartTransforms` (DBG poses via `createDefaultPrimitiveRegistry().get(step.primitive).value.pose(t, step.params)`, empty map for deadlocked or error in DBG, naive offsets per `perPart` direction). Do not catch registry or `pose` errors.
    - Importing `createDefaultPrimitiveRegistry` from the Core package root is the only Core value import allowed outside `src/worker/`.
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 13.1, 13.2, 14.9, 14.10_

  - [x] 4.3 Create `src/motion/leaderSpline.ts`
    - `LEADER_SAMPLES = 32`, `sampleLeaderSpline`, `travelledSampleCount`.
    - _Requirements: 12.2, 12.3, 12.5_

  - [x] 4.4 Create `src/motion/highlightStyle.ts`
    - `PartHighlight`, `HighlightContext`, `partHighlight` with the reduced-motion downgrade of `pulse` and `glow` to `steady`.
    - _Requirements: 13.3, 13.5, 13.6, 14.4, 14.5, 14.8, 16.6_

  - [ ]* 4.5 Write property test for timeline local parameter and slider mapping
    - **Property 4: Timeline local parameter and slider mapping**
    - **Validates: Requirements 11.1, 11.2, 11.6, 11.7**

  - [ ]* 4.6 Write property test for pose matrices
    - **Property 6: Pose matrices apply x ↦ R·x + T**
    - Use the real primitives from `createDefaultPrimitiveRegistry()` with seeded valid parameters.
    - **Validates: Requirements 11.3, 11.4, 11.5, 11.6, 11.7**

  - [ ]* 4.7 Write property test for leader spline sampling
    - **Property 7: Leader spline sampling**
    - **Validates: Requirements 12.2, 12.3, 12.5**

  - [ ]* 4.8 Write property test for naive offsets and envelope clearance
    - **Property 8: Naive offsets and envelope clearance**
    - Generate point-set assemblies scaled to `maxExtent = 1`.
    - **Validates: Requirements 13.1, 13.2, 14.10**

  - [ ]* 4.9 Write property test for reduced-motion highlights
    - **Property 22: Reduced motion yields steady highlights**
    - **Validates: Requirements 13.5, 13.6, 14.8, 16.6**

- [x] 5. App state (`src/state/`, no React except the provider)
  - [x] 5.1 Create `src/state/types.ts`
    - `AppState` (solve, view, feedback slices), `AppAction` union, `LoadStatus`, `Mode`, `RecoveryCard`, `Notice` types. Slice shapes follow the design so Part 2 can add an `authoring` slice.
    - _Requirements: 4.3, 4.4_

  - [x] 5.2 Create `src/state/recovery.ts`
    - `buildRecoveryCard`, `buildFailureCard`, `buildLoaderFailureCard`, `buildUnsupportedFileCard`, `buildEmptyAssemblyCard`, `buildPolyBudgetNotice`, `classifyFile`. Every card and the notice carry the `load-sample-kit` and `open-file-picker` actions and an icon, heading and body.
    - _Requirements: 7.10, 7.11, 7.12, 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.9_

  - [ ]* 5.3 Write property test for recovery cards and notices
    - **Property 14: Recovery cards and notices are complete**
    - **Validates: Requirements 7.10, 8.1, 8.3, 8.5, 8.7, 8.9**

  - [x] 5.4 Create `src/state/selectors.ts` and `src/state/announce.ts`
    - `selectClashBadge`, `selectControlEnablement`, `selectModeToggleEnabled`, `selectManifestRows`, `partDisplayName`, `selectBom`, `selectDeadlockModel`, `selectProgressStrip`, naive lookup selector, and announcement text builders for load started, stage completed, solve finished, recovery, deadlock and mode change.
    - _Requirements: 9.5, 10.3, 10.4, 10.5, 10.8, 13.4, 13.7, 14.2, 14.3, 14.4, 14.5, 14.7, 14.9, 15.1, 15.2, 15.3, 15.7, 15.8, 15.9, 15.10, 16.2_

  - [ ]* 5.5 Write property test for clash badge text
    - **Property 9: Clash badge text**
    - **Validates: Requirements 9.5, 10.3, 10.4, 10.5**

  - [ ]* 5.6 Write property test for manifest rows
    - **Property 10: Manifest rows mirror the plan**
    - **Validates: Requirements 13.4, 14.7, 15.1, 15.2, 15.3, 15.7, 15.8**

  - [ ]* 5.7 Write property test for deadlock classification
    - **Property 11: Deadlock classification and banner model**
    - Generate witnesses by assembling plain data. Do not hardcode part ids.
    - **Validates: Requirements 14.2, 14.3, 14.4, 14.5**

  - [x] 5.8 Create slice reducers and the root reducer
    - Files: `src/state/solveSlice.ts`, `viewSlice.ts`, `feedbackSlice.ts`, `reducer.ts` (`rootReducer`).
    - Implement request-id gating, `solve/started` reset, `solve/succeeded` (recovery card for error plans, poly-budget notice when not an error), `solve/failed`, `view/*` rules, playback tick clamping and `env/reducedMotionChanged`.
    - Import no React, no DOM and no three symbol.
    - _Requirements: 4.4, 4.5, 4.6, 5.11, 5.12, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 10.2, 11.1, 11.8, 11.9, 11.10, 13.7, 14.9, 15.4_

  - [ ]* 5.9 Write property test for reducer purity
    - **Property 1: Reducer purity**
    - **Validates: Requirements 4.5**

  - [ ]* 5.10 Write property test for stale solve messages
    - **Property 2: Stale solve messages are ignored**
    - **Validates: Requirements 5.11**

  - [ ]* 5.11 Write property test for latest progress event per stage
    - **Property 3: Latest progress event per stage wins**
    - **Validates: Requirements 4.4, 5.6**

  - [ ]* 5.12 Write property test for playback
    - **Property 5: Playback advances monotonically and stops at N**
    - **Validates: Requirements 11.8, 11.9, 11.10**

  - [ ]* 5.13 Write property test for control enablement and mode switching
    - **Property 12: Control enablement and mode switching**
    - **Validates: Requirements 10.2, 10.8, 13.7, 14.9**

  - [ ]* 5.14 Write property test for step selection and timeline agreement
    - **Property 13: Step selection and timeline agree**
    - **Validates: Requirements 12.1, 15.4**

  - [ ]* 5.15 Write reducer unit tests
    - First-open flow (`solve/started` then `solve/succeeded`), poly-budget notice keeps results visible, sample-kit action dismisses the card, reduced-motion change stops playback, selector status callouts and empty state.
    - _Requirements: 6.6, 8.6, 8.8, 11.10, 15.9, 15.10_

- [x] 6. Material and scene payload conversion (`src/scene/`, three, no DOM)
  - [x] 6.1 Create `src/scene/materialDescriptor.ts`
    - `materialToDescriptor`, `descriptorToMaterial` (`MeshPhysicalMaterial`, `transparent` when `opacity < 1`).
    - _Requirements: 3.5, 7.6_

  - [ ]* 6.2 Write property test for material descriptor round trip
    - **Property 16: Material descriptor round trip**
    - **Validates: Requirements 3.5**

  - [x] 6.3 Create `src/scene/scenePayload.ts`
    - `objectToPayload` (main thread: copies buffers with `getX/getY/getZ`, child order preserved, transfer list with each `ArrayBuffer` once, no texture or DOM object) and `payloadToObject` (worker: local TRS, `BufferGeometry` meshes, material from descriptor).
    - _Requirements: 5.9, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [ ]* 6.4 Write property test for scene payload round trip
    - **Property 15: Scene payload round trip**
    - Check `structuredClone(payload, { transfer })` succeeds and that the Core plan of the rebuilt tree equals the plan of the source tree.
    - **Validates: Requirements 5.9, 7.5, 7.6, 7.7, 7.8, 7.9**

- [x] 7. Solver_Worker pipeline (`src/worker/`)
  - [x] 7.1 Create `src/worker/failure.ts` and `src/worker/buildKit.ts`
    - `toSolveFailure` (keeps Core `name` and `code`, handles non-Error throws). `buildKit` looks the name up in `SHOWCASE_KITS` and `DEADLOCK_CAGES` and throws `UnknownKitError` naming the rejected value.
    - _Requirements: 5.12, 6.3, 6.8_

  - [ ]* 7.2 Write property test for failure shaping and kit-name rejection
    - **Property 20: Failure shaping and kit-name rejection**
    - **Validates: Requirements 5.12, 6.8**

  - [x] 7.3 Create `src/worker/renderData.ts`
    - `buildRenderData` from Stage 1 normalized parts: copied `positions`, `indices`, smoothed `normals` from `cornerNormals` with `faceNormals` fallback, material descriptor by `sourceNodePath`, `obbCenter`, `aabb`. Each Part owns distinct typed arrays.
    - _Requirements: 3.5, 5.8, 5.9_

  - [x] 7.4 Create `src/worker/oracle.ts`
    - `buildOracleJobs` (job `i` moves step `i`'s Part along its `dir` against Parts of later steps) and `runOracle` (calls `checkClashes` once per step with Stage 1 parts and the resolved config, sums counts, never reads `plan.status`).
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 7.5 Write property test for oracle jobs
    - **Property 19: Oracle jobs follow plan order**
    - **Validates: Requirements 9.1, 9.3, 9.4**

  - [x] 7.6 Create `src/worker/solvePipeline.ts`
    - `runSolve(request, deps)` runs `stage0ParseScene`, `stage1Prepare`, `stage2BuildDbg`, `stage3Peel`, `stage4Compile`, then oracle and naive for solved plans, and naive only for deadlocked plans. Post `started` and `completed` events per executed stage. Return the Core plan unaltered. Throw with the compile error `kind` as `code` when `stage4Compile` returns `ok: false`.
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.7, 5.8, 6.3, 7.8, 9.1, 9.2, 9.6_

  - [x] 7.7 Create `src/worker/solver.worker.ts`
    - Message handler only, using the structural `WorkerPort` from the design. Post progress, result (transfer list of every typed-array buffer, each once) or failure via `toSolveFailure`. No empty `catch`.
    - _Requirements: 5.3, 5.9, 5.12, 17.3, 17.7_

  - [x] 7.8 Write property test for worker pipeline fidelity on real kits
    - **Property 17: Worker pipeline fidelity on real kits**
    - Enumerate the finite kit parameter domain. Compare `plan` with `solveDisassembly(buildKit(...))`. Assert oracle sums, SCC membership and event order.
    - **Validates: Requirements 5.1, 5.2, 5.5, 5.7, 5.8, 9.3, 17.6**

  - [ ]* 7.9 Write property test that render data is normalized
    - **Property 18: Render data is in normalized coordinates**
    - **Validates: Requirements 5.8, 11.4**

  - [ ]* 7.10 Write unit tests for oracle injection
    - A stub `checkClashes` that throws surfaces as a failure message. A stub that returns a count above 0 yields a total above 0 for a solved plan.
    - _Requirements: 9.5, 9.6_

- [x] 8. Solver client
  - [x] 8.1 Create `src/solver/solverClient.ts`
    - `createSolverClient(dispatch, makeWorker?)`. Default worker: `new Worker(new URL("../worker/solver.worker.ts", import.meta.url), { type: "module" })`. Monotonic request id, terminate the previous worker on `solve`, drop messages with a stale id, dispatch `solve/failed` on `onerror` and `onmessageerror`, and `dispose`.
    - _Requirements: 5.4, 5.10, 5.11, 5.12, 6.2_

  - [ ]* 8.2 Write unit tests with a fake worker
    - Superseded request terminates the old worker and drops its late messages. `onerror` dispatches `solve/failed`.
    - _Requirements: 5.11, 5.12_

- [x] 9. Upload
  - [x] 9.1 Create `src/upload/gltfImport.ts`
    - `importGltfFile(file, loader?)`: `classifyFile`, `file.arrayBuffer()`, `GLTFLoader.parseAsync` on the main thread, `objectToPayload`, empty-scene card without a request, loader failure card with the loader message, disposal of the loaded scene. This is the only module importing `GLTFLoader`.
    - _Requirements: 7.1, 7.4, 7.5, 7.6, 7.7, 7.10, 7.11, 7.12_

  - [ ]* 9.2 Write unit tests with a stub parser
    - Unsupported extension card, loader rejection card with the message, zero-mesh scene gives the empty-assembly card and no payload.
    - _Requirements: 7.10, 7.11, 7.12_

- [x] 10. Viewport (`src/viewport/`)
  - [x] 10.1 Create `src/viewport/cameraViews.ts`
    - `VIEW_DIRECTIONS`, `frameBounds`, `boundsOfPosedParts`. `top` uses `up = (0, 0, -1)`.
    - _Requirements: 3.7, 3.8_

  - [ ]* 10.2 Write property test for camera views and fit
    - **Property 21: Camera views and fit contain the assembly**
    - **Validates: Requirements 3.7, 3.8**

  - [x] 10.3 Create `src/viewport/sceneController.ts`
    - Injectable `createRenderer`. `WebGLRenderer` with `ACESFilmicToneMapping`, `RoomEnvironment` through `PMREMGenerator` as `scene.environment`, `#1E3A5F` grid at reduced opacity, `OrbitControls`, one `MeshPhysicalMaterial` mesh per Part with `matrixAutoUpdate = false`, selection and clash and deadlock and unassigned highlights, leader spline (`Line2`, arrowhead, `CSS2DObject` label, travelled portion), camera commands, on-demand render loop, `ResizeObserver`, and full `dispose`. A throwing `createRenderer` marks the controller `unavailable`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 3.10, 3.11, 11.2, 11.4, 12.1, 12.3, 12.4, 12.5, 12.6, 13.1, 13.3, 13.6, 14.4, 14.5, 14.6, 15.5_

  - [ ]* 10.4 Write unit test that a throwing `createRenderer` reports `unavailable`
    - _Requirements: 3.11_

  - [x] 10.5 Create viewport React components
    - `ViewportCanvas.tsx`, `ViewportToolbar.tsx` (Iso, Front, Top, Fit, Explode_Slider, play and pause, Step_Timeline with one labelled tick per Step and a visible reason when disabled), `DropZone.tsx` (drag counter, visible outline and label, drop calls `solveFile`), `WebglUnavailable.tsx`, and an error boundary that shows a text error and a sample-kit action. Components read state through the context and change it only by dispatch.
    - _Requirements: 3.6, 3.11, 4.7, 7.2, 7.3, 11.1, 11.8, 11.9, 11.11, 14.9, 16.4_

- [x] 11. Header, panels and live region
  - [x] 11.1 Create `src/header/` components
    - `HeaderBar`, `KitSelector` (native `<select>` with "Showcase" and "Deadlock Cage" optgroups), `UploadButton` (visible button plus hidden `<input type="file" accept=".glb,.gltf">`), `HeroToggle` (two buttons "UnboltKit DBG" and "Naive Radial Explode" with `aria-pressed`, disabled per `selectControlEnablement`), `ClashBadge` (monospace, SVG icon plus text).
    - _Requirements: 2.2, 6.1, 6.2, 7.1, 10.1, 10.2, 10.6, 10.7, 10.8_

  - [x] 11.2 Create `src/panels/` manifest components
    - `ManifestPanel`, `StepRow` (`<button type="button">`, `aria-current="step"` on the selected row), `BomSummary`, `StatusCallout` (Verified, Not Verified, Interlocked, Obstructed with icon and text), `LockedParts`, `InterlockBanner` ("Unsolvable Interlock Detected", numbered cycles with `from → to` edges, unassigned and peeled counts, Part-name buttons that dispatch a focus camera command). Primitive_Badge in monospace, "Not compiled" for deadlocked peeled steps, clash count and "Obstructed" in Naive mode, "Interlocked" label and icon, empty state pointing to the Kit_Selector and upload control.
    - _Requirements: 2.2, 13.4, 14.1, 14.2, 14.3, 14.6, 14.7, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10_

  - [x] 11.3 Create recovery, notice, progress and live-region components
    - `RecoveryCardView` (icon, heading, body, details, actions, focus moved to the card on mount with `tabIndex={-1}`), `NoticeBar` for the poly-budget warning, `ProgressStrip` (seven chips with stage name, text state and elapsed ms in monospace), `src/a11y/LiveRegion.tsx` (`role="status" aria-live="polite"`) plus a visible status line fed by the same `feedback.announcement`. The sample-kit action dispatches `recovery/dismissed` and calls `solveKit("mechanical-keyboard-65")`.
    - _Requirements: 5.6, 6.5, 8.7, 8.8, 8.9, 8.10, 16.1, 16.2, 16.3_

  - [ ]* 11.4 Write static-markup tests with `renderToStaticMarkup`
    - Header toggle labels and `aria-pressed`, toolbar has Iso, Front, Top and Fit, step rows are buttons with `aria-current` on the selected row, timeline has N labelled ticks, live region and visible status line show the same text.
    - _Requirements: 3.6, 10.1, 10.7, 11.11, 15.5, 15.6, 16.2, 16.3_

- [x] 12. Provider and application wiring
  - [x] 12.1 Create `src/state/AppStateProvider.tsx`
    - React Context plus `useReducer(rootReducer)`. Creates the `SolverClient`, a `matchMedia("(prefers-reduced-motion: reduce)")` listener dispatching `env/reducedMotionChanged`, the mount-time `solve({ kind: "kit", kitName: "mechanical-keyboard-65" })`, a `requestAnimationFrame` loop that runs only while `view.playing` and dispatches `view/tick`, and `dispose` on unmount. Hooks: `useAppState`, `useAppDispatch`, `useSolver` (`solveKit`, `solveFile` using `importGltfFile`; failures dispatch `recovery/raised`).
    - _Requirements: 4.1, 4.7, 5.11, 6.4, 7.5, 11.8, 11.10, 16.6_

  - [x] 12.2 Wire `src/main.tsx` and `src/App.tsx`
    - `main.tsx` mounts `<AppStateProvider><App/></AppStateProvider>` and imports the theme CSS. `App.tsx` composes `HeaderBar`, the progress strip, status line, notice and recovery card, the viewport area with `DropZone`, and `ManifestPanel` through props, with no feature logic. Update `index.html` title and root only if needed.
    - _Requirements: 2.4, 6.5, 6.6, 6.7, 17.3_

- [ ] 13. Smoke and static tests
  - [ ]* 13.1 Write smoke tests S1, S2 and S3 in `test/smoke/boundaries.test.ts`
    - S1: outside `src/worker/` no Core value import except `createDefaultPrimitiveRegistry`, no `three-mesh-bvh` import, only `solverClient.ts` constructs a `Worker` with `{ type: "module" }`, `GLTFLoader` only in `src/upload/`. S2: no `@unboltkit/core/` or `@unboltkit/sample-kits/` deep imports. S3: no `unbolt-blitz` import path.
    - Use `import.meta.glob("../../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })`.
    - _Requirements: 1.4, 2.5, 2.6, 5.3, 5.4, 7.4_

  - [ ]* 13.2 Write smoke tests S4 and S5 in `test/smoke/purity-hygiene.test.ts`
    - S4: `src/state/` (except `AppStateProvider.tsx`) and `src/motion/` import no `react`, `react-dom`, `three` or DOM global, and `src/protocol.ts` imports no React or DOM type. S5: no `Math.random`, no empty `catch`, no `Audio`, `AudioContext` or `<audio>`, no `<img>`, icon-font class or raster import.
    - _Requirements: 2.3, 4.6, 16.1, 17.4, 17.5, 17.7_

  - [ ]* 13.3 Write smoke tests S6 and S7 in `test/smoke/scope-config.test.ts`
    - S6: no exporter or authoring modules exist. S7: `package.json` dependencies match task 1 and no state library appears, `vite.config.ts` has `server.port` 5173 and `worker.format` `"es"`.
    - _Requirements: 1.1, 1.2, 1.3, 4.2, 17.1, 17.2_

- [x] 14. Checkpoint - Ensure all tests pass
  - Run `npx vitest run` in `"/Users/sarvesh/Dev/Kiroween 2027/apps/guide-forge"` as one command with an explicit tool `timeout` of at least 600000 ms. Read stdout for the `Test Files ... passed` line, not only the exit code.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Tune the real-pipeline test timeout
  - [x] 15.1 Measure the keyboard solve time
    - Create `test/unit/keyboard-solve-timing.test.ts`. It calls `runSolve` for `mechanical-keyboard-65` with a real `performance.now` clock and `checkClashes`, asserts `plan.status` is `solved`, `trajectory.length` equals `plan.steps.length` and `oracle.totalClashes` equals the sum of `perStep` counts, and prints the elapsed milliseconds with `console.info`.
    - Run it as one command: `npx vitest run test/unit/keyboard-solve-timing.test.ts` in `"/Users/sarvesh/Dev/Kiroween 2027/apps/guide-forge"`, with a tool `timeout` of 600000 ms. Record the printed time. If tasks 7.8 or 7.9 exist, also record the duration Vitest prints for their slowest test.
    - _Requirements: 17.6_

  - [x] 15.2 Replace the placeholder timeout
    - Edit `vitest.config.ts`: set `testTimeout` to about 3 times the slowest measured real-pipeline test, rounded up to the next 5 000 ms, with a minimum of 30 000 ms. Replace the `120_000` placeholder and add a comment giving the measured time and the factor.
    - Re-run `npx vitest run` once as a single command (explicit tool `timeout`) and confirm `Test Files ... passed`.
    - _Requirements: 17.6_

- [x] 16. Final verification (one shell command at a time)
  - [x] 16.1 Install workspace dependencies
    - Run `npm install` in `"/Users/sarvesh/Dev/Kiroween 2027"` and confirm from stdout that it resolves `@unboltkit/core`, `@unboltkit/sample-kits` and `three` for the app without error. Use a tool `timeout` of at least 600000 ms.
    - _Requirements: 1.5_

  - [x] 16.2 Type-check until zero errors
    - Run `npx tsc --noEmit` in `"/Users/sarvesh/Dev/Kiroween 2027/apps/guide-forge"`. Fix every diagnostic in `apps/guide-forge` (never in `packages/`), then re-run, until the output reports zero errors. Do not run the same failing command more than twice without a code change in between.
    - _Requirements: 1.6_

  - [x] 16.3 Build until zero errors
    - Run `npm run build` in `"/Users/sarvesh/Dev/Kiroween 2027/apps/guide-forge"`. Fix every error, then re-run, until the build finishes with zero errors and `dist/assets` holds a separate worker chunk (check with `list_directory`, not a shell command). If a build fix changes any source file, re-run `npx tsc --noEmit` (task 16.2) until it also reports zero errors, then re-run the build.
    - _Requirements: 1.7_

  - [x] 16.4 Confirm Core is unchanged
    - Run `git status --short -- packages/unbolt-core` in `"/Users/sarvesh/Dev/Kiroween 2027"` and confirm the output is empty.
    - _Requirements: 1.8_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Task 15.1 and the verification tasks in 16 are not optional.
- Each task references specific requirements for traceability.
- Checkpoints ensure incremental validation.
- Property tests validate the universal correctness properties 1 to 22 of the design. Unit and smoke tests cover examples, configuration and the thread boundary.
- Part 1 contains no offline HTML exporter and no tool, torque or narration authoring toolbar. Part 2 adds an `authoring` slice, an `export/` folder and toolbar components without changing the worker pipeline.
- The existing `build` script already runs `tsc --noEmit` before `vite build`, and the existing `typecheck` script stays unchanged in task 1. A root `npm test` will now also run the Guide Forge suite.
- Manual browser checks (`npm run dev`, drag and drop, focus movement, WebGL, responsiveness during a solve) are done by the user. The agent does not start a dev server.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1", "3.2"] },
    { "id": 2, "tasks": ["2.3", "3.3", "4.1", "4.3", "4.4", "5.1", "6.1", "7.1", "7.4"] },
    { "id": 3, "tasks": ["4.2", "4.5", "4.7", "4.9", "5.2", "5.4", "6.2", "6.3", "7.2", "7.3", "7.5", "8.1", "10.1"] },
    { "id": 4, "tasks": ["4.6", "4.8", "5.3", "5.5", "5.6", "5.7", "5.8", "6.4", "7.6", "8.2", "9.1", "10.2", "10.3"] },
    { "id": 5, "tasks": ["5.9", "5.10", "5.11", "5.12", "5.13", "5.14", "5.15", "7.7", "7.8", "7.9", "7.10", "9.2", "10.4", "12.1"] },
    { "id": 6, "tasks": ["10.5", "11.1", "11.2", "11.3"] },
    { "id": 7, "tasks": ["11.4", "12.2"] },
    { "id": 8, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 9, "tasks": ["14"] },
    { "id": 10, "tasks": ["15.1"] },
    { "id": 11, "tasks": ["15.2"] },
    { "id": 12, "tasks": ["16.1"] },
    { "id": 13, "tasks": ["16.2"] },
    { "id": 14, "tasks": ["16.3"] },
    { "id": 15, "tasks": ["16.4"] }
  ]
}
```
