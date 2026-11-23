# Design: finite straight-move verification

## Overview

The fix has two independent checks and one change to how results are shown. It is delivered in three slices.

| Slice | Component | File | State |
|---|---|---|---|
| 1 | Independent move verifier: Clear, Blocked or Unverified for each straight move, with evidence | `packages/unbolt-core/src/oracle/moveVerifier.ts` | **implemented** |
| 2 | Solver-side detector: the Peel_Solver passes the exact move and gets a Blocking_Edge only for a detected collision within its distance | `packages/unbolt-core/src/stage3/stepVerifier.ts`, `peelSolver.ts` | **implemented** |
| 3 | Guide Forge verifies the compiled trajectory it plays and shows one plan verdict everywhere | `apps/guide-forge/src/...` | designed, not started |

`checkClashes`, `computeNaiveRadialClashes`, Stage 2, Stage 4 primitive selection, Unbolt Blitz and the sample kits do not change in any slice. The release follow-ups for Blitz and for product wording are tasks in `tasks.md`.

The two checks use different methods:
- The solver-side detector sweeps points and edges along the move and looks for opposing faces.
- The independent verifier uses solid validity, separation distance, exact separating planes, and points inside both solids.

A blind spot in the independent verifier can only produce Unverified, never a false Clear, because Clear needs a proof.

## How the review decisions map to the design

| Decision | Where it is handled |
|---|---|
| 1. Contact allowed; ε is a numerical tolerance; undecidable contact is Unverified | Steps 3 to 7 of the verifier. Undecided contact gives `contact_unresolved`. |
| 2. Only `linear_slide` moves are verified | `verifyTrajectory` marks every other primitive `unsupported_primitive` and runs no geometry for it. |
| 3. Clear, Blocked and Unverified, with collision taking priority | `combineVerdicts`. In slice 3, plan verdict Clear is shown as "Verified". |
| 4. Legacy ray hits stay as diagnostics | `checkClashes` and the naive baseline are unchanged. A test keeps the two-cube legacy count at 40 while the verdict is Clear. |
| 5. Exact move, played motion, no reuse | `LinearMove` carries `dir`, `distance` and the present Part_IDs, and nothing is cached. |
| 6. Nested or inverted solids are never Clear | Step 1 (closed and outward-wound shells) and step 3 (start classification of every shell, both ways). |
| 7. Positive overlap ≤ ε is not separation | Q3 accepts only overlap ≤ η, the float64 rounding bound (about 1e-14). ε is not used in Q3. |
| 8. Pins: direct linear tests stay; compiled pin trajectories are Unverified | Direct `verifyLinearMove` tests, and an end-to-end test that asserts the default compiler's `helical_unscrew` and the resulting `unsupported_primitive`. |
| 9. Present set starts from all Assembly Parts | `verifyTrajectory(parts, steps)`: a Part leaves only after its own step, and unknown or duplicate step IDs throw. |
| 10. Legacy counts diagnostic; no weakened solver tests; release follow-ups | No solver code or solver test changed in slice 1. Follow-ups are in `tasks.md`. |

## Components and import rules

| Component | May import | Must not import |
|---|---|---|
| `src/oracle/moveVerifier.ts` | `types`, `config`, `errors`, `three`, `three-mesh-bvh` (today it uses no math helper) | anything in `src/stage2/` or `src/stage3/`, `src/prng.ts`, `src/oracle/clashChecker.ts` |
| `src/stage3/peelSolver.ts`, `src/stage3/stepVerifier.ts` | as today | anything in `src/oracle/` |

`test/static/clash-independence.test.ts` enforces both rows with a new `describe` block. The original checks of the legacy checker are unchanged.

The verifier computes its own triangle normals from vertex positions. It does not read Stage 1's `faceNormals`.

## Public API (slice 1, implemented)

```ts
verifyLinearMove(moving: ClashPart, dir: Vec3, distance: number,
                 statics: readonly ClashPart[], config: SolverConfig | ResolvedSolverConfig): MoveVerification
verifyTrajectory(parts: readonly ClashPart[], steps: readonly TrajectoryStep[],
                 config: SolverConfig | ResolvedSolverConfig): TrajectoryVerification
combineVerdicts(verdicts: readonly MoveVerdict[]): MoveVerdict   // blocked > unverified > clear; [] is clear
```

Types are in `src/types.ts`:
- `MoveVerdict`
- `MoveReason`
- `LinearMove`, with `partId`, `dir`, `distance` and `presentPartIds` (ascending)
- `PairVerification`, with `staticPartId`, `verdict`, `reason` and `evidence`
- `MoveVerification`
- `StepVerification`, with `partId`, `primitive`, `verdict`, `reason` (null when checked), `move` (null when unsupported) and `blockerIds`
- `TrajectoryVerification`

| Reason | Verdict |
|---|---|
| `separated_boxes`, `separation_distance`, `contact_plane` | clear |
| `penetration_witness` | blocked |
| `unsupported_primitive`, `open_mesh`, `invalid_orientation`, `nested_at_start`, `initial_separation_unknown`, `contact_unresolved`, `iteration_cap` | unverified |

Errors are thrown before any geometry runs:

| Error | When |
|---|---|
| `InvalidSolverConfigError` | the config fails validation |
| `InvalidDirectionError` | `dir` is non-finite, or its length differs from 1 by more than 1e-6 |
| `InvalidMoveDistanceError` (new) | `distance` is non-finite or negative |
| `MovingPartInStaticSetError` | the mover appears among the statics |
| `RangeError` | a static Part_ID appears twice |
| `InvalidTrajectoryError` (new) | reason `unknown_part`, `duplicate_step`, `duplicate_part` or `malformed_params` (a `linear_slide` step without `{ kind: "linear_slide", dir, distance }`) |

## Independent move verifier (slice 1, implemented)

`verifyLinearMove` sorts the statics by Part_ID, verifies each pair (A, B), and combines the results. ε is `clearanceEpsilon`. For one pair, the steps run in this order, and the first conclusion wins.

1. **Solid validity.** This is computed once per Part and cached in a `WeakMap`, keyed by the Part object.
   - **Closed:** among triangles whose corners lie in three distinct weld clusters, every directed welded edge appears exactly once and so does its reverse.
   - **Outward-wound:** shells are the connected components of clusters joined by triangles. Each shell's signed volume, Σ det(a, b, c)/6 taken about the shell's first vertex, must be greater than 0.
   - A Part that is not closed gives Unverified (`open_mesh`). A closed Part that is not outward-wound gives Unverified (`invalid_orientation`).
2. **Q1, swept-box gap.** g = maxⱼ max(B.minⱼ − (A.maxⱼ + max(0, D·dⱼ)), (A.minⱼ + min(0, D·dⱼ)) − B.maxⱼ). If g > ε, the result is Clear (`separated_boxes`).
3. **Start classification.** Compute δ₀ = the surface distance at s = 0 (`B.bvh.closestPointToGeometry(A.bvh.geometry, translation)`). If δ₀ > 2ε, classify one vertex of every shell of A against B, and one vertex of every shell of B against A, by generalized winding number (Van Oosterom and Strackee, float64).
   - A value within 0.25 of 1 is inside, which gives Unverified (`nested_at_start`).
   - A value not within 0.25 of 0 is ambiguous, which gives Unverified (`initial_separation_unknown`).
   - If δ₀ ≤ 2ε, contact begins at s = 0 and the verifier goes to step 5. Steps 5 and 6 do not depend on the start condition.
4. **Q2, conservative advancement.** While δᵢ > 2ε:
   - If sᵢ ≥ D, the result is Clear (`separation_distance`, with the minimum δ and the iteration count).
   - After 4,096 iterations, the result is Unverified (`iteration_cap`).
   - Otherwise set s_{i+1} = min(D, sᵢ + δᵢ − ε). δ is 1-Lipschitz in s for a unit-speed translation, so δ ≥ ε on [sᵢ, s_{i+1}].

   When δᵢ ≤ 2ε, contact begins at s_c = sᵢ.
5. **Q3, exact separating plane on [s_c, D].**
   - **Candidates**, deduplicated, in this order:
     1. normals of B's triangles that meet A's box at s_c, grown by 2ε;
     2. negated normals of A's triangles that meet B's box in A's frame;
     3. ±x, ±y and ±z.

     Up to 32 normals are taken from each Part, through `bvh.shapecast`, with each normal computed from the triangle's own vertices.
   - **Test.** For each candidate m, compute the swept projection range of A, min_A + min(s_c·m·d, D·m·d) to max_A + max(s_c·m·d, D·m·d), and B's range, both over every vertex in float64. The result is Clear (`contact_plane`) when one side's overlap is at most η = 2⁻⁴⁶·(L_A + L_B + D + 1), where L is the largest |x| + |y| + |z| over a Part's vertices.
   - η bounds the rounding of this computation. It is about 1e-14 for normalized assemblies and is not a geometric tolerance.
6. **Q4, penetration witness on [s_c, D].**
   - Search 17 evenly spaced poses, or the single pose s_c when D = s_c.
   - At each pose, `B.bvh.bvhcast(A.bvh, translation)` visits at most 65,536 triangle pairs and examines at most 256 that intersect.
   - For each intersecting pair, the module computes the midpoint q of the intersection segment with its own code. Coplanar pairs are skipped. The inward direction is v = −(n_a + n_b); the pair is skipped when |v| < 1e-6, which means opposing faces.
   - For r = 2ε·2ʲ with j = 0 to 11, test the candidate w = q + r·v̂. Both boundary distances, from `closestPointToPoint`, must exceed ε, and then both winding numbers must lie within 0.25 of 1.
   - The first candidate that passes gives Blocked (`penetration_witness`, with `travel`, `point` and `depth`).
7. Otherwise the result is Unverified (`contact_unresolved`, with `contactAt`).

### Proof obligations

| Verdict | Why it holds |
|---|---|
| `separated_boxes` | The swept AABB contains A(s) for every s ∈ [0, D]. A gap greater than ε on one axis means every point of A(s) is more than ε from B. |
| `separation_distance` | Step 4 shows δ ≥ ε on all of [0, D]. Step 3 shows every shell of each Part lies outside the other at s = 0, so the interiors are disjoint there (each Part is closed and outward-wound, and the boundaries do not meet). By continuity, interiors that met later would require boundary contact first, which contradicts δ ≥ ε. |
| `contact_plane` | For every s ∈ [s_c, D], A(s) lies in {m·x ≤ c + η} and B lies in {m·x ≥ c}, where η is rounding only. [0, s_c] is covered by step 4, whose start was classified in step 3. |
| `penetration_witness` | A ball of radius ε around w lies inside both closed, outward-wound solids at travel s. |
| Any Unverified reason | No claim is made. |

**Mutual exclusion.** No pair can be both Clear and Blocked. A plane with rounding-level overlap cannot contain a ball of radius ε, and the distance proofs exclude any overlap at all.

**Why nesting needed step 3.** A cube nested inside a solid cube has surfaces 1.75 world apart. Without classifying the start, the distance proof would wrongly clear it. That is exactly what the round-1 prototype did; see the tables below.

**Why Q3 no longer uses ε.** With overlap ≤ ε accepted, two cubes that interpenetrate by 5e-5 world (2.5e-5 normalized) were cleared. Now such an overlap fails Q3. A slab 2.5e-5 thick cannot hold a witness ball of radius 5e-5 either, so the result is Unverified.

### Library notes (three-mesh-bvh 0.8.3)

- With an indirect BVH, `closestPointToGeometry` reports BVH-internal triangle indices, not Part-local ones (`closestPointToGeometry_indirect.generated.js` lines 145 and 195). The verifier therefore takes plane candidates from `shapecast` triangles and computes their normals from vertex positions, without using indices.
- `ExtendedTriangle.distanceToTriangle`, called inside `closestPointToGeometry`, logs "Triangles are coplanar which does not support an output edge" for coplanar contact (`ExtendedTriangle.js`:298, :431). The message appears as stderr in the contact tests. It does not affect results, and the verifier never calls `intersectsTriangle` itself.

### Cost

- Step 1 is linear in the triangle count and cached per Part.
- Step 2 culls separated pairs at no geometric cost.
- Step 4 runs one BVH-to-BVH distance query per iteration, roughly D/(gap − ε) of them.
- Steps 5 and 6 run only at contact. Their bounds are 32 + 32 + 6 planes, 17 poses × 256 pairs × 12 radii, and a winding sum that is O(triangles). The cheaper distance filters run first.
- Kit-scale cost is measured below, under "Showcase kit measurement".

## Trajectory verification (slice 1, implemented)

`verifyTrajectory(parts, steps, config)`:
- `parts` must be the whole Assembly. All of it starts present, and a Part leaves the present set only after its own step, so a Part without a step stays present to the end.
- For each step, the statics are the present Parts other than the mover, in ascending Part_ID order.
- A `linear_slide` step is verified with its own `params.dir` and `params.distance`. Any other primitive gives Unverified (`unsupported_primitive`, `move: null`, no blockers) and runs no geometry.
- Every step is validated before any geometry runs: unknown Part, repeated step, repeated Part, malformed `linear_slide` params, invalid direction or invalid distance.
- The plan verdict is `combineVerdicts` over the steps.
- The function only reads. No verdict reaches the solver, the Blocking_Graph or a deadlock witness.

## Solver-side detector (slice 2, implemented)

**Request.** `StepVerificationRequest` gains `distance`, the selected `escapeDistance`, which is the value Stage 4 compiles into `linear_slide.distance`.

**Stage A.** The existing vertex and centroid rays count a hit only if `clearanceEpsilon ≤ t ≤ D`.
- For solver-selected moves this changes nothing in exact arithmetic. Beyond the escape distance the Part is outside the union AABB on the axis that defines the escape, so no ray can hit anything there.
- For direct calls, this bound makes the two-cube and near-miss requests produce no edge.

**Stage B (new).** Edge sweeps cover the case point rays cannot see.
- Each welded edge is moved `microShrink` against its area-weighted edge normal.
- The edge is swept over [0, D]·d. A candidate triangle t_b of B is kept only if its face opposes the motion: n_b·d < −τ.
- Writing p(u, s) = e₀ + u(e₁ − e₀) + s·d, the plane equation gives s(u) affine in u, and the barycentric coordinates are then affine in u too.
- The edge reaches the inside of t_b within the move if the interval where every barycentric coordinate is ≥ 0, 0 ≤ u ≤ 1 and ε ≤ s(u) ≤ D is non-empty.
- The same test runs with B's edges along −d against A's triangles.

**Expected detections**, from the analysis written before Stage B was built. Stage B is now implemented; the measured outcomes are in "Measured detections" below, and those take precedence:

| Move | Stage B result |
|---|---|
| Crossed bars | hit at s ≈ 0.05, within D = 0.075 |
| Twin | hit at s ≈ 0.074, within D = 0.075 |
| Longer solver-selected move | hit at s ≈ 0.076, within D = 0.101 |
| Pass-through | hit at s ≈ 0.05, within D = 0.0875 |
| Sliding contact | no hit: the faces are parallel to d, so γ = 0 |
| Lift-off | no hit: the opposing faces lie behind the motion |
| Touch at the end pose | no hit: micro-shrink puts the hit at about D + microShrink/√2 |
| Pins | no hit: the opposing faces do not cover the swept edges |

**Lazy-refinement assertion.** `stage3-lazy-refinement.test.ts`:88 requires every refined edge to have a legacy count above 0. Stage B edges can have 0 legacy hits by design. Slice 2 keeps the legacy check for Stage A edges, and adds a stronger check for Stage B edges: the independent verifier must return Blocked for that exact request.

**How the stage is recorded (slice 2 choice, for review).** `BlockingEdge` and the plan are unchanged. `createStepVerifier` returns a `detections` log next to `verify` and `stats`: one entry per reported edge, in report order, with `from`, `to`, `dirIndex`, `dir`, `distance` and `stage` (`"ray"` or `"edge_sweep"`). Only tests read it.

**Where the implementation refines the design.**
- **Feature edges only.** Stage B sweeps an edge only when it has one incident triangle or its incident face normals differ by more than 1e-9. An edge inside one flat face, such as the diagonal of a triangulated quad, is shrunk only along that face's normal, so its endpoints stay on the Part's other faces. Swept, it reported a false edge for "touch at the end pose" and for the exact-fit pin. First contact that no vertex ray sees begins at a feature edge, so dropping flat edges loses no detection.
- **Positive-length interval.** The u interval must have positive length, and a barycentric coordinate that is constant in u must be strictly positive. A contact at one u, at a triangle boundary, is left to the vertex rays of Stage A.
- **Bounded coarse test.** The swept-AABB cull now sweeps over [0, D] instead of an unbounded ray. Every hit that Stage A or Stage B can keep lies inside that box, so this removes no edge.
- **Edge sweeps run only when Stage A found nothing for the pair**, and stop at the first hit.
- **Stage A keeps importing Stage 2's ray caster and hit filter**, as the import table above allows. `bugfix.md` 2.9 says neither check may import them; that wording and this table disagree, and slice 2 did not change Stage A's imports. Stage B imports nothing from Stage 2.

**Measured detections**, from `test/unit/stage3-finite-step-verifier.test.ts`:

| Move | Step verifier |
|---|---|
| Crossed bars, twin, pass-through, longer solver-selected move | one edge to Z_bar; for crossed bars it is found by `edge_sweep`, and `checkClashes` is 0 |
| Ring sideways into the shaft | one edge to the shaft |
| Near miss, two cubes (legacy count still 40), nested cubes ×4, 5e-5 overlap ×2, face slide, lift-off, end touch, real gap, both pins, ring off the end | no edge |
| Two cubes with D raised to 2.5 world | one edge, and the independent verdict is Blocked |

**Showcase kits at defaults** (read-only script `/tmp/unbolt-detections.ts`): the step verifier reports no edge for any of the three kits, so their plans are what the plain peel gives. Stage B swept 4,480 edges for the keyboard, 33,815 for the gearbox and 5,625 for the lockbox, and the whole peel took 41, 39 and 11 ms.

**Zero-distance moves.** `escapeDistance` is 0 when a Part's box already misses the union of the other boxes on some axis. Such a step compiles to a `linear_slide` of distance 0, and the step verifier now reports no edge for it, whatever `dir` is. The legacy checker ignores distance, so it can still count hits along that `dir`. No invariant run hit this case, but a consumer that floors the travel (Blitz, `EXIT_TRAVEL_FLOOR`) plays a move that nothing has checked; `tasks.md` 4.1 covers it.

## Guide Forge (slice 3, designed)

- `worker/solvePipeline.ts` calls `runOracle(compiled.steps, stage1.parts, stage1.config, deps)`, and `runOracle` calls `verifyTrajectory`. It keeps `checkClashes` per step only to report a legacy ray-hit diagnostic.
- `OracleReport` becomes `{ verdict, perStep: { partId, primitive, verdict, reason, blockerIds, legacyRayHits }[], legacyRayHits }`.
- The badge, callout, comparison card and exported manual all read `oracle.verdict`:

  | Plan verdict | Badge text |
  |---|---|
  | Clear | "Verified • N of N steps clear" |
  | Blocked | "Blocked • k of N steps collide" |
  | Unverified | "Unverified • u of N steps not checked" |
  | No report | "Unverified • no independent check" |

  Each state has an icon and a text label, so it reads on mute.
- What the export and the README may claim is release follow-up `tasks.md` 4.2.

## Unbolt Blitz

There is no change in any slice of this fix. Blitz plays `result.step.params`, whose distance is `max(escape, EXIT_TRAVEL_FLOOR = 0.12)` measured against its live Parts. Its legality comes from Stage 2 and witness edges only.

Release follow-up `tasks.md` 4.1 requires Blitz to verify that exact played move against its live Parts before calling a showcased move legal. A plan verdict, which was computed for a different distance and a different present set, must never be reused for it.

## Walkthrough: an inconclusive check adds no blocking edge

**Direct linear move.** The exact-fit pin is a 1 × 1 × 3 box in a 1 × 1 hole through a 4 × 4 × 0.5 plate.
1. Both meshes are closed and outward-wound.
2. Q1 fails, because the swept boxes overlap.
3. δ₀ = 0, so contact begins at s_c = 0.
4. No plane candidate separates the Parts, because the plate surrounds the pin.
5. No witness exists, because nothing penetrates.

The result is Unverified (`contact_unresolved`). It creates no edge, and the solver never reads it.

**Compiled trajectory.** The default compiler selects `helical_unscrew` for the pin, in both pin scenes, and the tests assert this. The step is therefore Unverified (`unsupported_primitive`) without geometry, and the plan verdict is Unverified. The plan stays `solved`, and no deadlock or blocker is reported.

## Results

### Showcase kit measurement (`tasks.md` 1.6)

Measured with `/tmp/unbolt-measure-kits.ts` (read-only, no assertions), on the plans of the solver before slice 2, at the default config, Node v25.4.0. Two readings per kit:
- **Compiled trajectory:** what `verifyTrajectory` returns for the Stage 4 output. Non-linear steps are `unsupported_primitive`.
- **Solver straight moves:** every plan step verified as the straight move the solver selected (`dir`, `escapeDistance`), with the same present set.

| Kit | Parts | Steps by primitive | Compiled plan verdict | Straight-move plan verdict | Pair reasons (straight moves) | Parts `open_mesh` / `invalid_orientation` | Verifier time |
|---|---|---|---|---|---|---|---|
| mechanical-keyboard-65 | 146 | 140 linear, 6 helical | Unverified: 140 Clear, 6 `unsupported_primitive` | Clear, 146 of 146 | 10,493 `separated_boxes`, 92 `separation_distance` | 0 / 0 | 41 s; slowest step 7.3 s |
| planetary-gearbox-3-stage | 25 | 21 linear, 4 helical | Unverified: 21 Clear, 4 `unsupported_primitive` | Clear, 25 of 25 | 258 `separated_boxes`, 42 `separation_distance` | 0 / 0 | 519 s; slowest steps 159, 158 and 151 s |
| haunted-clockwork-lockbox | 13 | 11 linear, 2 helical | Unverified: 11 Clear, 2 `unsupported_primitive` | Clear, 13 of 13 | 60 `separated_boxes`, 18 `separation_distance` | 0 / 0 | 45 s; slowest step 27 s |

- No pair of any kit was Blocked, and none reached `contact_plane`, `contact_unresolved` or `iteration_cap`.
- The cost is in conservative advancement (`separation_distance`): one BVH-to-BVH distance query per iteration, on dense gear meshes. A full gearbox check takes about 8.6 minutes, which is too slow to run on every solve in the Guide Forge worker. Slice 3 needs a cost decision.
- The kit plans did not change in slice 2 (see "Solver-side detector"), so these verdicts still describe them.

### `/tmp` prototype only (not production code)

The round-1 prototype `/tmp/unbolt-oracle-feasibility.ts` ran the round-2 regression scenes. Its verdicts show the defects that decisions 6 and 7 address:

| Scene | Prototype verdict |
|---|---|
| 0.5 cube inside a solid 4 cube, inner moves +X 0.1 | Unverified (nested) |
| Same, outer moves | **Clear** (min distance 0.4125) |
| Outer winding reversed, inner moves | **Clear** |
| Outer winding reversed, outer moves | **Clear** |
| Unit cubes overlapping by 5e-5 world, sliding +X | **Clear** (separating plane, overlap 2.50006e-5 ≤ ε) |
| Slide, lift-off, touch at the end pose | Clear (overlap 0) |

The prototype's other numbers (round 1) are kept for reference. Witness depth was 7.07e-5 for the crossed-bars cases. The wide-hole pin was cleared by distance with a minimum of 0.05 after 14 iterations. The exact-fit pin was `contact_unresolved` at 0.

### Production implementation (slice 1)

`packages/unbolt-core/test/unit/move-verifier.test.ts` has 29 tests. Before the module existed, 28 of them failed and the one that does not call the verifier passed. With the module, all 29 pass:

| Test | Verdict and evidence | Independent reference |
|---|---|---|
| Original failure | Blocked; the witness is more than ε inside both bars, re-checked by box arithmetic | R1 overlap > 10ε |
| Fixed-distance near miss | Clear | R1 gap 0.016 world |
| Longer solver-selected failure | Blocked; D is taken from the union-AABB escape (1.616 world) | R1 |
| Twin and pass-through | Blocked | R1; for the pass-through, start, middle and end poses are all clear |
| Verdict bound to distance | Clear at 1.2, Blocked at 1.616, Clear again at 1.2; results echo their `LinearMove` | R1 |
| Two cubes | legacy `checkClashes` = 40; Clear (`separated_boxes`) | R1 gap 1 world |
| Nested cubes, 4 cases | Unverified (`nested_at_start` ×2, `invalid_orientation` ×2); never Clear | box containment; signed volume sign |
| 5e-5 overlap slide, either mover | Unverified (`contact_unresolved`); never Clear | R1 overlap in (0, ε) |
| Face contact slide, lift-off, end touch | Clear (`contact_plane`) | R1 overlap 0 |
| Real gap of 0.1 while sliding | Clear | R1 gap |
| Wide-hole pin, direct | Clear (`separation_distance`); the swept AABBs overlap | R2 radial clearance 0.05 normalized |
| Exact-fit pin, direct | Unverified (`contact_unresolved`) | R1 over four plate bars: max overlap 0 |
| Ring and shaft, the shaft having no step | ring off the end along +z: Clear with shaft present; ring sideways +x: Blocked by the shaft | R1 over the ring's four bars |
| Removal order | Z_bar first, then Y_bar: both Clear with the right present sets; Y_bar first: Blocked by Z_bar | R1 |
| Unsupported primitive | `helical_unscrew` gives Unverified with no geometry; Blocked takes priority | none needed |
| Unknown or duplicate IDs | `InvalidTrajectoryError` | none needed |
| Compiled pin trajectories, both pins | the default compiler picks `helical_unscrew`; the pin step is Unverified (`unsupported_primitive`); the plan is Unverified | none needed |
| Input validation and `combineVerdicts` | throws as specified; combine table | none needed |

The references are test-only code with no BVH, no winding number and no verifier code:
- **R1** is `test/helpers/reference/boxSweep.ts`, exact separating-axis arithmetic for a swept box against a box.
- **R2** is `test/helpers/reference/pinClearance.ts`, radial clearance along the travel axis.

Plates and rings are modelled for R1 as four boxes (`plateBars`). Scenes are built by `test/helpers/moveScenes.ts`.

**Other suites:**
- `clash-independence`: 4 new import-isolation tests pass, and the original tests are unchanged.
- `public-api`: the 5 new exports are listed.
- Core `test:quick`: 35 files and 489 tests pass.
- Core `typecheck`: clean.

### Which wrong behaviours the slice-1 tests reject

| Behaviour | Fails |
|---|---|
| Accept everything (the old checker's effective behaviour on crossed bars) | original failure, longer move, twin and pass-through, ring sideways |
| Reject everything | near miss, two cubes, contact cases, real gap, wide-hole pin, ring off the end |
| Always Unverified | all Clear and Blocked cases |
| Ignore D | near miss, two cubes, distance binding |
| End pose only | original failure (its end pose only touches), pass-through |
| Treat overlap ≤ ε as contact | 5e-5 overlap slide |
| Distance proof without classifying the start | nested cubes |
| Ignore orientation | reversed winding |
| Block whenever the swept AABBs overlap | wide-hole pin, ring off the end |
| Present set = later steps only | ring and shaft |
| A rule keyed on name or Part_ID | original failure against near miss: same names, IDs, direction and distance, opposite verdicts |

## Risks

- **Real meshes may fail the validity check.** If meshes are open, or contain inward shells such as a cavity split into its own Part, their pairs become `open_mesh` or `invalid_orientation`. No showcase kit Part does (measured, `tasks.md` 1.6), but imported GLBs have not been measured.
- **No showcase kit will show "Verified".** All three contain `helical_unscrew` steps (6, 4 and 2).
- **Unresolved contact makes kit steps Unverified.** Contact on curved surfaces or on several faces (meshing gear teeth, pins in holes, parts in channels) gives `contact_unresolved`.
- **Witness search and caps are heuristic.** If the search misses a penetration, or a cap is exceeded, the result is Unverified, never Clear.
- **Kit-scale cost is high for the gearbox.** A full independent check of its plan took 519 s (measured, `tasks.md` 1.6).
