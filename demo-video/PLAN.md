# UnboltKit demo film: "Nothing Walks Through Walls"

This is plan v2. It applies the fixes from the red team, which ran as two independent critics: one judge panel and one claim auditor. Nothing has been recorded or built yet.

Related files:
- `SCRIPT.md`: the voiceover.
- `STORYLINES.md`: the alternatives considered.
- `research/`: the swarm's evidence.

## 1. The one thing

- **What it is:** UnboltKit works out an order to take a 3D product apart where nothing collides, using only the mesh. When no such order exists, it names the parts that lock each other in.
- **What a judge repeats to another judge:** "It's the one where exploded views drag parts through walls, 12,618 clashes. UnboltKit finds a zero-clash teardown from the mesh alone, Kiro's spec, steering and hooks keep it honest, and the Kiro Crew app fails a change that traps a part."
- **Spine:** one haunted lockbox, from the bug to the manual, then to the game, then to Kiro, then to the gate.
- **The data that travels:** the number `12618` (the hook) becomes `0` (the flip), and then a named cycle (the deadlock).

### Device: horror-film survival rules

Five engraved plates. Each one is a real invariant of the product, or of how the product was built.

| Plate | What it stands for |
|---|---|
| 1. NOTHING WALKS THROUGH WALLS | zero clashes |
| 2. NEVER GO IN ALONE | an independent second checker |
| 3. NAME WHAT HOLDS YOU | the Tarjan SCC deadlock witness |
| 4. NEVER FAKE A PASS | Kiro steering, specs and property tests |
| 5. NEVER LET IT IN | the Kiro Crew audit gate (the vampire rule) |

The twist comes at 1:36: "The solver can't cheat. Neither can the Kiro agent that helped build it."

### Form

One object carried across worlds by match cuts:
- **Day:** Guide Forge (light blueprint).
- **Night:** Unbolt Blitz (obsidian and brass).
- **The workshop:** the Kiro IDE.
- **The gate:** the terminal and the Crew app.

## 2. Judging deadlines and caps

The runtime target is 2:51, with a hard cap of 2:55. The judges are not required to watch past 3:00.

| Must land | By | Here |
|---|---|---|
| A part visibly passing through a wall | 0:02 | S1 |
| 12,618 spoken and on screen | 0:15 | S2 |
| Who it is for, and that the pain recurs ("every product revision") | 0:25 | S3 |
| Flip to `0 Clashes • Verified` | 0:30 | S4 (0:25) |
| The name, plus "built with Kiro" on screen | 0:30 | S4 lower third |
| The second app | 1:25 | S10 (1:16) |
| All Kiro proofs | 2:30 | S11–S14 |
| Kiro content of 50–65 s in total | | about 65 s (S11–S15) |
| No essential content after 2:55 | | ends at 2:51 |

**Never** do any of these:
- say "mathematically verified", "proven", "exactly" or "the way physics allows";
- present the lockbox-to-cage diff as a pull request;
- show the Crew dashboard's built-in sample data;
- show red Vitest RPC errors;
- claim L-slides, "how a technician would do it", or "39 properties across 3 specs" (the real figure is 87).

## 2b. Lessons applied from the 2025 Grand Prize demo (InteractionKit)

Full breakdown: `research/reference-interactionkit.md`. It was a Skeleton Crew entry, our category.

1. **Picture follows the word.** In S11–S15 every Kiro feature is named, and then its real Kiro IDE panel fills the frame. The zoom lands within 1 s of the keyword. The reference showed these panels:

   | Feature | Panel |
   |---|---|
   | Steering | AGENT STEERING |
   | Specs | Specs |
   | Hooks | AGENT HOOKS, including the hook form with its trigger |
   | MCP | MCP SERVERS, showing `cad-assembly-auditor` Connected (3 tools) |

2. **Screen Studio grammar on every screen shot.**
   - Record raw at 2× pixels.
   - In HyperFrames, add 2–2.5× punch-ins onto the panel under the cursor.
   - Moves take 0.2–0.3 s with motion blur, then a slow 1.00→1.04 drift while holding.
   - Enlarge the cursor.
   - Place app windows on a padded ground with rounded corners and a shadow: blueprint grid by day, obsidian by night.
3. **A map of the Kiro features.** A thin progress rail runs along the top through S11–S15: `Steering · Specs · Property tests · Hooks · Power + MCP · Crew`. The current feature is lit in brass. Every frame a judge samples shows which Kiro feature is on screen, and no slide is needed.
4. **One live-action shot (optional; you film it on a phone).** A real hand on the trackpad playing Unbolt Blitz, 2–3 s at the start of S10. Optionally also real hands prying at a real device for 2 s under S3. The reference gave its live shot 10 s with no narration.
5. **A true origin line.** If you have a real reason you built this, it replaces the generic S3 line. It must be true, never invented.
6. **The end card's call to action names GitHub.** Show the GitHub mark, the repo URL and "Check out UnboltKit on GitHub", held 4 s.
7. **Optional:** a second ElevenLabs voice for the Kiro section (S11–S15), so the chapter change is audible. The reference alternated two narrators.

These we don't copy: a logo on frame 0, a 30 s static open, checkmark slides, a 15 s end card, Kiro's docs website as filler, and third-party videos. The 2025 rubric had no Presentation criterion; the 2026 rubric scores it at 20%.

## 3. Beat sheet

Text on screen is at most 6 words and never repeats the voiceover.

Plates are blackened steel #161A23 with a brass bevel #8A5F1C, set in Roboto Slab 700 caps. Each one stamps in over 4 frames and leaves using one of the engine's own motions: it unscrews, or slides out along an axis. Each plate exits differently, so the device doesn't become one move repeated.

Criteria codes in the Scores column:

| Code | Criterion |
|---|---|
| 1 | Impact |
| 2 | Kiro |
| 3 | Design |
| 4 | Innovation |
| 5 | Presentation |
| SC | Skeleton Crew |
| KC | Kiro Crew |
| H | Halloween |

| # | Time | Beat | On screen (real UI unless marked BUILD) | On-screen text | Sound | Scores |
|---|---|---|---|---|---|---|
| S1 | 0:00–0:04 | Sighting (hook, thumbnail) | Guide Forge, Haunted Clockwork Lockbox, `Naive Radial Explode` on, slider at about 35%. A 2× punch-in framed so the face of the box wall visibly cuts across a brass gear's teeth, with the gear in crimson. The gear keeps sliding at 1×. No cursor. The plate stays clear of the crossing. | Plate `RULE 1 · NOTHING WALKS THROUGH WALLS` | Escapement tick at 60 bpm. The crossing itself is silent. Whisper. | 5, 1, H |
| S2 | 0:04–0:14 | The haunting | Pull back 0.5 s to the full window. The cursor drags the slider to 100%. Punch-in on the real badge `12618 Clashes • 13 Obstructed Parts`. Check that the 100% frame really shows the crossings. | `13 of 13 parts obstructed` | Low bowed drone, one low pop on the badge | 1, 5 |
| S3 | 0:14–0:25 | Who it hurts | The cursor hovers the `Naive Radial Explode` pill and the native tooltip appears (test that the capture shows it, otherwise skip it). Slow push into the buried parts. | `For manual writers and repair techs` | Tick and drone | 1 |
| S4 | 0:25–0:37 | Reveal | On the words "Unbolt Kit", click `UnboltKit DBG`. The parts fly home and the badge reads `0 Clashes • Verified`. Then `Hide Removed`, Play at `3×`: both lid fasteners unscrew, the lid slides out, and the Steps panel ticks 1→13. Record at 60 fps (each screw turns 11 times per step). A title plate morphs out of the pill. | `UnboltKit`, then lower third `Built spec-first in Kiro` | Real click. The bed enters on the click. Ratchet on each unscrew (2 takes). | 3, 4, 5 |
| S5 | 0:37–0:46 | How it knows | BUILD from real data. Freeze on `lid_fastener_1`. A star of 32 arrows grows (26 cube axes plus 6 axes of the part's own shape), rays dart out, and blocked arrows turn crimson with the blocker's name. The parts then lift into a small "who blocks whom" graph. Every colour comes from the exported stage-2 edges. | `Directional blocking graph` | Soft ticks per arrow group | 4, 5 |
| S6 | 0:46–0:52 | Rule 2 | Punch-in on `Verified`. One 3 s receipt in the Kiro editor: `test/static/clash-independence.test.ts`, with its no-shared-code assertion highlighted and the test passing. | Plate `RULE 2 · NEVER GO IN ALONE` | Low brass hit on the pass | 4, 2, 5 |
| S7 | 0:52–1:00 | The artifact | Step Notes: `M2.5 Hex`, `ESD Safe`, then `Export HTML`. The toast `Manual exported: …` appears. Cut to the offline manual in a browser tab and scroll its steps. | none | Key ticks, one click | 1, 3 |
| S7b | optional, +6 s | Not tuned to our kits | Drop in a public CAD `.glb` (gate G4). It solves live and shows the real badge. | `Public CAD model · <credit>` | | 1, 5 |
| S8 | 1:00–1:13 | Rule 3: the curse | The kit selector stays visible for 0.5 s on `Deadlock Cage: Dumbbell and Ring`. The badge reads `Interlocked • No Valid Sequence`, and the banner shows `Unsolvable Interlock Detected` and `Dumbbell → Captive ring (32 directions)`. Click the banner button `Captive ring`, and the camera flies to the ring. | Plate `RULE 3 · NAME WHAT HOLDS YOU`, then `Tarjan SCC deadlock witness` | The tick slows and stops dead on the banner, then 1 s of silence | 4, 1, H |
| S9 | 1:13–1:16 | Nightfall | Match cut to the same ring at the same screen spot, now on Blitz's brass dial (HUD `Stage 2 · Dumbbell & Captive Ring`). The ground flips from #F6F8FB to #0D0F14. Keep the campaign drawer's subtitles off camera. Show a 1.5 s repo tree on the seam: `packages/unbolt-core` labelled "engine", and `apps/guide-forge` + `apps/unbolt-blitz` labelled "two apps". | `Same engine underneath` | Whoosh. The bed doubles to 120 bpm. | SC, 3 |
| S10 | 1:16–1:36 | Night shift | Optional opener: 2 s of phone footage of a real hand on the trackpad playing Blitz, then a cut to the screen capture. Blitz, Lockbox, in a rehearsed order: (1) unscrew `Lid Fastener 2`, `+150`, combo x2; (2) click `Lid`, which shows crimson flash, `BLOCKED BY: …` (confirm the text in rehearsal), `+3s`, and combo x2→x1; (3) unscrew `Lid Fastener 1`, `+150`; (4) remove `Lid`, `+200`. Hard cut to the Dumbbell cage: pull `Flag Interlock Trap`. The Score jumps 0→1000 (there is no +1000 popup) and the `Interlock Exposed!` plate holds 1.5 s. | `Unbolt Blitz` (name card, once) | Clank on the block, rotated pops, lever ratchet. The film's only riser lands on `Interlock Exposed!`, with no voice. | SC, 3, 4, 5 |
| S11 | 1:36–1:46 | Rule 4: the twist | The plate stamps over the Blitz plate and becomes the Kiro tab `.kiro/steering/no-spec-gaming.md`. Highlight "Never hardcode part IDs…" and "Never swallow exceptions silently". The explorer shows all 4 steering docs. On the word "steering", zoom into the AGENT STEERING panel. The Kiro progress rail appears here and stays through S15. | Plate `RULE 4 · NEVER FAKE A PASS`, lower third `Kiro steering · binds the agent` | The music drops to the bare tick | 2, 4 |
| S12a | 1:46–1:50 | The specs | Kiro Specs panel with 3 specs. `design.md` fast-scrolls through the property headings and stops on "Property 35: Invariant 2, solving is invariant under rigid motion". | `3 specs · 87 properties` | One tick per cut | 2 |
| S12b | 1:50–2:06 | The catch | The Kiro editor shows the docstring of `stage3-lazy-refinement.test.ts` ("The first Invariant 2 counterexample of the gearbox…"). BUILD from real data: the gearbox in the test's half-turn pose, with ring gear 3's teeth driving into two planet gears in crimson. Then Req 14.11 text. Then the test runs green: "…collides without verification and is clash-free with it", and "every one of 200 seeded rigid motions gives a solved, clash-free plan". | `Property test found this`, then `Spec grew: Req 14.11`, then `200 seeded poses · 0 clashes` | Low hit on the collision. The music bed returns on green. | 2, 4, 5 |
| S13 | 2:06–2:18 | Tripwires | On the word "hook", zoom into the AGENT HOOKS panel, then the hook's form (trigger and file pattern). Save a core file. The `Verify Core DBG Quick Suite` hook runs and ends on `Test Files 34 passed · Tests 451 passed` (a labelled time-lapse of 2:20 real time). The second sentence is used only if recorded: make a primitive edit that really needs consumer changes, and the `Sync Extraction Primitive Across UnboltKit` agent edits files in Guide Forge and Blitz. | `Shell hook · no agent credits` | Key click on Cmd-S, pop on pass | 2, SC |
| S14 | 2:18–2:29 | Ask the engine | On "Power over MCP", 1.5 s on the MCP SERVERS panel showing `cad-assembly-auditor` Connected (3 tools). Then Kiro chat with the CAD Assembly Auditor Power active. **With G3:** "Did this change trap a part in the lockbox?" brings up the `diff_repairability` tool card, which names the new cycle. **Without G3:** "Is the ship-in-bottle kit cursed?" brings up `inspect_assembly_dbg` → `deadlocked`, `{bottle, ship_ball_1, ship_ball_2}`. | `Kiro Power · 3 MCP tools` (+ `Ship-in-bottle kit · 3-part curse` without G3) | Key ticks, pop on the tool card | 2, 4 |
| S15 | 2:29–2:41 | Rule 5 | 2 s on `apps/crew-assembly-ci` (`app.json`, the agent, the skill). The Crew agent session's SessionStart hook lists the changed lockbox `.glb`. `run-audit.mjs --baseline … --candidate … ; echo "exit $?"` prints the new SCC, `CI verdict: FAIL`, `exit 1`. Show the Crew dashboard only with a real host and a real manifest (G5). Otherwise show the terminal plus `disassembly-manifest.json`. | Plate `RULE 5 · NEVER LET IT IN`, lower third `Kiro Crew app · Assembly CI`, then `exit 1` | The tick stops dead on FAIL, dull clank | KC, 2, 1, H |
| S16 | 2:41–2:52 | Claim and end card | Guide Forge, the lockbox at 1× in DBG with `0 Clashes • Verified`. The Rule 1 plate lands at the centre, its two screws unscrew, and it lifts away along +Y to reveal the wordmark, `Guide Forge · Unbolt Blitz · Assembly CI`, `Built with Kiro`, the GitHub mark, "Check out UnboltKit on GitHub" and the repo URL. Hold 4 s. | `UnboltKit · Built with Kiro · <repo URL>` | The bed resolves on a bar line, one last tick | 5 |

## 4. Criteria coverage

| Criterion | Where | Why it scores |
|---|---|---|
| Impact | S2, S3, S7, S8, S15 | The pain is real, measured and recurring ("every product revision"). There are two audiences: manual writers and hardware teams. The output is a real artifact (the offline manual), and there is a gate that rejects designs that can't be serviced. |
| Kiro | S4, S6, S11–S15 | One causal chain. Steering binds the agent. The spec holds 87 properties. A property test found a real counterexample and the spec grew a requirement. A no-credit hook reruns the suite. The Power and MCP answer in chat. The Crew app gates the change. This shows Kiro changing the outcome, not just being where the code was typed. |
| Design | S4, S7, S10 | Two complete, opposite products, each ending in an artifact or a win screen. Text-first cues show the game is playable on mute. |
| Innovation | S5, S6, S8, S10 | Mesh-only input, a deadlock named instead of a bare failure, an independent checker, and the same blocking graph used as a game's rulebook. |
| Presentation | S1, S9, S11, S16 | The bug as the thumbnail, chapter plates, the twist, and a bookend plate that unscrews to reveal the mark. |
| Skeleton Crew | S9, S10, S13, S16 | "One engine, two apps, no shared screens" is spoken and shown. One hook keeps both apps in sync. |
| Kiro Crew | S14, S15 | The same auditor answers in chat and at the gate. The FAIL is real, with `exit 1` and the manifest. |
| Halloween | S1, S8, S9, S10, S15 | The ghost is the bug, the curse is the deadlock, day and night are the two apps, and the vampire rule is the gate. |

Red-team panel estimate:
- v1: 35.3/50.
- v2 with these fixes: about 37.5.
- With the public CAD model (G4) and the same-assembly regression (G3): Impact and Kiro Crew go up further.

## 5. Look and sound

### Look
- **Day:** Guide Forge tokens. #F6F8FB ground, #1E3A5F navy, #DC143C for clashes only.
- **Night:** Blitz #0D0F14 obsidian and #D99B38 brass.
- **Kiro:** the IDE's real theme. Editor zoom at 150% or more, a 1.6–2× punch-in on the one line that proves the point, and no code held for more than 6 s.
- **Type:** IBM Plex Mono for numbers. Roboto Slab for the plates only.
- **Banned:**
  - a dark void with floating UI
  - glow and particles
  - fog, VHS grain, dripping type
  - three cards in a row
  - a docked logo
  - fade-and-slide-up titles
  - 3D-tilted UI
  - the same plate entrance or exit twice in a row

### Sound
| Moment | What happens |
|---|---|
| Opening | Escapement tick at 60 bpm over a drone. Naive collisions are silent. |
| DBG click | The bed enters. |
| Deadlock banner | The tick stops dead. |
| Night cut | The bed doubles to 120 bpm. |
| `Interlock Exposed!` | The only riser, with no voice over it. |
| Rule 4 | The music drops to a bare tick. |
| Green test | The music returns. |
| FAIL | The tick stops dead. |
| End | Resolves on a bar line. |

- **Effects** play only on visible events, with 2–3 rotated takes each.
- **Levels:** music about 0.14 under the voice, true peak at or below −1 dBTP, loudness −16 to −14 LUFS.

## 6. Shot list and who records it

| Shot | Source | How |
|---|---|---|
| S1–S8, S16 | Guide Forge (rebuilt, served locally) | I script Chrome and capture at 60 fps. The window is sized for 16:9 on the 1470×956 display and downscaled from 2× pixels. |
| S10 | Unbolt Blitz | Same method, with a fresh browser profile. The order is rehearsed and the callout text confirmed first. |
| S5, S12b, plates, end card | BUILD in HyperFrames | Driven only by JSON exported from the real engine. Nothing is hand-coloured. |
| S6, S11–S14 | Kiro IDE | You drive Kiro while I record the screen, or you record with QuickTime at 60 fps. I cannot click inside the Kiro window. |
| S15 | Terminal, plus Crew if available | Large-font terminal recording of the real command. The Crew dashboard only with a real host and manifest. |

## 7. Pre-production gates

**Hard gates** (they change the script):

- **G3. Same-assembly regression.** Make a captive-latch variant of the lockbox as a real `.glb`: export the kit, then change the latch geometry. The audit has to report the new cycle for real, and the narration names whatever it reports. Without this, S14 and S15 fall back to the ship-in-bottle and dumbbell kits, and the Kiro Crew score drops.
- **G8. Confirm the order of events behind S12b.** The Invariant 2 property test found the gearbox half-turn counterexample, and Req 14.11 was added because of it. Git history is squashed, so only you can confirm this. If you can't, use the neutral line in `SCRIPT.md`.

**Recording gates:**

- **G1.** Rebuild both apps. The `dist/` folders are older than the last commits.
- **G2.** Turn off macOS Reduce Motion, and use a fresh Chrome profile for Blitz.
- **G4.** Test a public CAD `.glb` (Khronos glTF samples GearboxAssy, 2CylinderEngine or ReciprocatingSaw) and check its licence. Use S7b only if it really solves.
- **G5.** Find a Kiro Crew host to install `apps/crew-assembly-ci` and show the dashboard with a real manifest. Outside a host the page shows invented "Sample preview" data. Never record that.
- **G6.** Install the CAD Assembly Auditor Power in Kiro, so that S14 shows the Power activating.
- **G7.** Check Kiro's hooks panel. If the `.kiro.hook` files show a "legacy" label in your Kiro version, migrate them before filming.
- **G9.** Export the real data the BUILD shots need: the lockbox's stage-2 edges, the gearbox half-turn pose, and its first clash. This needs no change to engine code.
- **G10.** Run `invariant1-lockbox.property.test.ts` on its own if you want its receipt (it is not in `test:quick`). Re-run `test:quick` on recording day to confirm 451.

**Optional** (outside the video, but judges read these):

- **G11.** Add a GitHub Actions workflow that calls `run-audit.mjs` on changed `.glb` files. That would let the film truthfully say "in CI". The narration currently avoids that phrase because no workflow exists.
- **G12.** Fix the README:
  - It says "mathematically verified".
  - It lists `two_step_l_slide`, which no plan uses.
  - It shows a bold `0` for oracle clashes on a deadlocked cage where nothing was replayed.
  - It says "Kiroween 2026", while the folder is named 2027.
  - Crew `app.json` uses an array for `permissions` and has no `author` or `tags`. The Power's `plugin.json` has no `author`. The Kiro team may check both for the Best Kiro Crew App prize.

## 8. Claims ledger (the narration stays inside this)

| Say | Never say |
|---|---|
| "12,618 clashes" (the badge's own term) | "12,618 collisions between parts" (it counts ray samples) |
| "a second checker, with its own ray-casting code" | "shares no code", "mathematically verified", "proven", "guaranteed" |
| "three specs hold eighty-seven correctness properties" | "39 across three specs", "87 property tests" |
| "check each step from every vertex" | "check every step exactly" |
| "screws unscrew, the lid slides" | L-slides, "the order a technician would follow" |
| "names the cycle … in all thirty-two directions" | "proves it can never be taken apart" |
| "every part leaves without walking through walls, or you learn what holds it" | "the way physics allows" (there is no gravity, and only straight and helical moves are checked) |
| "the Kiro Crew app audits every changed model … the audit fails" | "in CI" or "the build fails", unless G11 is done |
| "451 tests" on the hook | "737", unless re-run on recording day |
