# Implementation Plan

Requirement numbers refer to `bugfix.md` (1.x current, 2.x expected, 3.x unchanged). Run shell commands one at a time, and quote the workspace path, which contains a space.

- [x] 1. Slice 1: independent finite straight-move verifier
  - [x] 1.1 Add test-only references and scenes: `test/helpers/reference/boxSweep.ts` (R1), `test/helpers/reference/pinClearance.ts` (R2) and `test/helpers/moveScenes.ts`.
    - _Requirements: 2.3, 3.9_
  - [x] 1.2 Write `test/unit/move-verifier.test.ts` and record it failing before the module existed (28 of 29 failed).
    - _Requirements: 2.3, 2.4, 2.6, 2.8_
  - [x] 1.3 Implement `src/oracle/moveVerifier.ts`:
    - solid validity (closed, and outward-wound per shell);
    - Q1 to Q4, with the start classification of every shell in both directions;
    - Q3 with the rounding bound only;
    - `verifyLinearMove`, `verifyTrajectory` (present set = all Assembly Parts) and `combineVerdicts`.

    Add the types to `src/types.ts`, the two errors to `src/errors.ts`, and the exports to `src/index.ts`.
    - _Requirements: 2.3 to 2.6, 2.8, 2.9, 3.5, 3.9_
  - [x] 1.4 Extend `test/static/clash-independence.test.ts` with isolation rules for the verifier and the solver, and list the new exports in `test/unit/public-api.test.ts`.
    - _Requirements: 2.9, 3.8_
  - [x] 1.5 Run, one at a time: the verifier tests, core `test:quick`, and core `typecheck`.
    - _Requirements: 3.6, 3.7, 3.8_
  - [x] 1.6 Measure the verifier on the showcase kits' solver plans, and record the results without asserting them: verdict and reason counts per kit, how many Parts are `open_mesh` or `invalid_orientation`, and run time.
    - Measured with the read-only script `/tmp/unbolt-measure-kits.ts`, on the plans of the solver before slice 2 (default config). Results are in `design.md`, "Showcase kit measurement".
    - _Requirements: 3.3_

- [x] 2. Slice 2: solver-side detector
  - [x] 2.1 Add `distance` to `StepVerificationRequest`, and pass `selected.choice.escapeDistance` from `runPeel`.
    - _Requirements: 2.1_
  - [x] 2.2 Stage A: count a ray hit only if `clearanceEpsilon ≤ t ≤ D`.
    - _Requirements: 2.2, 1.7_
  - [x] 2.3 Stage B: add edge sweeps in both directions, with opposing faces only (n·d < −τ).
    - _Requirements: 2.1_
  - [x] 2.4 Tests:
    - the solver request for each slice-1 scene gives an edge exactly where the slice-1 verdict is Blocked;
    - end to end on both crossed-bars scenes, the plan is `solved`, no step is Blocked, R1 agrees, and the probe exits 0.

    Keep `stage3-lazy-refinement.test.ts`:88 at full strength for Stage A edges, and require an independent Blocked verdict for Stage B edges.
    - New file `test/unit/stage3-finite-step-verifier.test.ts` (25 tests). The verifier handle's `detections` log records which stage found each edge.
    - _Requirements: 2.1, 2.2, 3.1, 3.2_
  - [x] 2.5 Run, one at a time: core `test:quick`, core `typecheck`, then the full core suite with the invariants and the 200-pose sweep, and record the time against its 900 s budget.
    - Results: `test:quick` 36 files and 514 tests pass (150 s). `typecheck` is clean. The full suite has 50 files and 528 tests, all passing, in 203 s wall time. The 200-pose sweep took 194 s of its 900 s budget. The crossed-bars probe exits 0, and before the change it exited 1.
    - _Requirements: 3.1, 3.2_

- [ ] 3. Slice 3: Guide Forge verdicts
  Two separate features. "Check this move" (3A) checks one move the user chooses, on demand. The full-guide audit (3B) would check every compiled step of the plan; it is optional, and no screen may say the guide is verified until it has run and every step is Clear.
  - [x] 3A.1 **Check this move.** In the Manifest_Panel, the user chooses a present Part, one of six model axes and a finite travel in model units. The Solver_Worker runs the production `verifyLinearMove` on that exact move against the Parts present at the current step (all Parts minus completed plan steps; every Part for a deadlocked plan). No axis is substituted and no Part is removed by the check.
    - The check reuses the solve's Stage 1 Parts in the worker (`worker/moveCheck.ts`, `check` / `checkResult` / `checkFailure` messages). Opening a model or playing its plan runs no move verification.
    - The UI shows Checking, then Clear, Blocked (blocking Parts by name) or Unverified (plain-language reason), with an icon and words.
    - Any change of model, Part, direction, distance or present Parts drops the verdict (`reconcileMoveCheck`). A late answer whose `checkId` is no longer pending changes nothing. The client keeps one check in flight, and a newer request replaces a waiting one. A check that is already running cannot be cancelled; its answer is discarded.
    - _Requirements: 2.7, 2.8, 3.3_
  - [x] 3A.2 **Remove the zero-ray-hits "Verified" claim.** The header badge, status callout, comparison card and offline manual say "Full guide not verified". Legacy ray counts stay as a labelled diagnostic. A Clear move says it covers only that move.
    - _Requirements: 2.7, 3.3_
  - [x] 3A.3 **Tests.** `test/unit/move-check.test.ts` (17 tests): both service-ring files through the upload payload path, the exact move sent to the verifier, request validation, stale and late answers, present Parts, and the client queue. The existing Guide Forge tests now assert "Full guide not verified" in place of "Verified".
    - Browser acceptance on the production build in Chromium, with the service ring, +Y and 20 model units in all three checks: integral cap is Blocked by Spindle; removable cap with the cap on is Blocked by Service cap; after selecting the cap's step row it is Clear and Spindle is still present.
    - _Requirements: 2.7_
  - [ ] 3B.1 **Optional full-guide audit.** On request only, run `verifyTrajectory(stage1.parts, compiled.steps, config)` in the worker, show progress, and allow it to be cancelled. Only a completed audit whose plan verdict is Clear may change "Full guide not verified" in the studio and the export. Helical steps are `unsupported_primitive`, so today no kit can reach Clear. The cost measured in 1.6 (about 519 s on the gearbox) means it cannot run on every solve.
    - _Requirements: 2.7, 3.3, 3.7_
  - [ ] 3B.2 Change the `OracleReport` shape to carry the audit verdict next to the legacy ray diagnostic, and add tests for the verdict mapping and the pass-through of the trajectory.
    - _Requirements: 2.7_
- [ ] 4. Release follow-ups (required before release)
  - [ ] 4.1 **Blitz legality.** Before Unbolt Blitz calls a showcased move legal, it must check the exact move it plays (`result.step.params`, whose distance is `max(escape, EXIT_TRAVEL_FLOOR)`) against its live Parts, using `verifyLinearMove` in the worker. A plan verdict must never be reused for that move.
    - [x] 4.1a **Explicit attempts.** A "Try along" control (Auto, +X, −X, +Y, −Y, +Z, −Z) makes a click an attempt along exactly that axis. A straight attempt sends the `linear_slide` params the Arena would play, and every other live part, to the worker, which keeps the solve's Stage 1 parts and runs `verifyLinearMove`. Clear removes and scores the part once. Blocked costs a mistake and names the blockers from that check. Unverified, a worker error, a verdict for a different move, or any change since the attempt leaves the score, combo, mistakes and parts unchanged. One attempt is in flight at a time, and late answers after a replay or level change are ignored. A helical explicit attempt keeps the blocking-graph rule and is not described as checked. Tests: `test/game/explicitAttempt.test.ts` (11).
      - _Requirements: 2.8, 3.10_
    - [ ] 4.1b **Auto clicks (deferred redesign).** The normal click still decides from the blocking graph without a check, and the control now labels it "Auto · puzzle rules". On crossed bars, an Auto click on Y_bar picks +Y, where the bar is treated as a fastener, and scores a helical unscrew (+150) that no check covers. Auto straight moves are not checked either.
      - _Requirements: 2.8, 3.10_
    - [x] 4.1c **Release patch: cancel on axis change.** Choosing a different axis or Auto while an attempt says Checking cancels it at once (`attempt_unresolved`, reason `cancelled`). Its late reply cannot remove, animate or score a part, change combo, mistakes or time penalty, or affect a newer attempt. Choosing the axis that is already selected does nothing. Before this fix, on removable-cap.glb a +Y cap attempt followed by a switch to +X still removed the cap for +100. Regression tests are in `test/game/explicitAttempt.test.ts` ("release patch regression", 4 tests). Three of them fail with the old reducer.
      - _Requirements: 2.8, 3.10_
  - [x] 4.2 **Claims.** Guide Forge, its exported manual and the README describe only what is checked. The Guide Forge part was done in 3A.2. The README now says that single straight moves can be checked against the parts still present, and that full teardown plans and screw motions are not certified. It no longer says "mathematically verified, zero-clash" and labels the ray count as a diagnostic. Blitz's Auto chip reads "Auto · puzzle rules".
    - _Requirements: 2.7, 3.3_

## Release patch status
- **Done (this release):** 3A (Guide Forge "Check this move" and the wording), 4.1a (Blitz explicit attempts), 4.1c (cancel on axis change) and 4.2 (claims).
- **Deferred: Auto redesign (4.1b).** Auto keeps its current puzzle-rules gameplay and its label says so. Checking Auto moves would change the game loop and is not part of this release.
- **Optional, not scheduled: full-guide audit (3B).** No screen may say a whole guide is verified until it exists and every step is Clear.
