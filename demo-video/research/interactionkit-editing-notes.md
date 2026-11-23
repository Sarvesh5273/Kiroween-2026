# What InteractionKit's edit does that our first cut loses

Editorial review, November 23, 2026. [Reference film by Harpita Pandian](https://www.youtube.com/watch?v=FHMdbhIxMt4) · [Creators' GitHub banner](https://github.com/Harpita-P/Kiro-InteractionKit/blob/main/xmedia/Github-Banner.png) · [Annotated frame comparison](interactionkit-editing-review.jpg) · [UnboltKit working cut reviewed](../evidence/browser-walkthrough/ring-walkthrough.mp4).

## Evidence

I decoded the linked 1920 × 1080 H.264 file: 5,164 pictures at 30000/1001 fps, container duration 172.36 seconds. I compared adjacent frames at reduced resolution across the whole file, inspected stills every four seconds, and stepped through key cuts and a steering-panel zoom one frame at a time. For comparison I decoded the 783 frames of our 32.625-second MP4 and compared the finished frames against the browser captures. A separate scene analysis was a cross-check; the times below come from the decoded film. Frame numbers are zero-based. The cuts establish what an audience can see, not which editor the team used, which colors they intended to reference, or why judges voted as they did.

## Shot log

| Time | What is visible | Editorial purpose (interpretation) |
| --- | --- | --- |
| 0:00–0:30.50 | The pale canvas holds the large wordmark, purple square clusters, a single-line description and a small moving hand/laptop clip below it. The picture is moving within a stable layout. | The viewer gets a name, a promise and an example together. The project's identity can stay still because the example provides motion. |
| 0:30.50–0:36.90 | Hard cut to a dark browser showing Kiro steering documentation. | A decisive change of surface: project introduction to the tool behind it. |
| 0:36.90–0:49.05 | The GitHub README appears. At 0:38.405 the surrounding page is legible; by 0:40.007 the banner fills most of the picture; by 0:42.543 the page and its right column are back in frame. The scroll then exposes the example apps. | The same banner exists in the repo. The zoom introduces an object, and pulling back shows where it lives. |
| 0:49.05–0:59.06 | Hard cut to a benefits card: pixel ghost in a hat and a speech bubble on the left; short explanation and check marks on the right. | This is where a slide works: it explains an idea rather than masking a live control. |
| 0:59.06–1:17.21 | A second graphic opens with four dark blocks already arranged as stairs. The feature labels appear from the top down; the explanatory lines then fill in. By roughly 1:08 the completed map holds. | The squares from the identity become a diagram. Each reveal tells the eye where to look next. |
| 1:17.21–2:00.82 | Whole Kiro IDE first, then attention shifts between Steering, Hooks, MCP and Specs. Ten consecutive frames, 2,354–2,363 (1:18.545–1:18.845), show the camera moving into the Steering area with motion blur. By 1:20 the readable panel and enlarged cursor share the frame. The wide editor is back by 1:23.75. | The close-up has a job and an exit. The identifiable sidebar makes a dramatic crop intelligible. Visual evidence supports configured tools; it does not establish the rate of AI generation. |
| 2:00.821–2:07.794 | A cut from the IDE into the Pygame window. The score, equation, controls and playfield fit inside the window, with pink padding around it. | We can tell what the game is before the team changes camera angles. |
| 2:07.794–2:15.068 | Cut from digital gameplay to the camera above the laptop. The hand and laptop screen are visible together. | This answers the project's main credibility question: does a real gesture actually drive the game? |
| 2:15.068–2:36.623 | Brief lightboard inspiration clip; Holo-Board webcam drawing begins at 2:19.673. It cuts from a heart example to an autoencoder example at 2:24.978, then to their GitHub examples at 2:30.350. | A second application changes the use case. The authored brand graphics stay out of the way of the live drawing. |
| 2:36.623–end | Return to the wordmark, pixel ghost, purple square clusters and a small GitHub prompt. | Returning to the opening composition gives the film a recognizable ending without inventing a new visual language. |

### Color and identity

The largest flat colors in the original 1200 × 400 banner PNG are **#F4F4F4** (background) and **#4C098F** (purple square motif). There is a black-to-blue/violet wordmark, a lavender glow below it, and a small sponsor line toward the lower right. The sampled opening frame has near-identical gray and purple after compression. Kiro itself [describes and shows a purple logo](https://kiro.dev/blog/introducing-kiro-for-ios/). The project visually echoes Kiro; no evidence here establishes an exact official brand-token match or that their banner is an official Kiro asset. The project identity stays consistent while the actual docs, game and webcam each keep their own colors.

### What is wrong in our cut

- The first frame contains a loading indicator. A title cannot rescue a bad in-point.
- The recordings are 1280 × 800. The editor first takes only x=5…937, y=59…701 from Guide Forge; its right-hand controls start around x=945. The main image therefore physically cannot show the selected part, +Y, travel, Check button or verdict. A later small inset tries to put back something the composition removed.
- The main recording is placed in a 989 × 635 box on a 1600 × 900 frame, about 44% of the frame area. Large headings, repeated explanatory copy and footers take attention from the actual click. This was a useful QA evidence reel, not a suitable visual template for the submission.
- The manual really does export and the Blitz ring lift really does play. Retain the uncropped recordings as source material. There is no need to rebuild the application to solve a framing mistake.

### Rules for the eventual edit

1. Establish an original UnboltKit banner; a ring, cap and spindle are a more useful project mark than borrowing the other team's pixel squares. Reuse our own identity at opening, chapter breaks and the end. Keep Kiro attribution secondary.
2. Introduce the complete working screen. Fit a 16:10 capture by height in 16:9 with breathing room, or record at 16:9. Do not use fill-to-cover on product UI as the default.
3. Design a shot around one action. For the decisive Guide Forge beat, retain ring + direction + blocker on screen through the click and reveal; if unreadable, reframe the UI or use a deliberate detail shot after establishing the full layout. Then pull back before the next decision.
4. Use a quiet margin or short caption where needed. No permanent right-hand explanation panel. Enlarge the real cursor or keep its movement visible; let the control and result answer the question.
5. Let Blitz have one uninterrupted proof shot: cap off, ring lifts, spindle stays. Hold on the end state. Cut idle waits and file-loading footage, not the cause-and-effect chain.
6. Review at reduced playback size, muted. If a viewer can read our summary but cannot point to the actual control or the actual blocker, the edit fails. Keep this as an editorial gate; it is not evidence of user testing.
