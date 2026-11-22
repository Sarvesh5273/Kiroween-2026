# Requirements Document

## Introduction

Unbolt Blitz is a dark "Clockwork Arcade" disassembly puzzle game. The player rotates a 3D assembly on a turntable, clicks parts to unbolt them, and tries to remove every part in a valid order. Clicking a part that is still blocked costs time and combo. When an assembly contains a true interlock, the player pulls the "Flag Interlock Trap" lever to end the level.

Part 1 delivers the playable core as the new app `apps/unbolt-blitz` (dev server port 5174). The app consumes `@unboltkit/core` and `@unboltkit/sample-kits` and runs the solver pipeline in a Web Worker. It has a pure TypeScript game engine, a Three.js arena, and an arcade HUD. The app shares no code, CSS, or chrome with `apps/guide-forge`, and `packages/` is not modified.

Part 1 is architected so Part 2 (Ghost Extraction Hints, Web Audio synthesizer, campaign star ratings, localStorage high scores) plugs into the game reducer and the engine without changing them. Those Part 2 features are outside the scope of Part 1.

The game is fully playable with sound off. Every cue is carried by a visual or text signal.

## Glossary

- **Blitz_App**: The browser application in `apps/unbolt-blitz`.
- **Blitz_Engine**: The pure TypeScript module `src/game/blitzEngine.ts`. It imports no DOM, React, or Three.js code and holds the rules of the game.
- **Blitz_Reducer**: The pure reducer that holds game state, applies Blitz_Engine results, and records Game_Events.
- **Game_Event**: A plain-data record emitted by the Blitz_Reducer for each state transition (for example `part_removed`, `part_blocked`, `trap_flagged`, `level_completed`). Presentation code subscribes to Game_Events.
- **Blitz_Worker**: The Web Worker `src/worker/blitz.worker.ts` that runs the solver pipeline.
- **Solve_Result**: The plain-data message the Blitz_Worker returns for a successful solve. It contains Render_Data, the Blocking_Graph edges, the Disassembly_Plan, and Compiled_Trajectories.
- **Render_Data**: The per-part Stage 1 output in normalized coordinates: positions, normals, indices, material descriptors, OBB, AABB, `isFastener`, `principalAxis`, and `candidateAxes`.
- **Blocking_Graph**: The Stage 2 directed graph. An edge `from → to` with a `dirIndex` means Part `to` blocks Part `from` from moving along Candidate_Axis `dirIndex`.
- **Disassembly_Plan**: The Stage 3 result, with status `solved`, `deadlocked`, or `error`.
- **Compiled_Trajectories**: The Stage 4 `TrajectoryStep` list for the Disassembly_Plan.
- **Part**: One removable component of the assembly, identified by a Part_ID.
- **Part_ID**: The stable string identifier of a Part in the Blocking_Graph.
- **Display_Name**: The human-readable Part name shown in the HUD, derived from the source mesh node name (for example "Lid Fastener 1").
- **Candidate_Axis**: One of the 32 unit directions per Part in Render_Data `candidateAxes`, indexed by `dirIndex`.
- **Active_Edge**: A Blocking_Graph edge whose blocking Part has not yet been removed.
- **Unremoved_Blocker**: A Part that is not yet removed and is the `to` end of an Active_Edge on a given Candidate_Axis of the Part being tested.
- **Clear_Axis**: A Candidate_Axis of a Part that has 0 Unremoved_Blockers.
- **Escape_Distance**: The distance a Part travels along a Candidate_Axis before the Part's AABB no longer overlaps the AABB of any other live Part, in normalized units.
- **Legal_Unbolt**: A click on a live Part that has at least 1 Clear_Axis.
- **Blocked_Attempt**: A click on a live Part that has no Clear_Axis.
- **Combo**: The integer multiplier from x1 to x8 shown in the combo badge.
- **Mistake**: One Blocked_Attempt, counted in the `mistakes` counter.
- **False_Alarm**: A Flag Interlock Trap action raised when no genuine deadlock exists.
- **Deadlock_Witness**: The `witness` field of a `deadlocked` Disassembly_Plan, listing the strongly connected components (found with Tarjan's algorithm) of the live Blocking_Graph.
- **Genuine_Deadlock**: A state in which the Disassembly_Plan holds a Deadlock_Witness and at least 1 of its strongly connected components has every Part still live.
- **Aligned_Fastener**: A Part with `isFastener` true whose chosen Clear_Axis lies within `DEFAULT_SOLVER_CONFIG.helicalAngularToleranceDeg` of the Part's `principalAxis` (in either direction). The tolerance is the `@unboltkit/core` default of 5 degrees, so the Blitz_Engine and Core classify the same step identically.
- **Level**: One playable assembly: one of the five bundled sample kits or a Custom_Upload.
- **Bundled_Level**: A Level built from `@unboltkit/sample-kits`: Lockbox (`haunted-clockwork-lockbox`), Planetary Gearbox (`planetary-gearbox-3-stage`), 65% Keyboard (`mechanical-keyboard-65`), Dumbbell Cage (`deadlock-cage-dumbbell-ring`), or Ship-in-Bottle (`deadlock-cage-ship-in-bottle`).
- **Custom_Upload**: A `.glb` or `.gltf` file the player drops on the Blitz_App or selects through the file picker.
- **Arena**: The Three.js viewport with the assembly, turntable pedestal, lighting, and OrbitControls.
- **HUD**: The floating arcade interface laid over the Arena.
- **Blocker_Callout**: The HUD banner naming the Parts that block a Blocked_Attempt, in the form "BLOCKED BY: <Display_Name>, <Display_Name>".
- **Recovery_Screen**: A clockwork-themed screen that explains a load failure and offers a one-click return to a Bundled_Level.
- **Completion_Overlay**: The full-screen overlay shown when a Level ends, either "Victory" (all Parts removed) or "Interlock Exposed!" (correct trap flag).
- **Time_Penalty**: 3 seconds added to the displayed Elapsed_Time.
- **Elapsed_Time**: The stopwatch value: running wall-clock play time plus all Time_Penalties.
- **Poly_Budget**: 150,000 triangles, the `polyBudget` value of `SamplingMetadata`. A scene exceeds it when Core reports `polyBudgetExceeded` as true.
- **Over_Budget_Warning**: The `overBudget` field of a Solve_Result. It holds the triangle count and the Poly_Budget when Core reports `polyBudgetExceeded` for a multi-part scene, and is null otherwise.
- **Over_Budget_Notice**: The non-blocking HUD notice that shows an Over_Budget_Warning. It is not a Recovery_Screen.
- **Palette**: obsidian `#0D0F14` canvas, `#161A23` bevelled HUD plates, brass `#D99B38`, amber `#F5B942`, teal `#2DD4BF` (unbolt burst), crimson `#E5484D` (clash spark).

## Requirements

### Requirement 1: Workspace app scaffold

**User Story:** As a developer, I want `apps/unbolt-blitz` scaffolded as an isolated workspace app, so that the game builds and runs independently of Guide Forge.

#### Acceptance Criteria

1. THE Blitz_App SHALL declare the dependencies `@unboltkit/core` at `"*"`, `@unboltkit/sample-kits` at `"*"`, and `three` at `^0.170.0` in `apps/unbolt-blitz/package.json`.
2. THE Blitz_App SHALL declare the devDependencies `@types/three`, `@types/node`, `vitest`, and `fast-check` in `apps/unbolt-blitz/package.json`.
3. THE Blitz_App SHALL configure the Vite dev server port as 5174 in `apps/unbolt-blitz/vite.config.ts`.
4. THE Blitz_App SHALL configure the Vite worker output format as `"es"` in `apps/unbolt-blitz/vite.config.ts`.
5. THE Blitz_App SHALL contain zero import statements that resolve to files under `apps/guide-forge`.
6. THE Blitz_App SHALL contain zero CSS files, theme tokens, or shell components copied from `apps/guide-forge`.
7. THE Blitz_App SHALL leave every file under `packages/` unmodified.
8. WHEN `npm install` runs at the repository root, THE Blitz_App SHALL resolve `@unboltkit/core` and `@unboltkit/sample-kits` to the local workspace packages.

### Requirement 2: Off-main-thread solving

**User Story:** As a player, I want the solver to run off the main thread for every level, so that the interface stays responsive while a level loads.

#### Acceptance Criteria

1. WHEN a Level is selected, THE Blitz_Worker SHALL run `stage0ParseScene`, `stage1Prepare`, `stage2BuildDbg`, `stage3Peel`, and `stage4Compile` in that order.
2. THE Blitz_App SHALL run every BVH build and every Blocking_Graph build inside the Blitz_Worker.
3. WHEN the Blitz_App loads and no Level has been chosen, THE Blitz_App SHALL load the Bundled_Level Lockbox automatically.
4. WHEN the Lockbox Level is solved, THE Blitz_Worker SHALL return Render_Data for 13 Parts.
5. WHEN a Bundled_Level is selected, THE Blitz_Worker SHALL build the assembly from the matching `@unboltkit/sample-kits` builder and solve the assembly in normalized coordinates with a maximum extent of 1.0.
6. WHEN a Custom_Upload is dropped or selected, THE Blitz_App SHALL parse the file with `GLTFLoader` on the main thread and transfer plain geometry buffers (typed arrays and transforms, with no Three.js objects) to the Blitz_Worker.
7. WHEN the Blitz_Worker finishes a solve, THE Blitz_Worker SHALL return a Solve_Result containing the Render_Data, the full set of Blocking_Graph edges, the Disassembly_Plan, the Compiled_Trajectories, and the Over_Budget_Warning.
8. WHEN the Blitz_Worker posts a Solve_Result, THE Blitz_Worker SHALL transfer typed-array buffers instead of copying them.
9. WHILE a solve is in progress, THE HUD SHALL display a loading indicator in the clockwork theme naming the Level being loaded.
10. IF the player selects a new Level while a solve is in progress, THEN THE Blitz_App SHALL discard the earlier solve result and apply only the result of the latest selection.

### Requirement 3: Upload recovery screens

**User Story:** As a player, I want clear recovery screens when a file cannot be played, so that I can get back into the game with one click.

#### Acceptance Criteria

1. IF the Blitz_Worker returns a `MonolithicMeshError` for a Custom_Upload (a mesh that forms 1 connected island), THEN THE Blitz_App SHALL show a Recovery_Screen stating that the file is a single solid piece and cannot be taken apart, whatever the triangle count is, including a count above the Poly_Budget.
2. IF a Custom_Upload is empty, cannot be parsed by `GLTFLoader`, or yields an `EmptyAssemblyError` or `InvalidGeometryError`, THEN THE Blitz_App SHALL show a Recovery_Screen stating that the file holds no playable geometry.
3. IF a Custom_Upload is a multi-part assembly and Core reports `polyBudgetExceeded` as true (more than 150,000 triangles), THEN THE Blitz_Worker SHALL NOT reject the file, SHALL run all five stages on it, and SHALL return a Solve_Result whose Over_Budget_Warning holds the triangle count and the Poly_Budget of 150,000.
4. WHEN a Solve_Result carries an Over_Budget_Warning, THE HUD SHALL show a non-blocking Over_Budget_Notice that names the triangle count and the Poly_Budget of 150,000, and THE Blitz_App SHALL keep the Level playable and show no Recovery_Screen.
5. IF the Blitz_Worker raises an unexpected error during a solve, THEN THE Blitz_App SHALL show a Recovery_Screen that includes the error message.
6. THE Recovery_Screen SHALL offer a one-click control that loads a Bundled_Level.
7. THE Recovery_Screen SHALL offer a control that opens the file picker to try another file.
8. WHEN the player activates the Bundled_Level control on a Recovery_Screen, THE Blitz_App SHALL dismiss the Recovery_Screen and load that Bundled_Level.
9. IF a Custom_Upload has a file extension other than `.glb` or `.gltf`, THEN THE Blitz_App SHALL show a Recovery_Screen naming the accepted extensions.
10. THE Over_Budget_Notice SHALL leave the Arena, the stopwatch, the "Flag Interlock Trap" lever, hover picking, and click picking usable, and SHALL offer a control that dismisses the notice.
11. WHEN a Solve_Result has no Over_Budget_Warning, or the player selects a different Level, THE HUD SHALL show no Over_Budget_Notice for the earlier Level.

### Requirement 4: Rules engine

**User Story:** As a player, I want a precise rules engine, so that every click has a fair and predictable outcome.

#### Acceptance Criteria

1. THE Blitz_Engine SHALL import no DOM, React, or Three.js module.
2. THE Blitz_Engine SHALL accept any removal order that is valid under the Blocking_Graph, not only the order in the Disassembly_Plan.
3. THE Blitz_Engine SHALL track the set of live Parts and the set of Active_Edges.
4. WHEN `attemptUnbolt(partId)` is called with a live Part that has at least 1 Clear_Axis, THE Blitz_Engine SHALL classify the call as a Legal_Unbolt.
5. WHEN a Legal_Unbolt occurs, THE Blitz_Engine SHALL select the Clear_Axis with the smallest Escape_Distance, breaking ties by the lowest `dirIndex`.
6. WHEN a Legal_Unbolt occurs for an Aligned_Fastener, THE Blitz_Engine SHALL return a `TrajectoryStep` with primitive `helical_unscrew`.
7. WHEN a Legal_Unbolt occurs for a Part that is not an Aligned_Fastener, THE Blitz_Engine SHALL return a `TrajectoryStep` with primitive `linear_slide`.
8. WHEN a Legal_Unbolt occurs, THE Blitz_Engine SHALL remove the Part from the live set and drop every Active_Edge whose `to` end is that Part.
9. WHEN a Legal_Unbolt occurs, THE Blitz_Engine SHALL return the `TrajectoryStep` built with the chosen Clear_Axis, so that the `partId`, `primitive`, and `params` describe the exact motion the Arena plays.
10. WHEN `attemptUnbolt(partId)` is called with a Part that is not live or is unknown, THE Blitz_Engine SHALL return a rejection result and leave score, combo, mistakes, and Elapsed_Time unchanged.
11. THE Blitz_Engine SHALL return the same result for the same sequence of calls on the same input (deterministic behavior).
12. THE Blitz_Engine SHALL expose read-only queries for the live Part set, the Active_Edges, the per-Part Clear_Axis list, and the per-Part blocker list so that Part 2 features can read engine state.
13. THE Blitz_Engine SHALL decide whether a step is an Aligned_Fastener with the primitive registry and the `PrimitiveContext` built from `DEFAULT_SOLVER_CONFIG` (`helicalAngularToleranceDeg` of 5 degrees), so that `createDefaultPrimitiveRegistry().select` agrees with the Blitz_Engine for every step.

### Requirement 5: Scoring and combo

**User Story:** As a player, I want a clear score and combo system, so that fast, clean play is rewarded.

#### Acceptance Criteria

1. THE Blitz_Engine SHALL start each Level with score 0, Combo x1, mistakes 0, and false-alarm count 0.
2. WHEN a Legal_Unbolt occurs, THE Blitz_Engine SHALL add 100 multiplied by the Combo value in force before the increment to the score.
3. WHEN a Legal_Unbolt occurs for a Part with `isFastener` true, THE Blitz_Engine SHALL add a flat bonus of 50 points, unaffected by the Combo.
4. WHEN a Legal_Unbolt occurs, THE Blitz_Engine SHALL raise the Combo by 1, up to a maximum of x8.
5. WHILE the Combo is x8, THE Blitz_Engine SHALL keep the Combo at x8 after each further Legal_Unbolt.
6. WHEN a Legal_Unbolt returns a result, THE Blitz_Engine SHALL include the points awarded, the fastener bonus, and the new Combo in that result.

### Requirement 6: Blocked-click reporting

**User Story:** As a player, I want blocked clicks to tell me exactly what is in the way, so that I can learn the assembly and plan my next move.

#### Acceptance Criteria

1. WHEN a Blocked_Attempt occurs, THE Blitz_Engine SHALL reset the Combo to x1.
2. WHEN a Blocked_Attempt occurs, THE Blitz_Engine SHALL increase the mistakes counter by 1.
3. WHEN a Blocked_Attempt occurs, THE Blitz_Engine SHALL add one Time_Penalty to Elapsed_Time.
4. WHEN a Blocked_Attempt occurs, THE Blitz_Engine SHALL select the Candidate_Axis with the fewest Unremoved_Blockers, breaking ties by the lowest `dirIndex`.
5. WHEN a Blocked_Attempt occurs, THE Blitz_Engine SHALL return the Part_IDs of the Unremoved_Blockers on the selected Candidate_Axis, sorted ascending.
6. WHEN a Blocked_Attempt occurs, THE Blitz_Engine SHALL leave the score and the live Part set unchanged.

### Requirement 7: Interlock trap flag

**User Story:** As a player, I want to flag a true interlock, so that I can finish a level that cannot be fully taken apart.

#### Acceptance Criteria

1. WHEN `flagDeadlockTrap()` is called during a Genuine_Deadlock, THE Blitz_Engine SHALL add 1000 points to the score.
2. WHEN `flagDeadlockTrap()` is called during a Genuine_Deadlock, THE Blitz_Engine SHALL mark the Level complete with the outcome "Interlock Exposed!".
3. WHEN `flagDeadlockTrap()` is called during a Genuine_Deadlock, THE Blitz_Engine SHALL return the Deadlock_Witness strongly connected component Part_IDs so that the Arena can highlight the interlocked Parts.
4. IF `flagDeadlockTrap()` is called when no Genuine_Deadlock exists, THEN THE Blitz_Engine SHALL record a False_Alarm.
5. WHEN a False_Alarm is recorded, THE Blitz_Engine SHALL reset the Combo to x1.
6. WHEN a False_Alarm is recorded, THE Blitz_Engine SHALL subtract 250 points from the score and floor the score at 0.
7. WHEN a False_Alarm is recorded, THE Blitz_Engine SHALL add one Time_Penalty to Elapsed_Time.
8. WHEN a False_Alarm is recorded, THE Blitz_Engine SHALL increase the false-alarm counter by 1 and leave the mistakes counter unchanged.
9. WHEN a False_Alarm is recorded, THE Blitz_Engine SHALL leave the Level in play with the live Part set unchanged.
10. IF every live Part is blocked and `flagDeadlockTrap()` has not been called, THEN THE Blitz_Engine SHALL leave the Level in play and emit no completion event.
11. WHEN the last live Part is removed through a Legal_Unbolt, THE Blitz_Engine SHALL mark the Level complete with the outcome "Victory".
12. WHEN the Level is complete, THE Blitz_Engine SHALL reject further `attemptUnbolt` and `flagDeadlockTrap` calls without changing state.

### Requirement 8: Reducer and Part 2 extension point

**User Story:** As a developer, I want the game state held in a pure reducer, so that Part 2 features can plug in without rewriting the game.

#### Acceptance Criteria

1. THE Blitz_Reducer SHALL be a pure function of the previous state and an action, with no DOM, Three.js, or timer access.
2. THE Blitz_Reducer SHALL hold the loaded Level, the Blitz_Engine state, Elapsed_Time inputs, score, Combo, mistakes, false-alarm count, removed-Part count, total-Part count, and the Level outcome.
3. WHEN the Blitz_Reducer applies an action, THE Blitz_Reducer SHALL append the resulting Game_Events to an ordered event list in the returned state.
4. THE Blitz_Reducer SHALL define Game_Events as plain serializable data with a `kind` discriminant.
5. THE Blitz_App SHALL provide a registration point through which a module subscribes to Game_Events without editing the Blitz_Reducer or the Blitz_Engine.
6. THE Blitz_App SHALL omit Ghost Extraction Hints, Web Audio synthesis, campaign star ratings, and localStorage high scores in Part 1.
7. WHEN the player selects a new Level, THE Blitz_Reducer SHALL reset the Blitz_Engine state, the stopwatch, and all counters for that Level.

### Requirement 9: Clockwork arena

**User Story:** As a player, I want a moody, tactile 3D arena, so that the game feels like a clockwork arcade machine.

#### Acceptance Criteria

1. THE Arena SHALL render with `ACESFilmicToneMapping`.
2. THE Arena SHALL light the assembly with a warm brass key light and a cool teal rim light.
3. THE Arena SHALL generate its environment map from `RoomEnvironment` through a PMREM generator.
4. THE Arena SHALL place the assembly on a dark metallic turntable pedestal.
5. THE Arena SHALL fill the canvas background with obsidian `#0D0F14`.
6. THE Arena SHALL provide OrbitControls with damping enabled.
7. WHEN Render_Data arrives, THE Arena SHALL build one mesh per Part from the normalized positions, normals, indices, and material descriptors.
8. WHEN Render_Data arrives, THE Arena SHALL frame the camera so that the whole assembly is visible.
9. WHEN the Arena is disposed, THE Arena SHALL release all geometries, materials, textures, and the PMREM render target.
10. IF the browser cannot create a WebGL context, THEN THE Blitz_App SHALL show a clockwork-themed message explaining that WebGL is required.

### Requirement 10: Hover and click picking

**User Story:** As a player, I want hover and click feedback on parts, so that I can see what I am about to pick.

#### Acceptance Criteria

1. WHEN the pointer is over an unremoved Part, THE Arena SHALL apply a brass glow to that Part.
2. WHEN the pointer is over an unremoved Part, THE HUD SHALL show a name pill with the Display_Name of that Part near the pointer.
3. WHEN the pointer leaves a Part or the Part is removed, THE Arena SHALL remove the brass glow and THE HUD SHALL hide the name pill.
4. WHEN the player clicks an unremoved Part, THE Arena SHALL resolve the clicked Part by a raycast against the Part meshes and pass the Part_ID to the Blitz_Engine.
5. WHEN the player drags to orbit the camera, THE Arena SHALL leave the Blitz_Engine unchanged and register no click on any Part.
6. THE Arena SHALL perform picking with the Three.js `Raycaster` without building a BVH on the main thread.
7. WHEN a Part has been removed, THE Arena SHALL exclude that Part from hover and click picking.

### Requirement 11: Exit animations

**User Story:** As a player, I want satisfying exit animations for legal unbolts, so that each success feels rewarding.

#### Acceptance Criteria

1. WHEN a Legal_Unbolt occurs, THE Arena SHALL animate the Part along the returned `TrajectoryStep` using `createDefaultPrimitiveRegistry().get(primitive).value.pose(t, params)` for `t` from 0 to 1.
2. WHEN the primitive is `helical_unscrew`, THE Arena SHALL show the Part spinning out along its axis.
3. WHEN the exit animation reaches `t` equal to 1, THE Arena SHALL remove the Part mesh from the scene and release its resources.
4. WHEN a Legal_Unbolt occurs, THE Arena SHALL show a teal unbolt burst at the Part position.
5. WHEN a Legal_Unbolt occurs, THE HUD SHALL show a floating score popup with the awarded points.
6. WHEN the player clicks while earlier exit animations are still running, THE Blitz_App SHALL process the click immediately with no input lock.
7. WHILE several exit animations run at once, THE Arena SHALL advance each animation independently from its own start time.
8. WHEN the Blitz_Engine removes a Part at click time, THE Blitz_Engine SHALL treat the Part as removed before its exit animation finishes.
9. WHERE the operating system reports a reduced-motion preference, THE Arena SHALL shorten the exit animation and replace the burst with a single-frame flash.

### Requirement 12: Blocked-click feedback

**User Story:** As a player, I want blocked clicks to show a loud, readable warning, so that I understand the mistake without sound.

#### Acceptance Criteria

1. WHEN a Blocked_Attempt occurs, THE Arena SHALL play a crimson shudder on the clicked Part.
2. WHEN a Blocked_Attempt occurs, THE Arena SHALL emit a crimson clash spark at the clicked Part.
3. WHEN a Blocked_Attempt occurs, THE Arena SHALL flash each reported blocking Part with an amber-to-crimson highlight.
4. WHEN a Blocked_Attempt occurs, THE HUD SHALL show a Blocker_Callout naming every reported blocking Part by Display_Name.
5. WHEN a Blocked_Attempt occurs, THE HUD SHALL show a floating "+3s" Time_Penalty popup.
6. WHEN a Blocked_Attempt occurs, THE HUD SHALL flash the combo badge crimson and show the Combo reset to x1.
7. WHEN the Blocker_Callout has been visible for 3 seconds, THE HUD SHALL hide the Blocker_Callout.
8. WHEN a new Blocked_Attempt occurs while a Blocker_Callout is visible, THE HUD SHALL replace the Blocker_Callout text and restart the 3-second display time.
9. WHEN a Blocked_Attempt occurs, THE HUD SHALL post the Blocker_Callout text to an `aria-live` region.

### Requirement 13: Arcade HUD

**User Story:** As a player, I want an arcade HUD that shows my status at a glance, so that I can stay focused on the puzzle.

#### Acceptance Criteria

1. THE HUD SHALL show a level selector listing Lockbox, Planetary Gearbox, 65% Keyboard, Dumbbell Cage, Ship-in-Bottle, and Custom .glb drop/upload.
2. THE HUD SHALL show a live stopwatch that displays Elapsed_Time in minutes, seconds, and tenths with tabular-numeric digits.
3. THE HUD SHALL show the score and a combo badge with the Combo value in tabular-numeric digits.
4. THE HUD SHALL show a Removed / Total progress bar with the numeric counts.
5. THE HUD SHALL show the mistakes count and a separate false-alarm count.
6. THE HUD SHALL show a "Flag Interlock Trap" lever button.
7. WHILE a Level is in play, THE Blitz_App SHALL update the stopwatch at least every 100 milliseconds.
8. WHEN a Time_Penalty is applied, THE HUD SHALL add 3 seconds to the displayed Elapsed_Time on the next render.
9. WHEN the Level is complete, THE Blitz_App SHALL stop the stopwatch.
10. WHEN the Level is loaded and the Arena shows the assembly, THE Blitz_App SHALL start the stopwatch.
11. WHEN the player activates the Custom .glb drop/upload entry, THE HUD SHALL open the file picker.
12. WHEN the player drops a file on the Blitz_App window, THE Blitz_App SHALL treat the file as a Custom_Upload.
13. WHEN the player selects a Level in the level selector, THE Blitz_App SHALL load that Level and reset the HUD counters.

### Requirement 14: Trap lever and completion

**User Story:** As a player, I want the trap lever and completion screens to be unmistakable, so that I know how a level ended.

#### Acceptance Criteria

1. WHEN the player activates the "Flag Interlock Trap" lever, THE Blitz_App SHALL call `flagDeadlockTrap()` on the Blitz_Engine.
2. WHEN a Genuine_Deadlock flag succeeds, THE HUD SHALL show the Completion_Overlay titled "Interlock Exposed!" with the final score, Elapsed_Time, mistakes count, and false-alarm count.
3. WHEN a Genuine_Deadlock flag succeeds, THE Arena SHALL highlight every Part of the Deadlock_Witness strongly connected components.
4. WHEN a False_Alarm is recorded, THE HUD SHALL show a "FALSE ALARM -250" popup, a "+3s" popup, and the incremented false-alarm count.
5. WHEN the last Part is removed, THE HUD SHALL show the Completion_Overlay titled "Victory" with the final score, Elapsed_Time, mistakes count, and false-alarm count.
6. THE Completion_Overlay SHALL offer a control that replays the same Level and a control that opens the level selector.
7. WHEN the player activates the replay control, THE Blitz_App SHALL reload the same Level with fresh engine state and counters.
8. WHILE every remaining Part is blocked and no flag has been raised, THE HUD SHALL show the same controls and indicators as during normal play.

### Requirement 15: Visual identity

**User Story:** As a player, I want a distinct clockwork arcade look, so that Unbolt Blitz feels like a different product from Guide Forge.

#### Acceptance Criteria

1. THE Blitz_App SHALL draw HUD panels as bevelled plates filled with `#161A23`.
2. THE Blitz_App SHALL use brass `#D99B38` and amber `#F5B942` for interactive accents, teal `#2DD4BF` for unbolt bursts, and crimson `#E5484D` for clash sparks and errors.
3. THE Blitz_App SHALL use a display typeface for titles and a tabular-numeric typeface setting for stopwatch, score, combo, and progress numbers.
4. THE Blitz_App SHALL define the Palette as CSS custom properties in a theme file inside `apps/unbolt-blitz`.
5. THE Blitz_App SHALL use text and background combinations with a contrast ratio of at least 4.5:1 for HUD text.
6. THE Blitz_App SHALL use a floating-HUD interaction loop (hover, click, popup) and use no panel layout, manifest list, or step timeline from Guide Forge.

### Requirement 16: Mute-complete cues

**User Story:** As a player who plays with sound off, I want every cue shown as a visual or text signal, so that I miss nothing.

#### Acceptance Criteria

1. WHEN a Legal_Unbolt occurs, THE Blitz_App SHALL show a teal burst and a points popup.
2. WHEN the Combo changes, THE HUD SHALL show the new Combo value in the combo badge with a pulse.
3. WHEN a Blocked_Attempt occurs, THE Blitz_App SHALL show the crimson spark, the Blocker_Callout, and the "+3s" popup.
4. WHEN a False_Alarm is recorded, THE Blitz_App SHALL show the "FALSE ALARM -250" popup and the "+3s" popup.
5. WHEN the Level is complete, THE Blitz_App SHALL show the Completion_Overlay.
6. THE Blitz_App SHALL post each Legal_Unbolt, Blocked_Attempt, False_Alarm, and completion message to an `aria-live` region as text.
7. THE Blitz_App SHALL play no audio in Part 1.

### Requirement 17: Deterministic tests

**User Story:** As a developer, I want the engine and worker covered by deterministic tests, so that the rules and the solver wiring are proven by real geometry and graph properties.

#### Acceptance Criteria

1. THE Blitz_App test suite SHALL include a test that removes the Parts of a solved Level in at least 2 different valid orders and confirms that each order ends with every Part removed.
2. THE Blitz_App test suite SHALL include a test that, for a Blocked_Attempt, compares the returned blocker Part_IDs to the Unremoved_Blockers computed directly from the Blocking_Graph edges of the fewest-blocker Candidate_Axis.
3. THE Blitz_App test suite SHALL include a test that confirms the scoring rules: 100 multiplied by Combo, the flat 50 fastener bonus, the x8 Combo cap, the Combo reset, the mistakes count, and the Time_Penalty.
4. THE Blitz_App test suite SHALL include a test that confirms `flagDeadlockTrap()` awards 1000 points and completes the Level with "Interlock Exposed!" on a deadlocked Level, and records a False_Alarm (Combo x1, minus 250 floored at 0, Time_Penalty, false-alarm count) on a solvable Level.
5. THE Blitz_App test suite SHALL include a test that confirms a Level whose live Parts are all blocked stays in play until `flagDeadlockTrap()` is called.
6. THE Blitz_App test suite SHALL run `runBlitzSolve` (the Blitz_Worker's pure solve function, callable without a Worker) on the real Lockbox Level and on the real Dumbbell Cage Level.
7. WHEN the Lockbox solve test runs, THE test SHALL confirm 13 Parts, a `solved` Disassembly_Plan, and that every `TrajectoryStep` names a Part in the Render_Data.
8. WHEN the Dumbbell Cage solve test runs, THE test SHALL confirm a `deadlocked` Disassembly_Plan with a Deadlock_Witness holding at least 1 strongly connected component of 2 or more Parts.
9. THE Blitz_App test suite SHALL confirm that applying the Lockbox Disassembly_Plan step order to the Blitz_Engine yields a Legal_Unbolt for every step.
10. THE Blitz_App test suite SHALL draw all random inputs from a seeded pseudo-random number generator and use no unseeded `Math.random()`.
11. THE Blitz_App test suite SHALL assert real geometric or graph properties (valid dependency order, blocker sets matching graph edges) and contain no trivial assertions.
12. THE Blitz_App test suite SHALL compute every expected value from the geometry and the algorithm and hard-code no Part_ID, bounding box, or step order to satisfy a fixture.
13. THE Blitz_App test suite SHALL include a test that a multi-part scene above the Poly_Budget solves with an Over_Budget_Warning holding its triangle count, that a multi-part scene at or below the Poly_Budget carries no warning, and that a single-island scene above the Poly_Budget is rejected as monolithic.

### Requirement 18: Repository checks

**User Story:** As a maintainer, I want the repository checks to pass, so that Part 1 can be merged with confidence.

#### Acceptance Criteria

1. WHEN `npm install` runs at the repository root, THE repository SHALL complete the install with exit status 0 and workspace links for `apps/unbolt-blitz`.
2. WHEN `npx tsc --noEmit` runs in `apps/unbolt-blitz`, THE Blitz_App SHALL report 0 type errors.
3. WHEN `npm run test` runs in `apps/unbolt-blitz`, THE Blitz_App SHALL report 0 failing tests.
4. WHEN `npm run build` runs in `apps/unbolt-blitz`, THE Blitz_App SHALL produce a production bundle including the Blitz_Worker chunk with exit status 0.
5. THE Blitz_App SHALL keep `@unboltkit/core` free of DOM, WebGL, and `window` dependencies and add no new runtime dependency to `packages/unbolt-core` (only `three` and `three-mesh-bvh`).
6. THE Blitz_App development workflow SHALL run shell commands one at a time and start no development server.
