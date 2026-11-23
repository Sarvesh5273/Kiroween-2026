# Bugfix Requirements: false "Verified" for a straight slide through an unremoved Part

## Introduction

UnboltKit can commit a straight `linear_slide` step that passes through a Part still in the Assembly, and Guide Forge then labels the plan "Verified". The crossed-bars probe (`demo-video/research/probes/crossed-bars.ts`) reproduces this with three axis-aligned boxes at the default Solver_Config. The solver slides `Y_bar` along +X through `Z_bar`, the Clash_Checker counts 0 clashes, and Guide Forge shows "0 Clashes • Verified".

**Scope.** Only finite `linear_slide` moves are verified: a unit `dir` and a finite `distance` ≥ 0, in normalized coordinates (`maxExtent = 1.0`). `helical_unscrew` and `two_step_l_slide` steps stay usable, but they are Unverified until their real trajectories can be checked.

**Constraints on the fix.**
- Valid teardowns keep solving.
- The independent verification stays separate from the solver, in code and in method.
- No exception keyed on a fixture, a Part name or a Part_ID.
- A step whose clearance the evidence cannot establish is Unverified, never "Verified".

**Status.**
- The diagnosis was approved, and two rounds of review decisions are recorded below.
- Slice 1 is implemented: the independent verifier (`packages/unbolt-core/src/oracle/moveVerifier.ts`) and its regression tests.
- Slice 2 is implemented: the step verifier receives the exact distance, bounds its rays to it, and sweeps feature edges (`packages/unbolt-core/src/stage3/stepVerifier.ts`). The crossed-bars probe exits 0. Guide Forge and Unbolt Blitz are unchanged.
- The design is in `design.md`, and the remaining slices and release follow-ups are in `tasks.md`.

## Review decisions

### Round 1

1. **Contact.** Touching, sliding along a face, and moving away from initial contact are allowed when there is no interior penetration. `clearanceEpsilon` (ε, default 5e-5 normalized) is a numerical tolerance only, and the quantities it is compared against are defined under Definitions below. When the method cannot tell contact from penetration, the verdict is Unverified.
2. **Scope.** Only finite `linear_slide` moves are verified. Helical and L-slide steps remain usable and are Unverified. An unsupported step is not evidence of a blocker or a deadlock.
3. **Verdicts.** A move has one of three verdicts: Clear, Blocked or Unverified. For a complete plan, a confirmed collision takes priority. Otherwise any unchecked step makes the plan Unverified. "Verified" is shown only when every step is proven Clear. The studio and the exported manual show the same verdict.
4. **Legacy diagnostics.** `checkClashes` and the naive baseline stay as ray-hit diagnostics with unchanged counts. A legacy ray hit is not a finite-path collision. In the two-cube control the current checker returns 40 hits, and the finite verdict must be Clear.
5. **Verifier input.** The verifier receives the exact normalized direction, distance and still-present Parts, and checks the motion that is actually played. Unbolt Blitz floors its exit travel (`EXIT_TRAVEL_FLOOR` = 0.12 normalized in `game/scoring.ts`, applied in `game/blitzEngine.ts` `attemptUnbolt`), so a verdict computed for a shorter move is never reused for the longer move it plays. The solver's own check and the independent verification stay separate.

### Round 2

6. **Solid validity and the start state.** Take a closed cube of side 0.5 centred inside a solid cube of side 4, with either cube moving a short distance along +X. Repeat with the outer cube's winding reversed. None of these four cases may return Clear; the round-1 prototype returned Clear for three of them. When valid solid orientation or initial separation cannot be established, the verdict is Unverified.
7. **Contact plane.** A positive overlap of at most ε is not proof of separation. Two unit cubes centred at y = 0 and y = 0.99995, sliding parallel to the shared face, must never return Clear. Genuine face contact, lift-off, a real gap and the original crossed-bars tests are preserved.
8. **Pins.** The direct linear tests for the wide-hole pin and the exact-fit pin stay. The default compiler selects `helical_unscrew` for both pins, so their compiled trajectories are Unverified. Primitive selection is not changed to make a test pass.
9. **Trajectory present set.** Verification starts from all Assembly Parts and removes a Part only after its own step. A targeted guide that ends when a ring comes off is still checked against the shaft, even though the shaft has no step. Unknown or duplicate step Part_IDs are rejected.
10. **This slice.** Legacy ray counts stay diagnostic, and the existing solver tests are not weakened. Two release follow-ups are recorded in `tasks.md`: Blitz must check the exact move it plays against its live Parts before calling a showcased move legal, and Guide Forge, its export and the README must describe only what is verified.

## Reproduction

From the repository root, one command at a time:

```
node_modules/.bin/esbuild --bundle --platform=node --format=esm --log-level=error < demo-video/research/probes/crossed-bars.ts > /tmp/unbolt-crossed-bars.mjs
node /tmp/unbolt-crossed-bars.mjs
```

Observed on `main` at `5137dad`, Node v25.4.0, default config (`microShrink` 1e-4, `clearanceEpsilon` 5e-5, `tau` 0.05, 48 samples):

| Item | Observed |
|---|---|
| Plan status | `solved` |
| Selected Part, step 1 | `/0#0`, which is `Y_bar` (0.2 × 12 × 0.2, centred at x = 0) |
| Direction, step 1 | `[1, 0, 0]` (+X), `dirIndex` 0 |
| Distance, step 1 | `escapeDistance` 0.07500000018626451 normalized (1.2 world). The compiled `linear_slide` has the same distance. |
| Checker hits (`oracleTotalHits`, all 3 steps) | 0 |
| First sampled pose where the meshes intersect | step 1, `/0#0` against `/1#0` (`Z_bar`), t = 0.75, world travel 0.9 |
| Later sampled poses that intersect | t = 5/6 (travel 1.0) and t = 1 (travel 1.2, where the faces touch at the end pose) |
| Exit | nonzero, with `Error: A compiled path goes through an unremoved part.` |

Normalization: maxExtent 16 (set by `back_plate`), scale 0.0625, translation `[0.075, 0, 0]`. Part_IDs: `/0#0` Y_bar, `/1#0` Z_bar, `/2#0` back_plate. Plan order: `/0#0` +X, then `/1#0` +X (escape 0), then `/2#0` +X (escape 0).

## What the runs prove

The findings below come from the probe plus two read-only scripts kept outside the repository: `/tmp/unbolt-crossed-bars-diag.ts` and `/tmp/unbolt-crossed-bars-gf.ts`. Coordinates are in world units unless marked otherwise.

1. **The move interpenetrates.** At rest the two bars already overlap in y and z: Y_bar spans z ∈ [−0.1, 0.1], and Z_bar spans y ∈ [−0.1, 0.1] and z ∈ [−4.5, 4.5]. Along x, Y_bar's span [−0.1, 0.1] meets Z_bar's span [0.9, 1.1] for travel s ∈ (0.8, 1.2), which is t ∈ (2/3, 1). At s = 1.0 the overlap is the full 0.2 × 0.2 × 0.2 crossing cube. A sweep of 1,201 poses with three-mesh-bvh `intersectsGeometry` agrees: the first intersecting pose is at s = 0.800000002 and the last at s = 1.2, where the faces touch.
2. **Stage 2 recorded no blocking edge for this move.** `stage2BuildDbg` has no edge (`/0#0`, `/1#0`, dirIndex 0). `ObbPruner.isPruned` returns false for that triple, so rays were cast. None of Y_bar's 48 samples has a y value inside Z_bar's y range, and none of Z_bar's 48 samples has a z value inside Y_bar's z range. Edges `/0#0 → /1#0` do exist for dirIndex 6, 7, 10, 11, 18 to 21, 28 and 30, but not for dirIndex 0.
3. **The step verifier checked the pair and found nothing.** For step 1, the coarse swept-AABB test kept Z_bar and culled back_plate, which lies behind Y_bar. The verifier cast 40 rays (20 sources per bar) and returned 0 edges. These per-step numbers are inferred from the verifier's counters, which read 3 verifications, 2 pairs, 80 rays and 0 edges after the peel plus one identical direct call. Step 2 culled its only pair.
4. **The Clash_Checker returns 0.** `checkClashes(/0#0, +X, [/1#0, /2#0])` and `checkClashes(/0#0, +X, [/1#0])` both return `count` 0.
5. **No ray source of either bar can reach the other bar.** Each box has 20 sources: 8 welded vertices and 12 triangle centroids. Y_bar's sources sit at y ∈ {−6, −2, 2, 6}, but Z_bar spans only y ∈ [−0.1, 0.1]. Z_bar's sources sit at z ∈ {−4.5, −1.5, 1.5, 4.5}, but Y_bar spans only z ∈ [−0.1, 0.1]. A ray along ±X keeps its y and z, so none of the 40 rays can hit the other bar, however long the ray is.
6. **Guide Forge reports "Verified".** On this plan, `runOracle` with core `checkClashes` returns per-step counts `[0, 0, 0]` and `totalClashes` 0. `selectClashBadge(result, "dbg")` returns `{ icon: "check", text: "0 Clashes • Verified" }`, and `selectComparison(result).dbg` returns `verified: true` with the text "0 clashes (Verified)". `selectCalloutModel` and the manual exporter were not executed. Reading their code shows they derive "Verified" from the same `totalClashes === 0`.
7. **The solver repeats the defect on the control scene.** With Z_bar moved to x = 1.416 (the near-miss scene in `design.md`), the solver again commits `/0#0` along +X. The distance is now 1.616, because the AABB-union escape distance grows with Z_bar. By the same box arithmetic as finding 1, that move passes through Z_bar for s ∈ (1.216, 1.616). For this reason the control is defined as a direct check with an explicit distance, not as a solver run.

## Code trace

### Where the solver accepts the move (`packages/unbolt-core/src`)

- **Stage 2 records no edge.** `stage2/dbgBuilder.ts` `stage2BuildDbg` calls `castRaySet`. The samples come from `stage2/sampler.ts` `buildSampleSet` (48 stratified, area-weighted points per Part), and hits are classified by `stage2/hitFilter.ts` `filterNearest`. No edge is found for (`/0#0`, `/1#0`, 0), so Y_bar's `blockers[0]` starts at 0.
- **Stage 3 picks the move.** In `stage3/peelSolver.ts` `runPeel`, Y_bar is removable along axis 0.
  - `stage3/escapeDistance.ts` `escapeDistance` gives +X an escape distance of 1.2: the union's max x of 1.1 minus Y_bar's min x of −0.1. This is the smallest among Y_bar's unblocked axes, and `chooseDirection` (peelSolver.ts:246) picks it.
  - `selectByCascade` (`stage3/tieBreak.ts`, called at peelSolver.ts:271) then picks Y_bar. Y_bar is a Fastener with slenderness 42.43, ahead of Z_bar at 31.82.
- **The step verifier finds nothing, so the step is committed.** `stage3/stepVerifier.ts` `createStepVerifier(...).verify` is wired in at peelSolver.ts:368 and called at :277.
  - `sweptAabbOverlaps` keeps Z_bar (stepVerifier.ts:295).
  - `castSources` casts rays from the `buildSourceSet` vertices and centroids, along +X from Y_bar and along −X from Z_bar (:301 and :302). It returns `[]`.
  - Because `found.length > 0` (peelSolver.ts:283) is false, `steps.push` (:297) commits the step. **This is where the move is accepted.**
- **Stage 4 compiles it unchecked.** `stage4/trajectoryCompiler.ts` `stage4Compile` calls `primitives/linearSlide.ts` `buildParams`, which sets `distance = step.escapeDistance`. Stage 4 runs no geometry check.

### What the Clash_Checker measures (`oracle/clashChecker.ts`)

`checkClashes` works through `buildPartData` and `nearestSurvivor`:

- It casts one ray from each welded vertex and each positive-area triangle centroid of the moving Part along `dir`, against the static Parts. It also casts one ray from each such source of each static Part along `−dir`, against the moving Part. Every origin is moved `microShrink` inside its surface.
- Rays have no maximum length (`raycast(..., 0, Number.POSITIVE_INFINITY)` at :254). The function takes no travel distance and no trajectory.
- `count` is the number of rays whose nearest hit is an opposing face, after the `clearanceEpsilon` and `tau` filters remove coincident and grazing hits.

So the checker measures whether the straight-line paths of a fixed set of points reach an opposing face. It does not test the swept volume, contact away from those points, or the travel that was compiled. Its point set is the one Req 14.11 prescribes for the step verifier: the same vertices, the same centroids, the same micro-shrink and the same filter rules. Only the code is written separately.

### Where Guide Forge turns zero hits into "Verified" (`apps/guide-forge/src`)

- `worker/solvePipeline.ts` `runSolve` calls `runOracle(plan.steps, stage1.parts, stage1.config, check)` (:143) once `stage4Compile` returns ok.
- `worker/oracle.ts` `runOracle` and `buildOracleJobs` call `checkClashes` once per step, with `step.dir` and the Parts of later steps, and sum the results with `totalClashes += result.count` (:64). Only counts are kept. `OracleReport` in `protocol.ts` has no field for "clearance could not be established".
- `state/selectors.ts`:
  - `selectClashBadge` maps `oracle.totalClashes === 0` to "0 Clashes • Verified" (:44).
  - `selectComparison` sets `verified = dbgClashes === 0` (:470) and shows "0 clashes (Verified)".
- `panels/StatusCallout.tsx` `selectCalloutModel` falls through to `label: "Verified"` with the detail "0 clashes across 3 steps (independent clash check)" (:78).
- `export/manualExporter.ts` copies `selectClashBadge(result, "dbg").text` into `proofBadge` (:150, :169). The exported manual renders it as the "Independent Oracle Proof" badge.

Each of these treats zero colliding rays as proof that the path is clear.

## Root-cause hypotheses

None of these hypotheses is proven in general.

- **H1. Point-ray tests miss contact that begins edge against edge.** When two polyhedra translate into each other, first contact is vertex against face, face against vertex, or edge against edge. Rays from vertices cover only the first two cases. Rays from a few face points (centroids or random samples) add only the points that happen to lie in the contact patch. Here the contact patch is the 0.2 × 0.2 square where the bars cross. The bars' long edges bound it, and it holds no vertex, centroid or sample of either Part. Finding 5 proves this for this scene. The general claim is reasoning, and the extent to which other shapes fail this way has not been measured.
- **H2. The "independent" oracle is independent in code but not in method.**
  - `test/static/clash-independence.test.ts` checks imports only.
  - `test/properties/p23-clash-checker-reference.property.test.ts` compares the checker with a brute-force reference of the same ray method (`test/helpers/reference/clash.ts`).
  - Neither test can catch a blind spot of the method itself. The step verifier and the checker use the same point set by specification (Req 14.11 and Req 20.2 to 20.6), so they fail together.
- **H3. The test suite defines "clash-free" as "the checker returns 0".** Invariant 1 calls `findFirstStepClash` (`test/helpers/stagedSolve.ts`:65), which uses `checkClashes`, and Req 21.6 says the same. No existing test compares plan steps with actual interpenetration, so a blind spot shared by the solver and the checker passes every gate.
- **H4 (secondary). The oracle checks only `step.dir` and ignores the compiled travel.** For solver-produced steps this changes nothing in exact arithmetic, because each step ends where its AABB clears the union of the other AABBs. It does matter for a direct check with an explicit distance, such as the control. It also means the oracle does not check the motion that Guide Forge animates.

**Measured since (`tasks.md` 1.6):** no committed straight move of the three showcase kits is Blocked by the independent verifier at defaults; see `design.md`, "Showcase kit measurement".

## Bug Analysis

### Definitions

- **Move** M = (A, d, D, S): a moving Part A, a unit direction d, a distance D ≥ 0 and the set S of Parts still present. All values are in normalized coordinates.
- **Present Parts of a trajectory step:** every Assembly Part, minus A, minus the Parts whose own step came earlier. A Part with no step stays present to the end.
- **Pose** A(s): A translated by s·d, for s ∈ [0, D].
- **Played move:** the move that the consumer animates. In Guide Forge this is the compiled `linear_slide` (`params.dir`, `params.distance`). In Unbolt Blitz it is `result.step.params`, whose distance is `max(escape, EXIT_TRAVEL_FLOOR)`.
- **Closed Part:** among the triangles whose three corners lie in three distinct weld clusters, every directed welded edge appears exactly once and so does its reverse.
- **Outward-wound Part:** a closed Part in which every connected shell encloses positive signed volume. Interior and winding number are defined only for closed, outward-wound Parts.
- **Interior penetration:** for some s ∈ [0, D] and some B ∈ S, the interiors of A(s) and B intersect.

**What each quantity is compared against.** For one pair (A, B), with ε = `clearanceEpsilon`:

| Quantity | Exact definition | Evidence when |
|---|---|---|
| Q1, swept-box gap | g = maxⱼ max(B.minⱼ − (A.maxⱼ + max(0, D·dⱼ)), (A.minⱼ + min(0, D·dⱼ)) − B.maxⱼ), using Stage 1 AABBs | g > ε gives Clear |
| Q2, separation distance | δ(s) = the smallest Euclidean distance between the surfaces of A(s) and B | Clear when δ(s) ≥ ε for every s in an interval, proved by a bound that holds on the whole interval (not by samples), and the start is shown interior-disjoint (the start condition below) |
| Q3, plane overlap | for a unit vector m and an interval I ⊆ [0, D]: ov(m) = max over s ∈ I and x ∈ A(s) of m·x, minus the minimum over y ∈ B of m·y (or the mirrored form, with A on the high side) | Clear on I when ov(m) ≤ η. η is the float64 rounding bound of this computation, 2⁻⁴⁶·(L_A + L_B + D + 1), where L is the largest \|x\| + \|y\| + \|z\| over a Part's vertices; about 1e-14 for normalized assemblies. ε plays no part in Q3. |
| Q4, witness depth | a travel s and a point w with winding number within 0.25 of 1 for both A(s) and B, distance(w, boundary of A(s)) > ε and distance(w, boundary of B) > ε | gives Blocked |

**Start condition.** At s = 0, take one vertex of every shell of A and test it against B, then one vertex of every shell of B and test it against A. The start is interior-disjoint when every such vertex has a winding number within 0.25 of 0. A vertex within 0.25 of 1 means one Part is nested in the other; any other value is ambiguous. The test is used only when δ(0) > 2ε.

**Verdict for the pair (A, B):**
- **Unverified (`open_mesh` or `invalid_orientation`)** when A or B is not closed or not outward-wound. This check runs before every other one.
- **Blocked** when Q4 holds.
- **Clear** when Q1 holds, or Q2 holds on [0, D], or Q2 holds on [0, s_c] and Q3 holds on [s_c, D].
- **Unverified** otherwise: `nested_at_start`, `initial_separation_unknown`, `iteration_cap` or `contact_unresolved`.

Clear and Blocked cannot both hold. Q1 and Q2 rule out any overlap, and Q3 rules out overlap beyond rounding, which cannot hold a ball of radius greater than ε.

Contact cases follow from these definitions:
- Genuine face contact while sliding gives ov = 0 along the face normal.
- Lift-off from face contact gives ov = 0 along the contact normal.
- Touching at the end pose gives ov = 0 along the face normal.
- A real overlap of 5e-5 world gives ov ≈ 2.5e-5 normalized, which is greater than η, so the move is not Clear.

**Step verdict over S:** Blocked if any B ∈ S is Blocked; otherwise Unverified if any is Unverified; otherwise Clear. A step whose primitive is not `linear_slide` is Unverified with the reason `unsupported_primitive`.

**Plan verdict:** Blocked if any step is Blocked; otherwise Unverified if any step is Unverified; otherwise Clear.

**Labels:** Clear is shown as "Verified", Blocked as "Blocked" and Unverified as "Unverified".

### Current Behavior (Defect)

1.1 WHEN the crossed-bars scene is solved at the default Solver_Config THEN the Peel_Solver commits step 1 as `/0#0` along +X (dirIndex 0) for 0.07500000018626451 normalized, and the step verifier reports no Blocking_Edge against `/1#0`, although that move interpenetrates `/1#0` for s ∈ (0.8, 1.2) world.

1.2 WHEN `checkClashes` evaluates that move against `/1#0` THEN it returns `count` 0, because none of the 20 sources of either bar lies where the bars cross.

1.3 WHEN Guide Forge receives the resulting Oracle_Report (`totalClashes` 0) THEN it shows "0 Clashes • Verified" in the Clash_Badge, "0 clashes (Verified)" in the comparison card and "Verified" in the status callout, and the exported manual carries the same text as its "Independent Oracle Proof".

1.4 WHEN a check casts no colliding ray THEN the system reads that as proof of clearance. No outcome exists for "clearance could not be established".

1.5 WHEN Guide Forge verifies a step THEN it checks only `step.dir` and not the compiled `linear_slide` distance, against the Parts of later steps only. The check therefore does not cover the motion it animates or Parts that have no step.

1.6 WHEN the same scene is solved with Z_bar at x = 1.416 THEN the Peel_Solver commits `/0#0` along +X for 1.616 world, which interpenetrates `/1#0` for s ∈ (1.216, 1.616).

1.7 WHEN a check is asked about a move with a finite distance THEN it ignores the distance. For two unit cubes centred at x = 0 and x = 3, with the first moved +X by 1 world (end gap 1), `checkClashes` returns 40 hits, and the current step verifier reports a Blocking_Edge against the second cube (measured).

1.8 WHEN a step's primitive is `helical_unscrew` or `two_step_l_slide` THEN the oracle checks only a straight translation along `step.dir`, which is not the motion played, and can still report "Verified".

### Expected Behavior (Correct)

2.1 WHEN the Peel_Solver has selected a move THEN it SHALL send the step verifier the exact request (A, d, D, S): D is the `escapeDistance` that Stage 4 compiles into `linear_slide.distance`, and S is the set of unremoved Parts. The verifier SHALL report a Blocking_Edge (A, B, k) only when its own detector finds that the motion over [0, D] drives a point of A into an opposing face of B, or a point of B into an opposing face of A. Otherwise it SHALL report no edge. For both crossed-bars scenes at defaults, the plan SHALL be `solved`. No committed step SHALL be Blocked by the independent verifier or by the analytic reference in `design.md`, and the probe SHALL exit 0. *(Slice 2.)*

2.2 WHEN the step verifier evaluates a move THEN it SHALL ignore contact beyond D. It SHALL report no edge for the two-cube move, the fixed-distance near miss, the pin through a wide hole, and the contact scenes in 2.3. *(Slice 2.)*

2.3 WHEN the independent verifier evaluates these direct linear moves THEN it SHALL return the following. *(Slice 1, implemented.)*

| Move | Verdict |
|---|---|
| Original failure: crossed bars, `/0#0` +X for 0.07500000018626451 | Blocked |
| Fixed-distance near miss: Z_bar at x = 1.416, same Part, direction and distance | Clear |
| Longer solver-selected failure: Z_bar at x = 1.416, `/0#0` +X for 1.616 world (0.101 normalized) | Blocked |
| Boundary twin (Z_bar at x = 1.384) and pass-through (1.4 world) | Blocked |
| Two unit cubes, the first moved +X by 1 world | Clear (legacy count still 40) |
| 0.5 cube inside a solid 4 cube, either mover, +X 0.1 world | Unverified (`nested_at_start`) |
| The same, with the outer cube's winding reversed | Unverified (`invalid_orientation`) |
| Unit cubes overlapping by 5e-5 world, either one sliding +X | never Clear: Unverified (`contact_unresolved`) |
| Genuine face contact while sliding, lift-off, touch at the end pose | Clear (`contact_plane`) |
| A real gap of 0.1 world while sliding | Clear |
| Pin through a wide hole, as a direct linear move (swept bounding boxes overlap) | Clear (`separation_distance`) |
| Exact-fit pin sliding on four walls, as a direct linear move | Unverified (`contact_unresolved`), never Blocked |

2.4 WHEN a step's primitive is not `linear_slide` THEN its verdict SHALL be Unverified (`unsupported_primitive`). That verdict SHALL NOT create a Blocking_Edge, mark a deadlock, change the plan or count as a blocker. The pin scenes show this: the default compiler selects `helical_unscrew` for both pins, so their compiled trajectories are Unverified. *(Slice 1, implemented.)*

2.5 WHEN a check is inconclusive THEN the verdict SHALL be Unverified with a reason. No Blocking_Edge SHALL be invented, and the plan SHALL be unchanged. The solver SHALL NOT read the independent verifier's verdicts. *(Slice 1 provides the verdicts; the import isolation is enforced by a static test.)*

2.6 WHEN a trajectory is verified THEN every Assembly Part SHALL start present, and a Part SHALL be removed only after its own step. A guide that only removes a ring SHALL be checked against the shaft, which has no step. A step that names an unknown Part, or a second step for the same Part, SHALL be rejected before any geometry runs. *(Slice 1, implemented.)*

2.7 WHEN Guide Forge verifies a solved plan THEN it SHALL verify each compiled Trajectory_Step with `verifyTrajectory`, over all Assembly Parts, and combine the verdicts by the plan rule. The Clash_Badge, status callout, comparison card and exported manual SHALL show the same plan verdict ("Verified", "Blocked" or "Unverified"). A missing report SHALL read as Unverified, and nothing SHALL show "Verified" unless every step is Clear. *(Slice 3.)*

2.8 WHEN a consumer plays a move THEN the verdict it shows SHALL be computed for that played move. Verdicts SHALL carry their inputs and SHALL NOT be cached or reused for a different distance or a different set of present Parts. For example, the near-miss Part and direction are Clear at 1.2 world and Blocked at 1.616 world. *(Slice 1, implemented.)*

2.9 WHEN either check runs THEN the step verifier (solver side) and the independent verifier SHALL live in separate modules, SHALL NOT import each other, and SHALL use different methods. Neither SHALL import Stage 2's sampler, the Seeded_PRNG, the DBG ray caster or the DBG hit filter. The independent verifier SHALL NOT import the legacy Clash_Checker. *(Static test added in slice 1.)*

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the showcase kits and the Keyboard_Fixture are solved at defaults THEN they SHALL CONTINUE TO return `solved`, and the Deadlock_Cages SHALL CONTINUE TO return `deadlocked`.

3.2 WHEN the invariant suites, the gearbox lazy-refinement tests and the 200-pose gearbox sweep run THEN they SHALL CONTINUE TO pass, and no existing solver assertion SHALL be weakened. The lazy-refinement check that every refined edge has a legacy `checkClashes` count above 0 (`test/unit/stage3-lazy-refinement.test.ts`:88) stays as it is in slice 1. Slice 2 may only extend it, as `design.md` describes.

3.3 WHEN Guide Forge shows a plan THEN "Verified" SHALL CONTINUE TO need a proof, which is now the plan verdict Clear. Measured consequence: all three showcase kits contain `helical_unscrew` steps (keyboard 6 of 146 steps, gearbox 4 of 25, lockbox 2 of 13). Each will therefore show Unverified at best until helical verification exists.

3.4 WHEN Parts touch, slide along a face, or move away from initial contact without interior penetration THEN the step verifier SHALL CONTINUE TO add no edge, and the independent verifier SHALL return Clear when an exact Q3 plane exists and Unverified otherwise. It SHALL never return Blocked for these moves.

3.5 WHEN the same inputs are given twice THEN every stage and both verifiers SHALL CONTINUE TO return identical results. No unseeded randomness SHALL be added.

3.6 WHEN `checkClashes` and `computeNaiveRadialClashes` run on the same inputs THEN they SHALL CONTINUE TO return identical counts and index lists (Req 20 and Req 21 unchanged).

3.7 (revised) WHEN legacy ray hits are reported THEN their counts SHALL CONTINUE TO be preserved exactly. Nothing SHALL treat a legacy ray hit as a finite-path collision, or a legacy zero as proof of clearance. In the two-cube control, `checkClashes` still returns 40 and the finite verdict is Clear.

3.8 WHEN the static suites run (`clash-independence`, `purity`, `determinism-sources`, `no-swallow`, `no-trivial-assert`, `se3-single-source`) THEN they SHALL CONTINUE TO pass, with `clash-independence` extended to the new module. `@unboltkit/core` SHALL CONTINUE TO depend only on `three` and `three-mesh-bvh`, and verification SHALL CONTINUE TO run in the Guide Forge solver worker, not on the main thread.

3.9 WHEN any verdict is computed THEN it SHALL CONTINUE TO come from geometry and the algorithm, never from a fixture, a Part name, a Part_ID or kit identity.

3.10 WHEN this fix lands THEN Unbolt Blitz's rules, animation and UI SHALL CONTINUE TO be unchanged by it. Blitz legality is a release follow-up in `tasks.md`.

3.11 WHEN Stage 2 runs THEN it and the Blocking_Graph it returns SHALL CONTINUE TO be unchanged, and so SHALL primitive selection in Stage 4.

## Test scenes

`design.md` defines each test, the independent reference that establishes its expected answer, and which trivial behaviour it rejects. The original failure, the fixed-distance near miss and the longer solver-selected failure are three separate tests.

## Release follow-ups

These are recorded as tasks in `tasks.md`:

1. **Blitz legality.** Unbolt Blitz decides legality from Stage 2 edges and deadlock-witness edges only (`game/levelData.ts`). From reading the code, the crossed-bars move is a legal Blitz move and plays for the floored 0.12 normalized, through Z_bar. Before a showcased move is called legal, Blitz must check the exact move it plays against its live Parts.
2. **Claims.** Guide Forge, its exported manual and the README must describe only what is verified. The README tagline currently promises "mathematically verified, zero-clash" sequences.
