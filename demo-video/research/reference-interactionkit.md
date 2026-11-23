# Reference breakdown: InteractionKit demo (Kiroween 2025 Grand Prize, Skeleton Crew entry)

- Video: https://youtu.be/FHMdbhIxMt4. Runs 2:52, 1920×1080, 29.97 fps.
- Status: the GitHub repo calls it "Winner of the Kiroween 2025 Grand Prize". The YouTube description lists it in the Skeleton Crew category.

## How I analysed it, and the limits

- **Pictures:** I downloaded the file and looked at every second of it as stills (172 frames). Around each transition I sampled densely, at 4–11 frames per second. That shows how a zoom or cut behaves: a motion-blurred frame between two framings means a fast camera move.
- **Cuts:** I ran ffmpeg scene detection at two thresholds.
- **Words:** I transcribed the audio locally with Whisper (base.en) and cross-checked it against YouTube's own captions.
- **Sound:** I measured it rather than heard it: loudness in 100 ms windows, spectral flatness, beat periodicity, and pitch per section.
- **What I can't do:** I can't watch continuous motion or listen. Statements about tone of voice, music quality or "feel" are inferences from these measurements, not perception.

## Timeline

| Time | Shot | Narration (gist) | Edit technique |
|---|---|---|---|
| 0:00–0:30 | Title card: logo, the tagline "Build creative gesture-powered apps with Kiro", and a small looping clip of a hand playing the game on a laptop, with a purple glow under it. It stays on screen for 30 s. | Voice A tells the origin story ("We've enjoyed building at hackathons… at MIT, Harvard, and UPenn"), the problem ("Coding agents often hallucinate MediaPipe functions… hours of debugging") and the bridge ("Kiro was the perfect tool"). | Static hold. Frame 0 is the logo. |
| 0:30–0:37 | Kiro's own docs site, the Steering page, scrolling | "exploring Kiro's features" | Hard cut, screen recording |
| 0:37–0:49 | GitHub README: the hero, then the "Featured Applications" with GIFs | "That's why we created InteractionKit… a clean, starter-friendly template…" | Zooms into the README hero (0:39), then out to scroll |
| 0:49–0:59 | Slide: a pixel ghost mascot in a witch hat asks "What can I build with this template?", with 3 checkmarks | Template benefits | Hard cut. The slide is complete on its first frame, and the ghost bobs |
| 0:59–1:17 | Slide: "Why we used Kiro to build this starter kit". A black staircase of squares (taken from the logo's squares) reading Steering Docs → Hooks → MCP → Specs, with one line beside each | Voice B takes over: "But the real superpower… inside the Kiro IDE" | The title types on word by word (about 0.9 s). Each label types on as it is spoken, then each line of text appears |
| 1:17–1:27 | Kiro IDE: a steering doc (`game-development.md`), with a zoom into the AGENT STEERING panel | "custom steering docs… rock-solid blueprint" | Auto-zoom about 2.5× onto the cursor. The move lasts about 0.2–0.3 s with heavy motion blur, then drifts slowly. The cursor is enlarged |
| 1:27–1:37 | AGENT HOOKS panel ("Auto-integrate New Face/Hand/Head Gesture"), then the hook form (File Saved, the path to watch, the agent instructions) | "three hooks to auto-integrate custom gestures" | The zoom lands about 1.5 s after the word "hooks" and follows the cursor to the hook form |
| 1:37–1:52 | MCP SERVERS panel, "Context7 Connected (2 tools)". The cursor hovers each tool and a tooltip appears | "Context7 MCP… stop hallucinations" | Holds about 13 s on one zoomed panel |
| 1:52–2:01 | Specs: the holo-board `requirements.md` and its preview | "spec-driven development… two distinct demo applications on our code skeleton" | Motion-blur zoom out, then back in |
| 2:01–2:08 | App 1 gameplay (Math-O-Lantern), the window on a pink padded ground | "slice pumpkins using hand gestures" | Hard cut, then a small settle zoom (about 1.05→1.0) |
| 2:05–2:15 | Live-action phone footage: a real hand playing the game in front of a laptop | **No narration for 10 s.** Natural sound only. | The real-world proof shot |
| 2:15–2:20 | Someone else's YouTube lightboard video (the inspiration) | "takes inspiration from the cool YouTube lightboard videos" | Screen recording of the YouTube page |
| 2:20–2:30 | App 2 (Holo-Board) on a webcam: drawing a heart diagram and an autoencoder in mid-air | "lightboard-style recording tool" | Hard cuts between two demo takes |
| 2:30–2:37 | README section for Holo-Board, with its GIFs playing | Voice A wraps up the app | |
| 2:37–2:52 | End card: ghost, logo, tagline, and "Check out this template on Github!" with the GitHub mark | Voice B: "We had a great experience… check out our template on GitHub" | Holds 15 s. The ghost bobs |

## Measured facts

### Cuts and shots
- About 15 shots in 172 s, so the average shot runs about 11 s.
- Every cut between sections is a hard cut. There are no designed transitions.
- All movement comes from inside the screen recordings: zooms, scrolls and the cursor.

### Screen recordings
The treatment matches what the macOS app Screen Studio produces:
- auto-zoom onto the cursor;
- 0.2–0.3 s moves with motion blur;
- an enlarged cursor;
- windows on a coloured padded ground with rounded corners.

That is my inference from the look. The video doesn't name the tool.

### The words
- 411 words in 172 s, which is 143 words per minute across the whole film.
- The narration never stops except for the 10 s gameplay window.
- The words lead the picture: each Kiro feature is named, then its IDE panel fills the screen 1–2 s later.

### Voices
There are two narrators. Pitch shows which one is speaking:

| Voice | Median pitch | Sections |
|---|---|---|
| A | about 119 Hz | 0:00–0:58 and 2:15–2:35 |
| B | about 219 Hz | 0:59–2:05 and 2:36–end |

YouTube's captions mark speaker changes at 0:58 and 2:36, which matches. The voice change works as an audible chapter marker.

### Music
I found no music bed:
- Between words, the floor sits at −45 to −49 dB. A bed under the voice would usually lift it to around −30 to −35 dB.
- The only stretch with no voice (2:05–2:15) is noise-like (spectral flatness 0.71) with no steady beat. Most likely it is the room or camera sound from the phone footage.

### Halloween
The theme is light: a pixel ghost mascot on every slide and the end card, plus the pumpkin game.

### How much time each part gets

| Part | Time | Share |
|---|---|---|
| Problem and origin | 30 s | 17% |
| What the template is | 29 s | 17% |
| Kiro features | 62 s (18 s slide + 44 s in the IDE) | 36% |
| Two apps working | 36 s, including the real-world footage | 21% |
| End card | 15 s | 9% |

## Why it won, and what changed for 2026

The Kiroween 2025 rules had **three** equal criteria: Potential Value, Implementation (Kiro) and Quality & Design. There was no Presentation criterion.

This entry won on substance that is easy to follow:
- a true origin story;
- a clear problem ("agents hallucinate CV code");
- every Kiro feature shown in its real IDE panel at the moment it is named;
- two genuinely different apps shown working, one of them in live action.

Kiroween 2026 adds **Presentation** as its own 20% ("creative and memorable", "working end-to-end"), plus a Best Demo prize. A 30 s static logo open and a 15 s static end card would cost points under that line. Their structure and proof style are the parts to borrow. Their pacing is not.

## What we take from it

1. **Picture follows the word.** Name a Kiro feature, then show its real IDE panel. Target the zoom landing within 1 s of the keyword; they were 1–2 s late.
2. **The Kiro IDE's own panels are the proof.** That means AGENT STEERING, AGENT HOOKS (including the hook form with its trigger), MCP SERVERS ("Connected (N tools)") and Specs. A judge from Kiro recognises these on sight.
3. **Screen Studio grammar on every screen shot:**
   - 2–2.5× punch-ins onto the panel under the cursor;
   - 0.2–0.3 s moves with motion blur;
   - a slow drift while holding;
   - an enlarged cursor;
   - app windows on a padded ground with rounded corners and a shadow.
4. **A map before the details.** Their staircase slide named all four Kiro features before the IDE tour. It was built from their logo motif, which kept it from reading as a generic bullet slide.
5. **One shot of the real world.** Phone footage of a real hand using the app proves it is real and human. That one shot was worth 10 s with no narration.
6. **A true personal origin line.** "We've enjoyed building at hackathons… we kept noticing" makes the problem credible.
7. **Two voices as chapter markers.** This is optional.
8. **An explicit GitHub call to action on the end card.**

## What we don't take
- A logo as frame 0, or a 30 s static open.
- The checkmark-benefits slide.
- A 15 s end card.
- Filler footage of Kiro's own docs site.
- Someone else's video as an illustration. Their YouTube lightboard clip was third-party content, which is a rights risk.
