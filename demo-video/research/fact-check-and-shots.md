# UnboltKit demo footage: fact check, shot inventory and claims ledger

I didn't change any tracked file. All audit output went to `/tmp/*.json`, and the two probe scripts are `/tmp/escape-mcp.mjs` and `/tmp/escape-summary.mjs`. `git status` shows one untracked file I did not create: `MASTER_VIDEO_PRODUCTION_BIBLE.md` in the repo root. It appeared during the session, probably from another agent.

## Read these first

1. **Every README number for the two headline kits reproduces exactly.** All five kit audits finish in under 2.3 s each, so I audited all of them.
2. **No plan ever uses `two_step_l_slide`.** The solver always sets `secondary: null` (`packages/unbolt-core/src/stage3/peelSolver.ts:296-302`), and that primitive only applies when `secondary` is set (`primitives/twoStepLSlide.ts:26`). No kit produces it. Don't show or claim L-slides.
3. **39 correctness properties are specified, but only 9 have property tests:** P18, P20, P23, P34–P39. The other 30 property-test tasks are marked optional and unchecked in `tasks.md`.
4. **"Clashes" counts colliding ray samples, not distinct collisions.** For the deadlock cages, "oracle 0" and "2,592 avoided" mean nothing, because zero steps were replayed.
5. **"Mathematically verified" overclaims.** The checker casts rays from vertices and triangle centres along straight-line moves. It is a sampling check, not a proof.
6. **The Crew dashboard can't be recorded here.** There is no Kiro Crew host on this Mac (only `Kiro.app` and `kiro-cli`). The bundle imports `@kirocrew/app-sdk` and `react` as bare names that only a host can supply. Outside a host it shows invented "Sample preview" data.
7. **Screws will strobe on camera.** A lockbox screw makes 11.3 turns during its step: 1 s at 1x in Guide Forge, 0.6 s in Blitz.
8. **Some parts don't move in Guide Forge playback.** Their escape distance is 0: 5 of 13 lockbox steps, 10 of 25 gearbox, 22 of 146 keyboard. Use the "Hide Removed" view.
9. **Removed parts leave others floating; there is no gravity.** The lockbox body drops away at step 5 and leaves gears hovering. The keyboard plate, PCB, case and frame leave at steps 8–11 and leave 140 keys floating. Don't call the order "how a technician would do it".
10. **Blitz has no lose screen.** The only outcomes are "Victory" and "Interlock Exposed!". The "turntable" is a static platter with no auto-rotation.
11. **There are no `.glb` files in the repo.** The recovery shots and a real baseline-vs-PR diff both need files made first.
12. **The `dist/` builds are older than the last commit for each app** (Guide Forge 21:20 vs 21:48, Blitz 18:51 vs 19:19). The bundles do contain the newest labels I checked, but rebuild before recording.
13. **The README says "Kiroween 2026 entry" but the folder is "Kiroween 2027".** The machine date is 2026-11-22. Confirm the event name before narrating it.

---

## 1. Fact check

### 1a. CI audits

Command: `cd /tmp && time node "<repo>/apps/crew-assembly-ci/scripts/run-audit.mjs" --kit <kit> --out /tmp/<kit>.json`. `dist/engine.mjs` already existed, so I did not rebuild. "Wall" is total process time from zsh `time`, including Node startup. "Warm MCP" is one `inspect_assembly_dbg` call to an already-running MCP server over stdio.

| Kit | Parts / triangles | Status | Steps | Oracle | Naive (obstructed parts) | avoidedByPlan | Primitives | Verdict, exit code | Wall / warm MCP |
|---|---|---|---|---|---|---|---|---|---|
| haunted-clockwork-lockbox | 13 / 8,712 | solved | 13 | 0 | 12,618 (13/13) | 12,618 | 2 helical, 11 linear | PASS, 0 | 0.33 s / 0.23 s |
| deadlock-cage-dumbbell-ring | 2 / 1,920 | deadlocked | 0 | 0 (nothing replayed) | 2,592 (2/2) | 2,592 (meaningless) | none | FAIL, 1 | 0.13 s |
| planetary-gearbox-3-stage | 25 / 31,044 | solved | 25 | 0 | 60,681 (25/25) | 60,681 | 4 helical, 21 linear | PASS, 0 | 0.83 s / 0.71 s |
| mechanical-keyboard-65 | 146 / 17,036 | solved | 146 | 0 | 54,264 (140/146) | 54,264 | 6 helical, 140 linear | PASS, 0 | 2.29 s / 2.18 s |
| deadlock-cage-ship-in-bottle | 3 / 2,688 | deadlocked | 0 | 0 (nothing replayed) | 5,312 (3/3) | 5,312 (meaningless) | none | FAIL, 1 | 0.15 s |

`--list-kits` took 0.10 s and printed `mechanical-keyboard-65 (showcase)`, `planetary-gearbox-3-stage (showcase)`, `haunted-clockwork-lockbox (showcase)`, `deadlock-cage-dumbbell-ring (deadlock-cage)` and `deadlock-cage-ship-in-bottle (deadlock-cage)`.

**SCC witness text, verbatim from the terminal:**
```
Tarjan SCC deadlock: {dumbbell, captive_ring}
  dumbbell is blocked by captive_ring in 32 directions, e.g. (1.00, 0.00, 0.00)
  captive_ring is blocked by dumbbell in 32 directions, e.g. (1.00, 0.00, 0.00)
CI verdict: FAIL: Deadlock: 1 Tarjan SCC deadlock {dumbbell, captive_ring}.
```
```
Tarjan SCC deadlock: {bottle, ship_ball_1, ship_ball_2}
  bottle is blocked by ship_ball_1 in 32 directions, e.g. (1.00, 0.00, 0.00)
  bottle is blocked by ship_ball_2 in 32 directions, e.g. (1.00, 0.00, 0.00)
  ship_ball_1 is blocked by bottle in 32 directions, e.g. (1.00, 0.00, 0.00)
  ship_ball_1 is blocked by ship_ball_2 in 2 directions, e.g. (1.00, 0.00, 0.00)
  ship_ball_2 is blocked by bottle in 32 directions, e.g. (1.00, 0.00, 0.00)
  ship_ball_2 is blocked by ship_ball_1 in 2 directions, e.g. (-1.00, 0.00, 0.00)
CI verdict: FAIL: Deadlock: 1 Tarjan SCC deadlock {bottle, ship_ball_1, ship_ball_2}.
```
The pass line reads `CI verdict: PASS: solved in 13 steps with 0 oracle clashes.` The 32 directions are 26 canonical axes plus 6 PCA axes. The dumbbell manifest has 64 witness edges.

**Lockbox removal order, with directions from the MCP call:**

| Step | Part | Primitive | Direction | Escape distance |
|---|---|---|---|---|
| 1 | lid_fastener_2 | helical | +Y | 0.113 |
| 2 | lid_fastener_1 | helical | +Y | 0.113 |
| 3 | lid | linear | +Z, slides sideways | 0.829 |
| 4 | gear_spindle_1 | linear | +Y | 0.189 |
| 5 | box_body | linear | −Y, drops away | 0.119 |
| 6–7 | gear_spindle_3, gear_spindle_2 | linear | −Y | 0.038, 0.033 |
| 8–9 | screw_standoff_2, screw_standoff_1 | linear | ∓X | 0 |
| 10 | latch | linear | +X | 0 |
| 11 | clock_gear_1 | linear | +Y | 0.051 |
| 12–13 | clock_gear_2, clock_gear_3 | linear | +X | 0 |

**What the numbers mean** (`packages/unbolt-core/src/stage4/naiveBaseline.ts`, `apps/crew-assembly-ci/src/manifest.ts:58-61`):
- **Naive count:** each part moves alone, straight out from the assembly centroid, while every other part stays in place. The count is the number of rays from vertices and triangle centres that hit another part.
- **avoidedByPlan:** this is simply naive minus oracle. For deadlocked kits it equals the naive count even though nothing was planned.

### 1b. Diff run

No meaningful pair exists. `git ls-files` finds no `.glb` or `.gltf` files, and the CLI only accepts kit names or `.glb` paths, so the kits' size options (keyboard rows and columns) can't be reached from it.

I ran the one pair the test suite uses, only to show the output format: `--baseline haunted-clockwork-lockbox --candidate deadlock-cage-dumbbell-ring --out /tmp/diff-lockbox-vs-dumbbell.json`. It took 0.35 s and exited 1 with:
- `Baseline: haunted-clockwork-lockbox is solved`
- `CI verdict: FAIL: The candidate deadlocks (1 SCC) and the baseline did not.`

The manifest's diff section shows it is not a real PR: `removedParts` lists all 13 lockbox parts and `addedParts` is `[dumbbell, captive_ring]`.

A real baseline-vs-PR demo needs two `.glb` versions of the same assembly. Parts are matched by unique name, otherwise by Part_ID. The candidate should either add an interlock (new SCC, fails CI) or bury a part deeper (a depth regression, which is only a warning unless `--fail-on-depth-regression` is set). Making them means exporting a kit twice, once modified. `tools/cad-auditor-mcp/test/helpers/glbBuilder.ts` already builds GLBs inside tests and could be adapted in `/tmp`. I did not do this.

### 1c. Counts

| Item | Verified value | Evidence |
|---|---|---|
| Specs | 3: `unbolt-core-engine` (requirements-first, 30 requirements, 116 tasks done), `guide-forge-part-1` (fast-task, 17 requirements, 51 done), `unbolt-blitz-part-1` (fast-task, 18 requirements, 53 done) | `.kiro/specs/*/.config.kiro`, `requirements.md`, `tasks.md` |
| Duplicate spec ID | Guide Forge and Blitz both use `specId ca245e32-…` | Their `.config.kiro` files. Kiro may confuse the two specs. |
| Correctness properties | 39 | `.kiro/specs/unbolt-core-engine/design.md:815-1051`, headings `### Property 1` to `### Property 39` |
| Properties with property tests | 9. Core: P18, P20, P23 in `test/properties/`, P34–P37 in 14 `test/invariants/` files. Sample kits: P38, P39. | The 30 tasks for P1–17, 19, 21–22 and 24–33 are `[ ]*` (optional, open). design.md:819 claims each property becomes exactly one fast-check property test. |
| Steering docs | 4: `geometry-invariants`, `no-spec-gaming`, `ui-separation`, `macos-shell-guard` | `.kiro/steering/` |
| Hooks | 2. "Sync Extraction Primitive Across UnboltKit" runs on edits to `packages/unbolt-core/src/primitives/*.ts` and asks the agent to act. "Verify Core DBG Quick Suite" runs on edits to `packages/unbolt-core/src/**/*.ts` and runs the `test:quick` command. | `.kiro/hooks/*.kiro.hook`. The Crew agent JSON also has its own SessionStart hook, which is not a `.kiro` hook. |
| MCP tools | 3: `list_sample_kits`, `inspect_assembly_dbg`, `diff_repairability` | `tools/cad-auditor-mcp/src/mcp.ts:68,73,83`. `tools/list` over stdio returned all 3. I also called `inspect_assembly_dbg` from this Kiro session and the numbers matched the CLI. |
| Power files | 4: `POWER.md`, `mcp.json`, `plugin.json`, `skills/cad-audit/SKILL.md` | `powers/cad-assembly-auditor/`. The Power does not look installed in this Kiro (my resource list shows only the figma Power). The MCP server is registered through the tracked `.kiro/settings/mcp.json`. |
| Core quick tests | `Test Files 34 passed (34)`, `Tests 451 passed (451)`, `Duration 140.33s` (2:20.8 wall) | `npm --workspace=@unboltkit/core run test:quick`, run once. Matches the README. |
| Test files in all workspaces | 73 (48 + 3 + 7 + 13 + 1 + 1) | Counted with `find`. Matches the README. |
| 737 total tests | Not re-run. A commit message earlier said 716. | README value only. |
| Guide Forge spot check | 2 files, 21 passed. Keyboard pipeline `elapsed=2353ms` | `vitest run test/unit/authoring-and-export.test.ts test/unit/keyboard-solve-timing.test.ts` |

Three properties in plain English:
- **P34:** For the lockbox, the gearbox, a small 2×3 keyboard and the full keyboard, in random positions and orientations and with random seeds, every step of the plan is clash-free when the independent checker replays it. Tests: `packages/unbolt-core/test/invariants/invariant1-{lockbox,gearbox,keyboard-fixture,full-keyboard}.property.test.ts`.
- **P35:** Moving or rotating the whole assembly doesn't change the answer: same status, same step count, same parts, still clash-free. Tests: `invariant2-*.property.test.ts`.
- **P36:** Both deadlock cages are always reported as deadlocked, and the clash checker confirms every blocking edge in the witness. Tests: `invariant3-cages-dumbbell-ring.property.test.ts` and `invariant3-cages-ship-in-bottle.property.test.ts`.

A usable nugget from the `test:quick` output: `the half-turn about (-1, 1, -1) collides without verification and is clash-free with it`, and `every one of 200 seeded rigid motions gives a solved, clash-free plan` (gearbox, `test/unit/stage3-lazy-refinement.test.ts`).

### 1d. UI features as written in the source

**Guide Forge** (dev port 5173; it loads `mechanical-keyboard-65` on start, `src/kits.ts:28`)

| Feature | Exists | Exact on-screen text | Source |
|---|---|---|---|
| Naive explode button | Yes, one of two pill segments | `UnboltKit DBG` / `Naive Radial Explode`. Tooltip: "Baseline: every part flies straight out from the centre, so parts crash into each other (M)". One click sets the explode to 0.65. | `header/HeroToggle.tsx:22-25`, `state/viewSlice.ts:37` |
| Clash badge | Yes | `0 Clashes • Verified`, `{n} Clashes • {k} Obstructed Parts`, `Interlocked • No Valid Sequence`, `No plan loaded`, `Not Verified` | `state/selectors.ts:22-49` |
| Comparison card (bottom-left of viewport, solved plans only) | Yes | `UnboltKit DBG` `0 clashes (Verified)` vs `Naive Explode` `12618 clashes (13/13 parts obstructed)`. No thousands separator. | `viewport/ComparisonCard.tsx`, `state/selectors.ts:~455-490` |
| Interlock banner | Yes | `Unsolvable Interlock Detected`, `2 parts locked in 1 interlock cycle • 0 steps peeled before the deadlock`, `Dumbbell → Captive ring (32 directions)`. The arrow means "is blocked by". | `panels/InterlockBanner.tsx:31-60` |
| Status callout | Yes | `Verified` "0 clashes across 13 steps (independent clash check)." / `Interlocked` "No valid removal sequence. 2 parts are locked." / `Obstructed` "Naive radial explode: …" | `panels/StatusCallout.tsx` |
| Locked parts list | Yes | `Locked Parts` heading; rows tagged `Interlocked` or `Unassigned` | `panels/LockedParts.tsx:21` |
| BOM strip | Yes | `Parts` / `Helical` / `Linear` (`Other` only if another primitive is used) | `panels/BomSummary.tsx:21-29` |
| Steps list | Yes | Heading `Steps` (`Peeled Steps` when deadlocked); each row shows number, name, primitive badge, `escape 0.113`. In naive mode rows add `N clashes` and `Obstructed`. | `panels/StepRow.tsx`, `panels/ManifestPanel.tsx` |
| Step authoring | Yes | `Step Notes · Step N: Name`. Tool chips `M2.5 Hex`, `PH0 Driver`, `Spudger`, `Tweezers`. `Torque` (placeholder "1.8 Nm"), `Subassembly`. Warning chips `ESD Safe`, `Spring Tension`, `Delicate`. `Note`, `Mark Flexible`, `Clear notes`. | `authoring/StepAuthoringPanel.tsx:19-20` |
| Caption bar | Yes | `Step 1 of 13`, then e.g. "Unscrew Lid fastener 2 counter-clockwise until it lifts free." or "Lift Lid straight out along the arrow." Button `Read Aloud: Off/On` (browser speech). | `authoring/StepCaptionBar.tsx`, `authoring/stepText.ts` |
| Playback | Yes | `Prev K`, `Play Space` / `Pause`, speeds `1×` `3×` `8×` (1 step per second at 1x), `Next J`. Track label `Step timeline` (DBG) or `Explode` (Naive). | `viewport/ViewportToolbar.tsx`, `motion/playback.ts:12` |
| Viewport pills | Yes | Camera `Iso` `Front` `Top` `Fit`; view `All` `Hide Removed` `Ghost`. There is no Bottom view. | `viewport/ViewportToolbar.tsx` |
| Leader line | Yes | Spline with an arrow cone and a `Step N` label | `viewport/sceneController.ts:1121-1122` |
| Pipeline telemetry | Yes | While solving: `Stage 2: Building Swept-Ray DBG...` and similar. Done: `Pipeline · 2.3s` pill, which opens a 7-stage list with ms per stage and `Total`. | `feedback/ProgressStrip.tsx:125`, `state/selectors.ts:363` |
| Keyboard shortcuts | Yes | Legend: `J / →` next step, `K / ←` previous step, `Space` play / pause, `M` DBG / Naive, `1 2 3 F` Iso / Front / Top / Fit | `authoring/useKeyboardShortcuts.ts:41-47` |
| Export manual | Yes. 20 Node tests pass, including one that the HTML has no external URLs or scripts. Snapshot capture in a real browser is not verified. | Button `Export HTML`; toast `Manual exported: haunted-clockwork-lockbox-manual.html`; HTML sections `Overview`, `Tools required`, `Bill of materials`, `Step-by-step`; footer "Generated by Guide Forge. This file is self-contained and works offline." | `header/ExportManualButton.tsx:76`, `export/manualExporter.ts:96-103,453-474` |
| Recovery states | Yes | `This model is one connected island`, `The file could not be read`, `This file type is not supported`, `The file holds no triangles`, `The solver stopped with an error`. Buttons `Load sample kit` / `Choose another file`. Oversized models get a non-blocking notice: `Large model: sampled solve`. Also `WebGL is unavailable`, `The 3D view stopped because of an error`, and the drop overlay "Drop a .glb or .gltf file to load it". | `state/recovery.ts:32-180`, `viewport/DropZone.tsx:12` |

**Unbolt Blitz** (dev port 5174; it loads the Lockbox on start, `src/levels.ts:21`)

| Feature | Exists | Exact on-screen text | Source |
|---|---|---|---|
| Turntable | Yes, static (no spin, no auto-rotate). You orbit by dragging. | Slate platter with an engraved brass degree dial | `viewport/pedestal.ts`, `viewport/Arena.ts` |
| HUD, top-left | Yes | `Stage 1 · Haunted Clockwork Lockbox ▾`, `Campaign (0/15 ★)`, upload icon, `♪ Sound (M)` / `Muted (M)` | `hud/LevelSelector.tsx`, `hud/CampaignDrawer.tsx`, `hud/SoundToggle.tsx:20` |
| HUD, top-centre and right | Yes | Stopwatch `m:ss.t`; `Score` with combo badge `x1`–`x8` (colour changes with tier); a parts-removed bar; counters `Mistakes` and `False alarms` | `hud/Stopwatch.tsx`, `hud/ScoreCombo.tsx`, `hud/Counters.tsx` |
| Feedback | Yes | `+150` popups, `+3s`, `FALSE ALARM -250`, `BLOCKED BY: A, B` (shown 3 s), hover name pill, brass hover glow, crimson blocker flash, teal burst on removal | `hud/hudModel.ts:17,75`, `viewport/effects.ts`, `viewport/highlights.ts` |
| Trap lever | Yes | `Flag Interlock Trap`; it shakes after a false alarm | `hud/TrapLever.tsx:35` |
| Level list | Yes (campaign drawer) | `Clockwork Campaign`. 1 `Haunted Clockwork Lockbox` (Apprentice), 2 `Dumbbell & Captive Ring` (Deadlock Inspection), 3 `3-Stage Planetary Gearbox` (Journeyman), 4 `Ship in a Bottle` (Deadlock Inspection), 5 `65% Mechanical Keyboard` (Grandmaster Blitz). Buttons `Launch` / `Play again` / `Restart`, `Upload Custom .glb`, `Close`. | `modules/campaignStore.ts:31-63` |
| Scoring | Yes | 100 × combo (before it increases) per removal, +50 per fastener, combo caps at x8. Correct trap flag +1000. False alarm −250 (score never below 0) plus 3 s. Blocked click: +3 s, combo resets, +1 mistake. | `game/scoring.ts:11-21` |
| Ghost hints (Part 2) | Yes | `Hint (H)`; "HINT: Unbolt Lid Fastener 2. It slides up."; "HINT: Nothing can move. This is an interlock. Pull the Flag Interlock Trap lever."; "Hints used this run: N. Each hint costs the 3-star rating." | `modules/ghostHint.ts:115-120`, `hud/HintControls.tsx` |
| Audio (Part 2) | Yes. Sounds are generated live with Web Audio, no audio files. Mute is saved in localStorage. | | `modules/soundModule.ts` |
| Stars (Part 2) | Yes | 3 stars: clean run, no hints. 2 stars: 2 or fewer slips. Otherwise 1. 15 stars total. | `modules/campaignStore.ts:5,84-85` |
| Win screens | Yes | `Victory` or `Interlock Exposed!`, star row, `NEW BEST!`, `Score` / `Time` / `Mistakes` / `False alarms`, `Next Stage →`, `Replay (R)`, `Choose level` | `hud/CompletionOverlay.tsx`, `hud/hudModel.ts:151` |
| Lose screen | **No** | None exists | |
| Recovery | Yes | `Single solid piece`, `No playable geometry`, `Unsupported file type`, `Something jammed the gears`. Buttons `Load Lockbox` / `Try another file`. Oversized models get a non-blocking notice: `OVER BUDGET: N triangles (budget 150,000). …` with `Dismiss`. | `recovery/recoveryCopy.ts`, `recovery/RecoveryScreen.tsx:41`, `hud/hudModel.ts:215` |
| Shortcuts | Yes | `H` hint, `M` mute, `R` replay (only after a level ends) | `hud/shortcuts.ts` |

**Crew dashboard** (`apps/crew-assembly-ci/ui/src/App.tsx`)
- **Header:** title `Assembly CI` with "{kit} audited {date} ({mode} mode)", a `Sample preview` badge and a `Reload` button (lines 265-269).
- **Stat cards:** `CI verdict` PASS/FAIL, `Assembly status`, `Max repairability depth`, `Clashes avoided` (lines 288-291).
- **Cards:** `Verdict`; `Deadlock cycle N` with "Tarjan SCC: none of these parts can move first." (line 147); `Repairability depth` or `Repairability depth diff`; `Naive radial explode vs DBG plan` as red and green bars (line 340).
- **Outside a host** it shows invented sample data (`ui/src/sample.ts`): a 6-part "assemblies/dumbbell-ring.glb" diff.

### 1e. Motion primitives per kit

| Kit | helical_unscrew | linear_slide | two_step_l_slide | Screw turns (pitch 0.01) | Visible on camera? |
|---|---|---|---|---|---|
| Lockbox | 2 (steps 1–2, up through the lid) | 11 | 0 | 11.3 each | **Best.** Screws on top of the lid, visible in Iso. |
| Gearbox | 4 (steps 1–4, up through the cover) | 21 | 0 | 6.2–6.8 | Good. Top of a 520 mm-wide housing, so the screws look small. |
| Keyboard | 6 (steps 1–6, **downward** out of the case bottom) | 140 | 0 | 3.7–4.2 | Poor. Hidden under the case in Iso/Front/Top; you'd have to orbit underneath. |
| Cages | 0 | 0 | 0 | – | – |

---

## 2. Shot inventory (25 shots, ★ = top 6)

Timings are Node measurements standing in for browser times; I did not measure solves in a browser. Guide Forge shows the real solve time in its `Pipeline · …` pill. Playback time is steps divided by speed (1, 3 or 8 steps per second).

| # | Shot | Click path | Real time | Why it's strong | Risk |
|---|---|---|---|---|---|
| ★1 | Guide Forge: plan vs naive on the Lockbox | :5173 → `Kit` ▾ → Showcase → `Haunted Clockwork Lockbox` → wait for the `Pipeline · …` pill → click `Naive Radial Explode` (or M), then drag `Explode` from 0 to 1 → click `UnboltKit DBG` | Solve about 0.3 s; toggle is instant | Parts plough into each other. The badge flips from `0 Clashes • Verified` to `12618 Clashes • 13 Obstructed Parts`, and the comparison card puts both numbers side by side. | Numbers have no commas and the text is small (12px), so zoom in post. WebGL capture. |
| ★2 | Guide Forge: Lockbox walkthrough | DBG mode → `Hide Removed` → `Play` at `1×` | 13 s at 1×, 4.3 s at 3× | Leader arrow with `Step N` label, caption "Unscrew Lid fastener 2 counter-clockwise…", the manifest row highlights as it plays | Screw spin strobes (11 turns in 1 s). Lid slides sideways and body drops away leaving gears floating. Parts with 0 escape distance don't move. |
| 3 | Guide Forge: live solve progress | Reload the page; the keyboard auto-solves | About 2.3 s | `Stage 2: Building Swept-Ray DBG...` chip and a moving progress bar | Over in about 2 s; use slow motion. |
| 4 | Guide Forge: stage timing breakdown | Click `Pipeline · 2.3s` | Instant | Seven stages with ms per stage and `Total` | Small text; times change run to run. |
| 5 | Guide Forge: keyboard at scale | Default kit → `8×` → `Play` | 18 s at 8× (146 steps) | BOM `146 / 6 / 140`; card `54264 clashes (140/146 parts obstructed)` | Floating keys after steps 8–11; screws hidden underneath. |
| 6 | Guide Forge: gearbox | Kit → `Planetary Gearbox (3-Stage)` → `3×` → Play | Solve 0.8 s; play 8.3 s | 4 fasteners unscrew from the top; naive 60681 (25/25) | Wide, flat model, so parts look small. Use `Fit`. |
| 7 | Guide Forge: deadlock | Kit → Deadlock Cage → `Deadlock Cage: Dumbbell and Ring` | About 0.1 s | Badge `Interlocked • No Valid Sequence`, banner `Unsolvable Interlock Detected` with blocking pairs, `Locked Parts` list, clicking a part focuses the camera | Static shot. Narrate "is blocked by" rather than reading out the arrow. |
| 8 | Guide Forge: deadlock in naive mode | In shot 7, press M | Instant | Parts collide, `2592 Clashes • 2 Obstructed Parts` | – |
| 9 | Guide Forge: Ship in a Bottle | Kit → `Deadlock Cage: Ship in a Bottle` | About 0.15 s | 3-part cycle; the balls block each other in 2 directions | The "ship" is two metal balls. |
| 10 | Guide Forge: authoring | Select a step → `Step Notes` → `M2.5 Hex`, Torque `1.8 Nm`, `ESD Safe` | Real time | Caption tags update live | Text-heavy. |
| ★11 | Guide Forge: offline manual | `Export HTML` → toast → open the downloaded file with Wi-Fi off | About 2 s | Self-contained manual with checkboxes and step navigation | Snapshot capture untested in a browser (fallback toast "Manual exported without 3D snapshots…"); browser download prompt. |
| 12 | Guide Forge: view and camera pills | `Ghost`, `Hide Removed`, `Iso`/`Front`/`Top`/`Fit` | Real time | Shows the interior after removals | – |
| 13 | Guide Forge: recovery | Drop a `.png` → "This file type is not supported"; drop a one-mesh `.glb` → "This model is one connected island" | Instant | Errors are handled clearly | A one-mesh `.glb` must be made first. |
| ★14 | Blitz: core game loop | :5174 (Lockbox auto-loads with "Loading …") → hover → click a Lid Fastener → click Box Body | Solve about 0.3 s; each exit 0.6 s | Legal unscrew gives teal burst and `+150`. The blocked click gives a shudder, crimson spark, `BLOCKED BY: …`, `+3s`, combo back to `x1`. | Screw spin about 19 turns/s; small screws. Get the blocker names from a rehearsal. |
| 15 | Blitz: combo ladder | Chain legal removals | About 15 s | Badge colour climbs to `x8` | – |
| ★16 | Blitz: interlock trap | `Campaign` → stage 2 `Dumbbell & Captive Ring` → `Launch` → click a part (blocked) → H → pull `Flag Interlock Trap` | About 10 s | Hint banner, then `Interlock Exposed!`, +1000, pulsing highlight, stars | Earned stars stay in localStorage, so use a fresh browser profile. |
| 17 | Blitz: false alarm | On the Lockbox, pull the lever | Instant | Lever shakes, `FALSE ALARM -250` | – |
| 18 | Blitz: ghost hint | On the Lockbox, press H | About 6 s banner | Ghost preview of the move plus "HINT: Unbolt … It slides up." | Costs the 3-star rating. |
| 19 | Blitz: victory | Finish the Lockbox | About 20–40 s of play | `Victory`, stars, `NEW BEST!`, `Next Stage →` | – |
| 20 | Blitz: campaign drawer | Click `Campaign (0/15 ★)` | Instant | Five stages with difficulty badges | – |
| 21 | Blitz: recovery | Drop a `.png`, or a one-mesh `.glb` | Instant | "Single solid piece" with `Load Lockbox` / `Try another file` | Needs test files. |
| ★22 | Terminal: CI pass then fail | `node apps/crew-assembly-ci/scripts/run-audit.mjs --kit haunted-clockwork-lockbox --out /tmp/a.json`, then the same with `deadlock-cage-dumbbell-ring` | 0.33 s and 0.13 s | Readable PASS, then FAIL with the Tarjan witness; exit codes 0 and 1 | Use a large font. Always pass `--out`, or it writes into the current folder. |
| 23 | Kiro chat: MCP tool call | Ask "Use cad-assembly-auditor to inspect deadlock-cage-dumbbell-ring" | Tool under 1 s | Tool-call card, then the agent explains the cycle | Agent wording varies. The ship-in-bottle result is about 40 KB of JSON. Possible approval prompt. |
| 24 | Kiro: hook firing on save | Edit and save any `packages/unbolt-core/src/*.ts` → "Verify Core DBG Quick Suite" runs | 2:20 | Ends on `Tests 451 passed (451)` | Changes a tracked file (revert it afterwards); cut or time-lapse the run. |
| 25 | Kiro IDE: spec and steering | Open `design.md` at `## Correctness Properties` (line 815), `tasks.md`, the `.kiro/steering/*.md` files, and the hooks panel | Static | Shows the spec-driven workflow | Dense text; scroll slowly. |

The Crew dashboard is not in the list because it can't be recorded without a host. Use shot 22 with the manifest JSON, plus `app.json` and `agents/assembly-auditor.json` open in the IDE.

---

## 3. Recording feasibility

| Item | Result |
|---|---|
| ffmpeg | `/opt/homebrew/bin/ffmpeg`, `ffmpeg version 9.0.1`. Screen device: `[2] Capture screen 0`. Audio devices are microphones only, with no loopback, so ffmpeg can't record the Blitz synth or Read Aloud. |
| Other recorders | `OBS.app` (its macOS Screen Capture source can include app audio, not tested here), QuickTime Player, Screenshot.app, and `/usr/sbin/screencapture` (built in, `-v` records video) |
| Playwright | `npx --no-install playwright --version` → "npx canceled due to missing packages … playwright@1.65.1". Not installed. Old browser builds exist in `~/Library/Caches/ms-playwright` (`chromium-1254`, `chromium-1255`, `ffmpeg-1013`). |
| HyperFrames | Not installed (`npx` would download `hyperframes@0.9.81`) |
| Browsers | Chrome, Brave, Safari |
| Display | Apple M4, built-in Retina panel 2560×1664, scaled to **1470×956 @ 60 Hz** (2940×1912 actual pixels). The screen is about 1.54:1, so for 16:9 size the browser window to 1470×827 points or crop later. |
| Builds | Both `apps/guide-forge/dist` and `apps/unbolt-blitz/dist` exist (gitignored) but are older than the last commit. Rebuild with `npm --workspace=@unboltkit/<app> run build` (`tsc --noEmit && vite build`). |
| Serving the builds | Both apps have `"preview": "vite preview"`. Neither `vite.config.ts` sets a preview port, so Vite's default 4173 applies and the second app moves to the next free port. Dev servers use 5173 and 5174 (`server.port`). |
| Before recording | Turn off macOS Reduce Motion: Guide Forge disables Play ("Autoplay is off (reduced motion)") and Blitz shortens exits to 150 ms. Use a fresh browser profile for Blitz (stars and mute are saved locally). Record at 60 fps for the screw shots. |

---

## 4. Claims ledger

| Claim the narration might make | Verified value | Evidence | Safe phrasing |
|---|---|---|---|
| Naive explode drives parts through each other | Lockbox 12,618 (13/13 parts), gearbox 60,681 (25/25), keyboard 54,264 (140/146) | Audits in 1a | "A naive radial explode drives every lockbox part into another part: 12,618 colliding ray samples." |
| UnboltKit's plan has zero clashes | Oracle 0 on all three solved kits | Audits, MCP | "An independent checker replays every step and finds 0 clashes." |
| "Mathematically verified" (README headline) | Sampling check of straight-line moves | `naiveBaseline.ts`, design P23 | **Not safe.** Say "independently checked". |
| Solves in N steps | 13 / 25 / 146 | Audits | Use as is. |
| It's fast | 0.33 s lockbox, 2.3 s for the 146-part keyboard (Node, M4) | `time`, Guide Forge timing test | "Seconds, not hours. The 146-part keyboard solves in about 2 seconds." |
| Explains deadlocks | Witness text in 1a | CLI, Guide Forge banner | "It names the parts that lock each other and every blocked direction." |
| Deadlock kit: oracle 0, 2,592 avoided | Nothing was planned or replayed | `manifest.ts:61` | **Not safe.** Use only the naive count for the cages. |
| Proves something can't be disassembled | Only straight-line moves along 32 directions are searched | `peelSolver.ts` | **Not safe in general.** For the cages: "the ring is truly captive, and UnboltKit shows why". |
| Three motion primitives | 3 exist in code; plans only ever use 2 | `peelSolver.ts:302`, `registry.ts` | "Unscrews fasteners and slides parts out." Don't mention L-slides. |
| 39 correctness properties | 39 specified, 9 with property tests | `design.md`, `tasks.md` | "A spec with 39 correctness properties; the key invariants run as seeded property tests." |
| 737 tests | Not re-run; 73 files counted; 451 core quick tests passed | `test:quick` | "Over 700 tests" (cite the README) or "451 core tests pass in 2 minutes 20". |
| Ignores part names | Fastener detection uses part shape (bounding-box proportions); names only shown in the UI | `trajectoryCompiler.ts` | "It reads geometry only." |
| CI and the agent agree | MCP and CLI numbers match | Ship-in-bottle and lockbox runs | Use as is. |
| Solver runs in a Web Worker | `new Worker(...)` in both apps | Both `solver/solverClient.ts` | Use as is. |
| Deterministic | 0 uses of `Math.random` in core source | `grep` | Use as is. |
| Clash checker is independent | Shares types, config, errors and math helpers; none of the solver's sampling or ray casting | `test/static/clash-independence.test.ts` | "A separate checker that shares none of the solver's ray-casting code." |
| Order a technician would follow | Parts float; the box body comes off 5th | Lockbox order in 1a | **Not safe.** |
| Kiro Crew app with dashboard | Files exist; no host here; sample data is invented | `ui/dist` imports | "Packaged as a Kiro Crew app." **Not safe** to show dashboard numbers as real. |
| Kiro Power | 4 files; not installed in this Kiro | `powers/` | "Ships as a Kiro Power." |
| Hook runs the core tests on save | Yes, 140 s | Hook JSON, `test:quick` | Use as is. |
| Agent hook keeps primitives in sync across apps | Configured, never exercised | Hook JSON | "A hook asks the agent to sync…", only claim results you record. |
| Blitz has hints, procedural audio and stars | Implemented and tested (`test/modules/part2.test.ts`); outside the Part 1 spec | Source | "Built on the Part 1 extension points." Don't call them spec-driven. |
| Playable on mute | Every cue has text | Source | Use as is. |
| Handles bad uploads | One-piece model → recovery screen; oversized → warning notice | `recovery.ts`, `OverBudgetNotice.tsx` | "Explains a one-piece model and warns on oversized ones." |
| Spinning turntable | Static platter | `pedestal.ts`, no auto-rotate | "A watchmaker's turntable." |
| Real PR diff | Only the contrived kit pair | 1b | **Not safe** without two real `.glb` files. |
| Lazy verification catches sampling misses | Test name in the passing quick suite | `stage3-lazy-refinement.test.ts` | "On a rotated gearbox the sampled graph alone would plan a clash; the exact check fixes it." |

**Where the README doesn't match what I measured:**
1. The headline says "mathematically verified". That is an overclaim.
2. The README table shows a bold **0** oracle count for the dumbbell cage. Nothing was replayed, so that 0 means nothing.
3. Stage 4 lists `two_step_l_slide` as compiled. No plan ever uses it.
4. It says to create `.kiro/settings/mcp.json`, but the file is already tracked.
5. "Kiroween 2026 entry" doesn't match the folder name "Kiroween 2027".
6. It says both apps show "a recovery state" for oversized files. For oversized files it is a non-blocking warning, not a recovery screen.
7. design.md:819 says each property becomes one property test. 9 of 39 do.

**Everything else matched:** part counts, steps, clash numbers, witness text, exit codes, the 34-file / 451-test quick suite, and the 73 test files.