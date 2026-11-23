# UnboltKit demo film: storylines

Planning only. Nothing is built yet. Swarm inputs are in `research/`.

## Swarm

Five agents ran in parallel:

- **Three story architects, each in a different lane:**
  - one object travelling across every app;
  - a bold, Halloween-native film;
  - the algorithm as the explanation.
- **A judging-panel simulator.** It modelled six judges: a Kiro PM, a senior engineer, a designer, a startup judge, a repair/mechanical judge and an automated transcript judge. It turned the rubric into deadlines and caps.
- **A fact checker.** It ran every kit audit and the quick test suite, read the UI source for exact labels, and checked what can be recorded on this Mac.

## Recommendation: D, "Nothing Walks Through Walls" (a merge)

D is B's device and title, carried by A's single object, with C's one "how it decides" diagram and a real Kiro property-test catch as the climax. It is the only option that does all of the following:

- It keeps the Halloween theme structural without hurting clarity.
- It lands the red-to-green flip by about 0:28.
- It can be recorded with what exists today.
- It answers the Kiro PM's question, "where did Kiro change the outcome?", with a real counterexample.

The full plan is in `PLAN.md` and the voiceover is in `SCRIPT.md`.

## A. The Captive Latch (object-to-object chain)

**Pitch:** One lockbox travels from a repair manual (Guide Forge) to a training game (Unbolt Blitz), into Kiro chat (the Power and MCP), and then into CI (Kiro Crew). Every shot ends on the copper latch, which opens the next shot. A teammate's well-meant "captive latch" commit turns the latch into a trap, and CI names latch and lid before the merge.

**First 2 s:** the naive explode pushes a brass pinion through the steel wall, the badge reads `12618 Clashes`, and a bell tolls.

**Strength:** the strongest Impact and Kiro Crew story, because it is a real regression on the same assembly.

**Weakness:** it needs a captive-latch `.glb` that does not exist yet, and a Kiro Crew host to record the dashboard. It also introduces 3 personas.

## B. Nothing Walks Through Walls (horror survival rules)

**Pitch:** Five engraved "rules" are real invariants:

1. Nothing walks through walls.
2. Never go in alone (the second checker).
3. Name what holds you (the deadlock witness).
4. Never fake a pass (steering).
5. Never let darkness commit (CI).

The twist is that the rules bind Kiro's AI too.

**First 2 s:** a gear slides through the wall under the plate "RULE 1: NOTHING WALKS THROUGH WALLS", the collision makes no sound, and a whisper says "This gear just walked through solid steel."

**Strength:** the most memorable option, the theme is the story itself, and it is fully recordable.

**Weakness:** the `0 Clashes • Verified` badge lands late (0:54).

## C. Which Part Comes Out First? (one diagram that grows)

**Pitch:** A blueprint cross-section of the lockbox grows in layers: 32 directions, then who blocks whom, then the peel, the knot, and the referee. Each layer cuts to the real UI doing the same step. Kiro's spec properties then pin onto each stop of the diagram.

**First 2 s:** the naive explode, a hand-drawn navy ellipse around the gear in the wall, and the label `clock_gear_N ∩ box_body` typing on.

**Strength:** the clearest Innovation story.

**Weakness:** it is the heaviest to produce, needing many data-driven diagrams. It carries the most risk of reading as too technical, and the badge only lands at 0:57.

## Why D over each original

| Judge cap or need | A | B | C | D |
|---|---|---|---|---|
| Red-to-green flip lands (cap: Presentation ≤ 6 if after 0:30) | 0:30 | 0:54 | 0:57 | ~0:28 |
| Recordable with today's repo | needs a new `.glb` and a Crew host | yes | needs heavy diagram builds | yes, and upgrades if A's `.glb` is built |
| Kiro shown changing the outcome | partly | steering only | spec map | real property-test counterexample, which became Req 14.11 |
| Theme without gimmick | light | strong | light | strong |
| Transcript alone carries the pitch | yes | yes | yes | yes |
