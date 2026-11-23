# Voiceover script: "Nothing Walks Through Walls" (ElevenLabs Eleven v4)

This is version 2. It applies the red-team fixes: claims corrected against the source, v4 tags tightened, and a 326-word budget for a cut of about 2:51.

Scene numbers (S1–S16) match the beat sheet in `PLAN.md`.

## 1. How to generate

### Model and tags
- Use Eleven v4 (`eleven_v4`) in the Text to Speech app.
- Square-bracket audio tags are performed, not read aloud.
- A tag's emotion carries forward until the next tag.
- Every block opens with the same narrator anchor tag. That keeps the timbre the same across five separate generations.

### Pauses
v4 has no SSML `<break>`. Pauses come from:
- paragraph breaks;
- the two `[long pause]` tags that are kept;
- dramatic ellipses.

### Voice
- Pick a warm, low, close-mic documentary narrator with dry humour.
- Don't use a horror-trailer voice or a spooky filter. The S1 whisper is the only effect.
- Shortlist 3 voices from the Voice Library. Test each on the S1 whisper and the S12b story line, and keep the one that handles both.

### Takes and files
- Start from the default settings and make 3 takes per block.
- If a tag is ignored or read aloud, swap in a nearby tag first (for example `[quietly]` for `[whispers]`). Only then try another voice.
- Make one generation per block: `vo-1-haunting`, `vo-2-rules`, `vo-3-night`, `vo-4-kiro`, `vo-5-gate`.
- Download WAV if your plan has it. Otherwise use the highest-quality MP3.

### Pronunciation checks
Run these before the full generation:

| Word | Target sound | Fallback if it comes out wrong |
|---|---|---|
| "Unbolt Kit" | written as two words on purpose | `"/ʌnˈboʊlt kɪt/"` |
| "Kiro" | KEE-roh | `"/ˈkiːroʊ/"` (v4 reads IPA between slashes, inside double quotes) |
| "M C P", "C I" | read as letters | `MCP` / `CI`, then `M-C-P` / `C-I` |
| "CAD" | "kad" | `"/kæd/"` |

### Length and cuts
The script is 326 spoken words, about 2:30 of speech plus about 20 s of planned silence. Send me the files: I'll measure them and cut the picture to the voice. If it runs long, cut in this order:
1. The S13 second sentence.
2. The S12a line.
3. The second half of S3 ("Miss one…").

Never cut S7. It is the manual writer's payoff.

## 2. Paste blocks (copy each one as is)

### Block 1: `vo-1-haunting` (S1–S4, about 0:00–0:37)

```text
[warm, low documentary narrator, whispering] This gear just walked through solid steel.

[calm, low documentary narrator] A one-click exploded view pushes each part straight out from the center. [slowly] Here, that's twelve thousand six hundred eighteen clashes.

[matter-of-fact] Repair-manual writers fix each step by hand, on every product revision. [grim, understated] Miss one, and a technician pries at a part that can't move.

[confident, warm] Unbolt Kit reads only the mesh. No part names. No CAD history. It finds an order where nothing collides. [measured, landing each phrase] Thirteen parts. Thirteen steps. Zero clashes.
```

### Block 2: `vo-2-rules` (S5–S8, about 0:37–1:13)

```text
[warm, low documentary narrator, curious, explaining clearly] Each part tries thirty-two directions and records who blocks it. The solver peels free parts off, one at a time.

[serious] Then a second checker, with its own ray-casting code, replays every step.

[brisk, practical] In Guide Forge, the writer adds tools and warnings, and exports an offline manual.

[long pause] [low, hushed voice] Some designs are cursed. [slowly] This ring can't pass the dumbbell's ends, [plain, precise] so Unbolt Kit names the cycle: each blocks the other in all thirty-two directions.
```

The optional S7b line goes in only if gate G4 passes. Paste it after "…an offline manual." and cut the S13 second sentence to make room:

```text
[deadpan, wry] And it isn't tuned to our models. This is a public CAD file we didn't make.
```

### Block 3: `vo-3-night` (S10, about 1:16–1:33)

`Interlock Exposed!` plays after this line with no voice, under the film's only riser.

```text
[warm, low documentary narrator, playful, quick and lively] One engine, two apps, no shared screens. By night, it's Unbolt Blitz... where the blocking graph is the rulebook. Click a stuck part, and it names who's in the way.
```

### Block 4: `vo-4-kiro` (S11–S14, about 1:36–2:29)

```text
[warm, low documentary narrator, slow, serious, deliberate] The solver can't cheat. Neither can the Kiro agent that helped build it: its steering forbids hardcoded answers and swallowed errors.

[plainly] Three specs hold eighty-seven correctness properties.

[intimate, like telling a good story] One property test spun the gearbox at random, and found a pose where the sample rays missed a gear-tooth contact. [firm] The spec gained a requirement: check each step from every vertex, before taking it.

[brisk] Every engine save fires a Kiro hook that reruns four hundred fifty-one tests. A second hook has an agent carry primitive changes into both apps.

[conversational] The engine ships as a Kiro Power over M C P: any agent can ask if a design is cursed, and get the parts by name.
```

Conditional lines:
- **S12b "The spec gained a requirement…"** stays only if you confirm the test came first and Req 14.11 was added because of it (gate G8). Otherwise use this neutral version (10 words instead of 14):
  ```text
  [firm] The spec now demands a check of every step, from every vertex.
  ```
- **S13 "A second hook…"** stays only if that hook is recorded working (gate in PLAN S13).

### Block 5: `vo-5-gate` (S15–S16, about 2:29–2:51)

```text
[warm, low documentary narrator, serious] And the Kiro Crew app audits every changed model. [slowly] Change a design so a part gets trapped... [firm] and the audit fails, with the cycle attached.

[long pause] [warm, certain] Unbolt Kit. Every part leaves without walking through walls... [softly] or you learn what holds it.
```

Use this S15 variant once the captive-latch regression `.glb` exists (gate G3):

```text
[warm, low documentary narrator, serious] And the Kiro Crew app audits every changed model. [slowly] This change makes the latch captive... [firm] so the audit fails, and names the parts that lock.
```

## 3. Script read without tags (timing and claims)

| Scene | Line | Words |
|---|---|---|
| S1 | This gear just walked through solid steel. | 7 |
| S2 | A one-click exploded view pushes each part straight out from the center. Here, that's twelve thousand six hundred eighteen clashes. | 20 |
| S3 | Repair-manual writers fix each step by hand, on every product revision. Miss one, and a technician pries at a part that can't move. | 23 |
| S4 | Unbolt Kit reads only the mesh. No part names. No CAD history. It finds an order where nothing collides. Thirteen parts. Thirteen steps. Zero clashes. | 25 |
| S5 | Each part tries thirty-two directions and records who blocks it. The solver peels free parts off, one at a time. | 20 |
| S6 | Then a second checker, with its own ray-casting code, replays every step. | 12 |
| S7 | In Guide Forge, the writer adds tools and warnings, and exports an offline manual. | 14 |
| S8 | Some designs are cursed. This ring can't pass the dumbbell's ends, so Unbolt Kit names the cycle: each blocks the other in all thirty-two directions. | 25 |
| S10 | One engine, two apps, no shared screens. By night, it's Unbolt Blitz, where the blocking graph is the rulebook. Click a stuck part, and it names who's in the way. | 30 |
| S11 | The solver can't cheat. Neither can the Kiro agent that helped build it: its steering forbids hardcoded answers and swallowed errors. | 21 |
| S12a | Three specs hold eighty-seven correctness properties. | 6 |
| S12b | One property test spun the gearbox at random, and found a pose where the sample rays missed a gear-tooth contact. The spec gained a requirement: check each step from every vertex, before taking it. | 34 |
| S13 | Every engine save fires a Kiro hook that reruns four hundred fifty-one tests. A second hook has an agent carry primitive changes into both apps. | 25 |
| S14 | The engine ships as a Kiro Power over M C P: any agent can ask if a design is cursed, and get the parts by name. | 24 |
| S15 | And the Kiro Crew app audits every changed model. Change a design so a part gets trapped, and the audit fails, with the cycle attached. | 25 |
| S16 | Unbolt Kit. Every part leaves without walking through walls, or you learn what holds it. | 15 |
| | **Total** | **326** |

### Where each claim comes from

| Claim | Source (checked by two independent agents) |
|---|---|
| 12618 clashes, 13 parts, 13 steps, 0 clashes | `run-audit.mjs --kit haunted-clockwork-lockbox`; Guide Forge badge text in `state/selectors.ts:34,44` |
| "Straight out from the center" | `stage4/naiveBaseline.ts:32-41` (from the mean of the parts' box centres) |
| Reads only the mesh | Part IDs are node-index paths (`stage0/islandSplitter.ts:178`). Names are display-only. |
| 32 directions, who blocks whom | `stage1/candidateAxes.ts` (26 + 6), `stage2/dbgBuilder.ts:66-74` |
| Peels free parts one at a time | `stage3/peelSolver.ts:134-160` |
| Second checker with its own ray-casting code | `oracle/clashChecker.ts:10-19`, `test/static/clash-independence.test.ts` |
| Offline manual, tools and warnings | `export/manualExporter.ts:472`, `authoring/StepAuthoringPanel.tsx:19-20` |
| Ring can't pass the ends; 32 directions each way | `cageDumbbellRing.ts` (bore r7 vs knob r17); audit witness |
| Blocking graph is Blitz's rulebook; `BLOCKED BY` | `game/levelData.ts:26-44`, `game/blitzEngine.ts:283-330`, `hud/hudModel.ts:74-76` |
| Steering forbids hardcoding and swallowed errors | `.kiro/steering/no-spec-gaming.md:7,11` (`inclusion: always`) |
| 87 properties in 3 specs | Engine 39 + Guide Forge 22 + Blitz 26 (`### Property N` headings in each `design.md`) |
| Gearbox counterexample | `test/unit/stage3-lazy-refinement.test.ts:13-19` |
| Requirement for a check of every step | `requirements.md` Req 14 criterion 11 (every welded vertex and triangle centroid) |
| 451 tests on every engine save | `verify-dbg-invariants.kiro.hook` (`packages/unbolt-core/src/**/*.ts` → `test:quick`). Re-run on recording day. |
| Second hook carries primitive changes | `sync-extraction-primitive.kiro.hook` (on `src/primitives/*.ts`) |
| Power over MCP, parts by name | `powers/cad-assembly-auditor`; `inspect_assembly_dbg` returns `deadlockWitness.sccs[].names` |
| Crew app audits changed models; fails with the cycle | `agents/assembly-auditor.json` SessionStart hook (changed and untracked `.glb`); `run-audit` exit 1 plus the SCC witness |

## 4. Music and effects (optional, same ElevenLabs account)

All music is instrumental, with no vocals.

### Cue A: day (0:00–1:13), about 75 s
> Minimal dark clockwork score, instrumental. A dry close escapement tick and a low bowed cello drone, sparse and tense for the first 25 seconds. Then a warm, steady pulse of pizzicato strings and muted brass at 96 bpm. It thins to almost nothing at the end.

### Cue B: night (1:13–2:51), about 100 s
> Clockwork percussion at 120 bpm: ratchets, escapements, brass mallets, low synth bass. One riser and impact about 20 seconds in, then a drop to bare ticking for 30 seconds. A slow rebuild with brass, ending on a clean final chord.

### Effects
Make one file per effect, with 2–3 takes of each:
- dry clock escapement tick
- heavy short steel clank
- screwdriver ratchet
- brass lever pulled with a ratchet catch
- soft UI mouse click
- low soft pop
- short airy whoosh
- low brass hit
- riser into impact, 3 seconds
