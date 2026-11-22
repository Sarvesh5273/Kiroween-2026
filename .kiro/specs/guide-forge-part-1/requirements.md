# Requirements Document

## Introduction

Guide Forge Part 1 is the first slice of `apps/guide-forge`, a light-blueprint technical CAD studio that turns a 3D assembly into a verified disassembly sequence. The app is built on `@unboltkit/core` (the CPU solver) and `@unboltkit/sample-kits` (five deterministic procedural assemblies). Part 1 delivers:

- a Studio-lit Three.js viewport with quick camera views;
- a non-blocking Web Worker that runs the full solver pipeline plus an independent clash oracle and the naive radial baseline;
- loading of the five bundled kits and of user `.glb`/`.gltf` files;
- recovery states for unusable uploads;
- a hero comparison between the UnboltKit DBG plan and a Naive Radial Explode;
- a Tarjan SCC deadlock visualization;
- a right-hand Step and BOM Manifest Panel.

Part 1 excludes the offline `.html` manual exporter and the editable tool, torque and narration authoring toolbar. The application state and component boundaries are structured so that Part 2 can add those features without rewriting Part 1.

The app follows the workspace steering rules: `ui-separation` (light-blueprint identity, no shared shell with `apps/unbolt-blitz`, mute-friendly, recovery states), `geometry-invariants` (`@unboltkit/core` stays pure CPU TypeScript, assemblies normalized to `maxExtent = 1.0` before DBG raycasting, BVH and DBG builds only in a Web Worker), and `no-spec-gaming` (solver output comes from geometry and the algorithm, with no swallowed errors and no hardcoded fixture results).

## Glossary

- **Guide_Forge_App**: The React application in `apps/guide-forge`, served by Vite on port 5173.
- **Main_Thread**: The browser UI thread of the Guide_Forge_App.
- **Solver_Worker**: The ES-module Web Worker at `apps/guide-forge/src/worker/solver.worker.ts`.
- **Core**: The `@unboltkit/core` package, imported only from its package root.
- **Sample_Kits**: The `@unboltkit/sample-kits` package.
- **Kit_Name**: One of `mechanical-keyboard-65`, `planetary-gearbox-3-stage`, `haunted-clockwork-lockbox`, `deadlock-cage-dumbbell-ring`, `deadlock-cage-ship-in-bottle`.
- **Showcase_Kit**: A Kit_Name from the Sample_Kits `SHOWCASE_KITS` list (the first three).
- **Deadlock_Cage**: A Kit_Name from the Sample_Kits `DEADLOCK_CAGES` list (the last two).
- **Solve_Request**: A message from the Main_Thread to the Solver_Worker that asks for one solve, carrying a request identifier and either a Kit_Name or a Scene_Payload.
- **Scene_Payload**: The plain-data description of an uploaded model: a node tree with name, local translation, local quaternion and local scale per node, and for mesh nodes the position, normal and index buffers plus a Material_Descriptor. A Scene_Payload holds no texture, image, canvas or DOM object.
- **Material_Descriptor**: Plain data describing a surface: base colour, metalness, roughness, transmission, opacity and emissive colour.
- **Solve_Result**: The plain-data message the Solver_Worker returns for one successful solve. A Solve_Result contains the plan, the compiled Trajectory_Steps, the Oracle_Report, the Naive_Report, the Part_Render_Data and timing figures.
- **Plan**: The Core `DisassemblyPlan` with `status` equal to `solved`, `deadlocked` or `error`.
- **Step**: One entry of the Plan `steps` list, with `partId`, `dir` and `escapeDistance`.
- **Trajectory_Step**: One entry returned by `stage4Compile`, with `partId`, `primitive` and `params`.
- **Primitive_Badge**: A label showing the `primitive` name of a Trajectory_Step, such as `helical_unscrew` or `linear_slide`.
- **Oracle_Report**: The Solver_Worker's result of running Core `checkClashes` on every Step of a solved Plan, listing the clash count per Step and the total.
- **Naive_Report**: The Core `NaiveBaselineResult` returned by `computeNaiveRadialClashes`.
- **Part_Render_Data**: Per Part, the Part_ID, source node name and node path, positions and indices in normalized coordinates, normals, and a Material_Descriptor.
- **Normalization_Transform**: The Plan `normalization` value (`scale`, `translation`) that maps source coordinates to normalized coordinates with `maxExtent = 1.0`.
- **Stage_Progress_Event**: A message from the Solver_Worker naming a pipeline stage, its state (`started` or `completed`) and the elapsed milliseconds.
- **Viewport**: The WebGL canvas region that shows the assembly.
- **Manifest_Panel**: The right-hand panel that lists Steps and the bill of materials.
- **Header_Bar**: The top region holding the application title, the Kit_Selector, the upload control and the Hero_Toggle.
- **Kit_Selector**: The Header_Bar control that lists all five Kit_Names.
- **Hero_Toggle**: The Header_Bar control that switches between DBG_Mode and Naive_Mode.
- **DBG_Mode**: The comparison mode that shows the UnboltKit DBG plan.
- **Naive_Mode**: The comparison mode that shows the Naive Radial Explode.
- **Step_Timeline**: The scrubbable control that selects a position `p` in the range 0 to N, where N is the number of Steps.
- **Explode_Slider**: The global slider that maps its value `s` in [0, 1] to the timeline position `p = s × N` in DBG_Mode and to the radial travel fraction in Naive_Mode.
- **Leader_Spline**: A blueprint-styled curve drawn in the Viewport that traces the extraction path of a Part.
- **Clash_Badge**: The monospace telemetry badge in the Header_Bar that shows the clash summary of the active mode.
- **Recovery_Card**: A card that explains an unusable or risky load and offers a next step.
- **Interlock_Banner**: The banner that announces "Unsolvable Interlock Detected" and lists each Tarjan SCC cycle.
- **Deadlocked_Part**: A Part whose Part_ID appears in the `partIds` of any `witness.sccs` entry of a deadlocked Plan.
- **App_State**: The single typed state object held by the React Context and `useReducer` store.
- **App_Action**: The single discriminated union of actions accepted by the App_State reducer.
- **Blueprint_Palette**: Canvas `#F6F8FB`, accent `#1E3A5F`, text `#0F172A`.

## Requirements

### Requirement 1: Dependencies, build configuration and verification

**User Story:** As a developer, I want the app wired to the workspace packages with a correct Vite and TypeScript setup, so that the app installs, type-checks and builds cleanly.

#### Acceptance Criteria

1. THE Guide_Forge_App `package.json` SHALL list `@unboltkit/core` with version `*`, `@unboltkit/sample-kits` with version `*` and `three` with version `^0.170.0` under `dependencies`.
2. THE Guide_Forge_App `package.json` SHALL list `@types/three` under `devDependencies`.
3. THE Guide_Forge_App `vite.config.ts` SHALL set `server.port` to 5173 and `worker.format` to `"es"`.
4. THE Guide_Forge_App SHALL import Core and Sample_Kits only through their package roots.
5. WHEN `npm install` runs in the repository root, THE workspace SHALL resolve `@unboltkit/core`, `@unboltkit/sample-kits` and `three` for the Guide_Forge_App without error.
6. WHEN `npx tsc --noEmit` runs in `apps/guide-forge`, THE TypeScript compiler SHALL report zero errors.
7. WHEN `npm run build` runs in `apps/guide-forge`, THE build SHALL finish with zero errors and SHALL emit the Solver_Worker as a separate ES-module bundle.
8. THE Guide_Forge_App SHALL leave every file under `packages/unbolt-core` unchanged.

### Requirement 2: Light-blueprint visual identity and layout

**User Story:** As a user, I want a drafting-paper CAD studio look, so that the tool reads as a technical manual workspace and not a dark dashboard.

#### Acceptance Criteria

1. THE Guide_Forge_App SHALL render the page canvas background with `#F6F8FB`, interactive accents and rules with `#1E3A5F`, and body and heading text with `#0F172A`.
2. THE Guide_Forge_App SHALL render every numeric telemetry value and every Primitive_Badge in a monospace font.
3. THE Guide_Forge_App SHALL draw every icon as inline SVG with no raster image and no icon-font dependency.
4. THE Guide_Forge_App SHALL arrange the Header_Bar across the top, the Viewport in the centre, and the Manifest_Panel on the right.
5. THE Guide_Forge_App SHALL keep its CSS, theme tokens and components free of any import from `apps/unbolt-blitz`.
6. THE Guide_Forge_App SHALL place theme styles inside `apps/guide-forge` and SHALL place no app chrome or theme in any package under `packages/`.
7. THE Guide_Forge_App SHALL set text and background colour pairs so that the contrast ratio of body text against its background is at least 4.5:1.

### Requirement 3: Studio-lit Viewport and camera controls

**User Story:** As a user, I want a sharp, realistic studio-lit 3D view with quick camera views, so that I can inspect materials and parts clearly.

#### Acceptance Criteria

1. THE Viewport SHALL render with a `WebGLRenderer` that uses `ACESFilmicToneMapping`.
2. THE Viewport SHALL generate its environment map from `RoomEnvironment` through `PMREMGenerator` and SHALL assign the result as the scene environment.
3. THE Viewport SHALL draw a blueprint-styled ground grid in `#1E3A5F` at reduced opacity under the assembly.
4. THE Viewport SHALL provide `OrbitControls` for rotate, pan and zoom.
5. THE Viewport SHALL render each Part with a physically based material built from that Part's Material_Descriptor, so that metallic, rough and transmissive surfaces differ visibly.
6. THE Header_Bar or Viewport toolbar SHALL provide four buttons labelled Iso, Front, Top and Fit.
7. WHEN the user activates the Iso, Front or Top button, THE Viewport SHALL move the camera to the isometric, front or top direction of the assembly bounds.
8. WHEN the user activates the Fit button, THE Viewport SHALL frame the full assembly, including every Part at its current explode pose, within the camera frustum.
9. WHEN the Viewport container is resized, THE Viewport SHALL update the renderer size, the camera aspect ratio and the device pixel ratio.
10. WHEN the Viewport unmounts, THE Viewport SHALL dispose of its geometries, materials, textures, render targets, controls and renderer.
11. IF WebGL context creation fails, THEN THE Guide_Forge_App SHALL show a text message that states WebGL is unavailable and SHALL keep the Manifest_Panel usable.

### Requirement 4: Application state architecture

**User Story:** As a developer, I want one typed state shape and one action union held in React Context, so that Part 2 can extend the app state without new state libraries.

#### Acceptance Criteria

1. THE Guide_Forge_App SHALL hold all shared UI and solver state in an App_State managed by React Context and `useReducer`.
2. THE Guide_Forge_App SHALL add no state-management library to its dependencies.
3. THE Guide_Forge_App SHALL define the App_State as one exported TypeScript type and the App_Action as one exported discriminated union.
4. THE App_State SHALL contain the load status, the active Kit_Name or file name, the latest Solve_Result, the latest Stage_Progress_Event per stage, the active mode, the Step_Timeline position, the selected Step index and the current Recovery_Card or notice.
5. THE reducer SHALL be a pure function of the previous App_State and one App_Action.
6. THE reducer SHALL reside in a module that imports no React, no DOM and no Three.js symbol, so that tests can run the reducer in Node.
7. THE Viewport, Manifest_Panel and Header_Bar SHALL read App_State through the Context and SHALL change App_State only by dispatching App_Actions.

### Requirement 5: Solver_Worker pipeline and live progress

**User Story:** As a user, I want the solver to run off the UI thread and report progress, so that the interface stays responsive while the solve runs.

#### Acceptance Criteria

1. WHEN the Solver_Worker receives a Solve_Request, THE Solver_Worker SHALL run `stage0ParseScene`, `stage1Prepare`, `stage2BuildDbg`, `stage3Peel` and `stage4Compile` in that order.
2. WHEN the Plan from `stage3Peel` has `status` equal to `solved` and `stage4Compile` returns `ok`, THE Solver_Worker SHALL run `checkClashes` over every Step and SHALL run `computeNaiveRadialClashes`.
3. THE Guide_Forge_App SHALL execute every call to a Core stage function, `checkClashes` and `computeNaiveRadialClashes` inside the Solver_Worker and SHALL execute none of them on the Main_Thread.
4. THE Main_Thread SHALL create the Solver_Worker with `new Worker(new URL(...), { type: "module" })`.
5. WHEN the Solver_Worker begins and completes each of the stages stage0, stage1, stage2, stage3, stage4, oracle and naive, THE Solver_Worker SHALL post a Stage_Progress_Event for that stage.
6. WHEN the Main_Thread receives a Stage_Progress_Event, THE Guide_Forge_App SHALL show the stage name, its state and the elapsed milliseconds in a progress strip.
7. WHEN the Plan has `status` equal to `deadlocked`, THE Solver_Worker SHALL run `computeNaiveRadialClashes` and SHALL skip `stage4Compile` and the oracle step.
8. THE Solver_Worker SHALL return the Plan from Core without altering the `steps`, `witness`, `normalization` or `sampling` values.
9. THE Solver_Worker SHALL post only structured-cloneable plain data and SHALL list typed-array buffers as transferables.
10. WHILE a solve runs, THE Main_Thread SHALL keep orbit controls, panel scrolling and button presses responsive.
11. WHEN the Main_Thread issues a Solve_Request while an earlier Solve_Request is unfinished, THE Guide_Forge_App SHALL terminate the earlier Solver_Worker, start a new one and ignore any later message that carries the earlier request identifier.
12. IF the Solver_Worker throws a Core error or any other exception, THEN THE Solver_Worker SHALL post a failure message that carries the error name, the Core `code` when present and the message text, and THE Guide_Forge_App SHALL show that failure in a Recovery_Card.

### Requirement 6: Loading the five bundled kits

**User Story:** As a user, I want to open any of the five bundled kits, so that I can explore both solvable assemblies and deadlock traps.

#### Acceptance Criteria

1. THE Kit_Selector SHALL list all five Kit_Names, grouped under the labels Showcase and Deadlock Cage, with a human-friendly title for each.
2. WHEN the user selects a Kit_Name, THE Main_Thread SHALL post a Solve_Request that carries only that Kit_Name and the request identifier.
3. WHEN the Solver_Worker receives a Solve_Request that carries a Kit_Name, THE Solver_Worker SHALL build the kit by calling the matching Sample_Kits builder inside the worker.
4. WHEN the Guide_Forge_App first opens, THE Guide_Forge_App SHALL post a Solve_Request for `mechanical-keyboard-65` without user input.
5. WHILE the first solve runs, THE Viewport and Manifest_Panel SHALL show a loading state with the progress strip visible.
6. WHEN a Solve_Result arrives, THE Guide_Forge_App SHALL populate the Viewport and Manifest_Panel from that Solve_Result.
7. WHEN a Solve_Result for a Deadlock_Cage arrives, THE Guide_Forge_App SHALL present the deadlock visualization of Requirement 14.
8. IF the Solver_Worker receives a Kit_Name outside the five Kit_Names, THEN THE Solver_Worker SHALL post a failure message that names the rejected value.

### Requirement 7: Uploading `.glb` and `.gltf` files

**User Story:** As a user, I want to drop or pick my own model, so that I can generate a disassembly plan for my assembly.

#### Acceptance Criteria

1. THE Header_Bar SHALL provide a file-picker control that accepts `.glb` and `.gltf` files.
2. THE Guide_Forge_App SHALL accept a dropped `.glb` or `.gltf` file anywhere on the Viewport.
3. WHILE a file is dragged over the Viewport, THE Viewport SHALL show a visible drop target outline with a text label.
4. WHEN a file is chosen or dropped, THE Main_Thread SHALL parse the file with Three `GLTFLoader` on the Main_Thread.
5. WHEN parsing succeeds, THE Main_Thread SHALL convert the loaded scene into a Scene_Payload and SHALL post a Solve_Request that carries the Scene_Payload.
6. THE Main_Thread SHALL include in the Scene_Payload only node names, local translation, local quaternion, local scale, position buffers, normal buffers, index buffers and Material_Descriptors.
7. THE Main_Thread SHALL list the position, normal and index buffers of the Scene_Payload as transferables.
8. WHEN the Solver_Worker receives a Scene_Payload, THE Solver_Worker SHALL rebuild a Three `Object3D` tree with the local transforms and `BufferGeometry` meshes and SHALL pass its root to `stage0ParseScene`.
9. WHERE a loaded `.glb` carries textures, THE Solver_Worker SHALL complete the solve without receiving any texture data.
10. WHEN the user chooses a file whose extension is neither `.glb` nor `.gltf`, THE Guide_Forge_App SHALL show a Recovery_Card that names the accepted extensions and offers the file picker and a sample-kit fallback.
11. IF `GLTFLoader` fails to parse the file, THEN THE Guide_Forge_App SHALL show a Recovery_Card that states the loader message and offers the file picker and a sample-kit fallback.
12. IF the loaded scene holds no mesh node, THEN THE Guide_Forge_App SHALL show the empty-assembly Recovery_Card of Requirement 8 without posting a Solve_Request.

### Requirement 8: Recovery states

**User Story:** As a user, I want clear explanations and a next step when a model cannot be processed, so that I am never left at a dead end.

#### Acceptance Criteria

1. WHEN the Plan has `status` equal to `error` and `error.kind` equal to `MonolithicMeshError`, THE Guide_Forge_App SHALL show a Recovery_Card that states the model is one connected island, shows `totalTriangles` and the `nodePath`, and explains that no separate parts exist to disassemble.
2. WHEN the Plan has `status` equal to `error` and `error.kind` equal to `EmptyAssemblyError`, THE Guide_Forge_App SHALL show a Recovery_Card that states the file holds no triangles.
3. WHEN the Plan has `status` equal to `error` and `error.kind` equal to `InvalidGeometryError`, THE Guide_Forge_App SHALL show a Recovery_Card that states the `reason` in plain language and lists the affected node paths.
4. WHEN the Plan has `status` equal to `error` and `error.kind` equal to `ConfigurationError`, THE Guide_Forge_App SHALL show a Recovery_Card that states the configuration message.
5. WHEN `sampling.polyBudgetExceeded` is `true`, THE Guide_Forge_App SHALL show a warning notice that states `totalTriangles`, the polygon budget of 150000 and the sampling `stride`.
6. WHEN the warning notice of criterion 5 is visible and the Plan is not an error, THE Guide_Forge_App SHALL continue to show the Plan results in the Viewport and Manifest_Panel.
7. THE Guide_Forge_App SHALL give every Recovery_Card and the oversize warning notice a one-click action that loads the `mechanical-keyboard-65` sample kit and an action that opens the file picker.
8. WHEN the user activates the sample-kit action of a Recovery_Card, THE Guide_Forge_App SHALL dismiss that Recovery_Card and post a Solve_Request for that Kit_Name.
9. THE Guide_Forge_App SHALL render each Recovery_Card with an icon, a heading and body text, so that the state is understandable without sound or colour alone.
10. WHEN a Recovery_Card is shown, THE Guide_Forge_App SHALL move keyboard focus to that Recovery_Card.

### Requirement 9: Independent oracle verification

**User Story:** As a user, I want the "Verified" claim to come from an independent geometric check, so that the claim is trustworthy and not inferred from the solver status.

#### Acceptance Criteria

1. WHEN `stage4Compile` returns `ok`, THE Solver_Worker SHALL call `checkClashes` once per Step, with the moving Part set to the Part of the Step, `dir` set to the Step `dir`, and the static set set to every Part whose Step comes later in the Plan.
2. THE Solver_Worker SHALL pass to `checkClashes` the Stage 1 normalized Parts and the resolved solver config from `stage1Prepare`.
3. THE Solver_Worker SHALL include in the Oracle_Report the clash `count` of each Step and the sum of all counts.
4. THE Oracle_Report SHALL be computed from `checkClashes` results and not from the Plan `status`.
5. IF `checkClashes` reports a total above zero, THEN THE Solver_Worker SHALL return the Oracle_Report with that total and THE Clash_Badge SHALL show the DBG clash count with the label Not Verified.
6. IF `checkClashes` throws, THEN THE Solver_Worker SHALL post a failure message under Requirement 5, criterion 12.

### Requirement 10: Hero comparison toggle and clash badges

**User Story:** As a user, I want a prominent toggle between UnboltKit DBG and Naive Radial Explode, so that I can see the difference between a verified plan and a naive one.

#### Acceptance Criteria

1. THE Header_Bar SHALL show the Hero_Toggle with two options labelled "UnboltKit DBG" and "Naive Radial Explode".
2. WHEN the user activates an option of the Hero_Toggle, THE Guide_Forge_App SHALL set the active mode and SHALL update the Viewport, the Clash_Badge and the Manifest_Panel without a new Solve_Request.
3. WHILE the active mode is DBG_Mode and the Oracle_Report total equals 0, THE Clash_Badge SHALL show the text `0 Clashes • Verified`.
4. WHILE the active mode is Naive_Mode, THE Clash_Badge SHALL show `X Clashes • Y Obstructed Parts`, where X equals `totalClashes` of the Naive_Report and Y equals the number of `perPart` entries with `clashCount` above 0.
5. WHILE the active mode is DBG_Mode and the Plan has `status` equal to `deadlocked`, THE Clash_Badge SHALL show the text `Interlocked • No Valid Sequence`.
6. THE Clash_Badge SHALL render in a monospace font with a leading status icon and the text, so that the status does not depend on colour.
7. THE Hero_Toggle SHALL expose each option as a button with `aria-pressed` that reflects the active mode.
8. WHILE no Solve_Result is available, THE Hero_Toggle SHALL be disabled.

### Requirement 11: DBG animation with real motion primitives

**User Story:** As a user, I want the DBG mode to animate each Part along its compiled motion, so that fasteners visibly unscrew and sliding parts slide.

#### Acceptance Criteria

1. THE Guide_Forge_App SHALL provide the Step_Timeline and the Explode_Slider, and WHILE the active mode is DBG_Mode THE Step_Timeline and the Explode_Slider SHALL always reflect the same position `p`.
2. WHEN the user moves the Step_Timeline or the Explode_Slider in DBG_Mode, THE Viewport SHALL set the local parameter of Trajectory_Step `i` (zero-based) to `clamp(p − i, 0, 1)`.
3. THE Viewport SHALL obtain each Part pose by calling `createDefaultPrimitiveRegistry().get(step.primitive).value.pose(t, step.params)` with the local parameter of that Trajectory_Step.
4. THE Viewport SHALL apply the returned `rotation` and `translation` as `x ↦ R·x + T` to the Part in normalized coordinates.
5. WHEN a Trajectory_Step has `primitive` equal to `helical_unscrew`, THE Viewport SHALL show the Part rotating about its helical axis while the Part translates, as `pose` returns.
6. WHILE the local parameter of a Trajectory_Step equals 0, THE Viewport SHALL show the Part at its assembled position.
7. WHILE the local parameter of a Trajectory_Step equals 1, THE Viewport SHALL hold the Part at the final pose returned by `pose(1, params)`.
8. WHEN the user activates a play control, THE Guide_Forge_App SHALL advance `p` from the current value to N at a constant rate and SHALL stop at N.
9. WHEN the user activates a pause control during playback, THE Guide_Forge_App SHALL stop advancing `p`.
10. WHERE the user's operating system reports `prefers-reduced-motion: reduce`, THE Guide_Forge_App SHALL disable automatic playback and SHALL apply poses only in response to direct slider or timeline input.
11. THE Step_Timeline SHALL show one tick per Step, labelled with the Step number.

### Requirement 12: Extraction leader splines

**User Story:** As a user, I want blueprint leader lines that show where the active Part travels, so that I can read each removal path at a glance.

#### Acceptance Criteria

1. WHILE the active mode is DBG_Mode, THE Viewport SHALL draw a Leader_Spline for the selected Step.
2. THE Viewport SHALL compute the Leader_Spline by calling `pose(t, params)` at no fewer than 16 evenly spaced values of `t` from 0 to 1 and by applying each pose to the Part centre.
3. THE Viewport SHALL draw the Leader_Spline in `#1E3A5F` with an arrowhead at the final sample and a numbered Step label at the first sample.
4. WHEN the selected Step changes, THE Viewport SHALL replace the Leader_Spline with the one for the newly selected Step.
5. WHILE the local parameter of the selected Step is above 0 and below 1, THE Viewport SHALL emphasize the portion of the Leader_Spline that the Part has already travelled.
6. WHEN the mode changes to Naive_Mode, THE Viewport SHALL remove all DBG Leader_Splines.

### Requirement 13: Naive Radial Explode and clash highlighting

**User Story:** As a user, I want the naive explosion to show which parts collide, so that the difference from the zero-clash DBG plan is unmistakable.

#### Acceptance Criteria

1. WHILE the active mode is Naive_Mode, THE Viewport SHALL translate each Part along the `direction` of its `perPart` entry in the Naive_Report by a distance equal to the Explode_Slider value multiplied by one fixed travel distance shared by all Parts.
2. WHILE the active mode is Naive_Mode and the Explode_Slider value is 0, THE Viewport SHALL show every Part at its assembled position.
3. WHILE the active mode is Naive_Mode, THE Viewport SHALL render each Part whose `clashCount` is above 0 with a pulsing crimson emissive highlight.
4. WHILE the active mode is Naive_Mode, THE Manifest_Panel SHALL show the `clashCount` of each Part next to that Part's row, with a text label "Obstructed" for each Part whose `clashCount` is above 0.
5. WHERE the user's operating system reports `prefers-reduced-motion: reduce`, THE Viewport SHALL render clashing Parts with a steady crimson highlight in place of a pulse.
6. WHEN the mode changes from Naive_Mode to DBG_Mode, THE Viewport SHALL remove the crimson highlights and apply the DBG poses for the current Step_Timeline position.
7. IF the Plan has `status` equal to `error`, THEN THE Hero_Toggle SHALL remain disabled because no Naive_Report exists.

### Requirement 14: Tarjan SCC deadlock trap visualization

**User Story:** As a user, I want a clear warning and a 3D highlight when an assembly is interlocked, so that I understand why no valid sequence exists and which parts cause the lock.

#### Acceptance Criteria

1. WHEN the Plan has `status` equal to `deadlocked`, THE Guide_Forge_App SHALL show the Interlock_Banner with the heading "Unsolvable Interlock Detected".
2. THE Interlock_Banner SHALL list each entry of `witness.sccs` as one numbered cycle, showing the Part names of `partIds` and the `from → to` pairs of its `edges`.
3. THE Interlock_Banner SHALL show the count of Parts in `witness.unassignedPartIds` and the count of Steps in the Plan that were peeled before the deadlock.
4. WHILE the Plan has `status` equal to `deadlocked`, THE Viewport SHALL render each Deadlocked_Part with a glowing amber-to-crimson emissive highlight.
5. WHILE the Plan has `status` equal to `deadlocked`, THE Viewport SHALL render each Part in `witness.unassignedPartIds` that is not a Deadlocked_Part with a steady amber outline.
6. WHEN the user activates a Part name inside the Interlock_Banner, THE Viewport SHALL focus the camera on that Part.
7. WHILE the Plan has `status` equal to `deadlocked`, THE Manifest_Panel SHALL mark each Deadlocked_Part row with the text label "Interlocked" and an icon.
8. WHERE the user's operating system reports `prefers-reduced-motion: reduce`, THE Viewport SHALL render Deadlocked_Parts with a steady highlight in place of a glow animation.
9. WHILE the Plan has `status` equal to `deadlocked` and the active mode is DBG_Mode, THE Viewport SHALL show the Parts at their assembled positions and SHALL keep the Explode_Slider and Step_Timeline disabled.
10. WHILE the Plan has `status` equal to `deadlocked` and the active mode is Naive_Mode, THE Viewport SHALL animate the Naive Radial Explode as in Requirement 13 and keep the Deadlocked_Part highlight.

### Requirement 15: Step and BOM Manifest Panel

**User Story:** As a user, I want a right-hand manifest of every step in order, so that I can jump to any step and read its motion and distance.

#### Acceptance Criteria

1. THE Manifest_Panel SHALL list every Step of the Plan in exact Plan order.
2. THE Manifest_Panel SHALL show for each Step the step number, a human-friendly Part name, the Primitive_Badge and the `escapeDistance` formatted with three decimals in normalized units.
3. THE Manifest_Panel SHALL derive the human-friendly Part name from the source node name of the Part and SHALL fall back to "Part " followed by the Part_ID when the source node name is empty.
4. WHEN the user activates a Step row, THE Guide_Forge_App SHALL set the selected Step to that Step, set the Step_Timeline position `p` to that Step's index plus 1, and focus the camera on that Part.
5. WHILE a Step is selected, THE Viewport SHALL render the Part of that Step with a `#1E3A5F` selection highlight and THE Manifest_Panel SHALL mark the row with `aria-current="step"`.
6. THE Manifest_Panel SHALL render each Step row as a keyboard-focusable button that responds to Enter and Space.
7. THE Manifest_Panel SHALL show a bill-of-materials summary with the total Part count, the count of Steps whose primitive is `helical_unscrew`, the count of Steps whose primitive is `linear_slide`, and the count of Steps of any other primitive.
8. WHILE the Plan has `status` equal to `deadlocked`, THE Manifest_Panel SHALL list the peeled Steps with the label "Not compiled" in place of a Primitive_Badge, and SHALL list each Deadlocked_Part and each other unassigned Part under a heading "Locked Parts".
9. THE Manifest_Panel SHALL show a status callout with an icon and text for each of the states Verified, Not Verified, Interlocked and Obstructed, so that status reads without colour or sound.
10. WHEN the Plan has `status` equal to `error` or no Solve_Result exists, THE Manifest_Panel SHALL show an empty state that points the user to the Kit_Selector and the upload control.

### Requirement 16: Mute-friendly accessibility

**User Story:** As a user on mute or using assistive technology, I want every cue to appear as text or a visual signal, so that the app is fully usable without sound.

#### Acceptance Criteria

1. THE Guide_Forge_App SHALL play no sound.
2. THE Guide_Forge_App SHALL convey each state change (load started, stage completed, solve finished, recovery state, deadlock, mode change) with a visible text message.
3. THE Guide_Forge_App SHALL announce solve completion, recovery states and mode changes through an `aria-live` region.
4. THE Guide_Forge_App SHALL label every icon-only control with an accessible name and a visible tooltip.
5. THE Guide_Forge_App SHALL show a visible focus outline on every interactive control.
6. WHERE the user's operating system reports `prefers-reduced-motion: reduce`, THE Guide_Forge_App SHALL replace pulsing and glowing animations with steady highlights.

### Requirement 17: Scope boundary and Part 2 extensibility

**User Story:** As a developer, I want Part 1 limited to its scope and cleanly modular, so that Part 2 plugs into the existing app state.

#### Acceptance Criteria

1. THE Guide_Forge_App SHALL contain no offline `.html` manual exporter in Part 1.
2. THE Guide_Forge_App SHALL contain no editable tool, torque or narration authoring toolbar in Part 1.
3. THE Guide_Forge_App SHALL separate the Solver_Worker, the App_State module, the Viewport, the Manifest_Panel and the Header_Bar into distinct modules, so that Part 2 can add features without editing the Solver_Worker pipeline.
4. THE Guide_Forge_App SHALL define the message types between the Main_Thread and the Solver_Worker in one shared TypeScript module that holds no DOM and no React import.
5. THE Guide_Forge_App SHALL use no `Math.random()` call in any solver, worker or test code, and SHALL use seeded generators wherever tests need random values.
6. WHERE a test checks the Solver_Worker pipeline, THE test SHALL assert a geometric or graph property of the real result, such as the Oracle_Report total, the Plan step order or the SCC membership.
7. THE Guide_Forge_App SHALL catch no error without either handling it in the UI or rethrowing it.
