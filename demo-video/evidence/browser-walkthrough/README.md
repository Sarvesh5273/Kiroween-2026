# UnboltKit: ring walkthrough and release decision

November 23, 2026 · Local production builds · headless Chromium · 1280 × 800 · muted. The built bundles and fixture files are identified by [SHA-256](input-hashes.json). The app source was left unchanged. The captures used normal file uploads, controls, part hover names and real canvas clicks. No game state, worker response, or delay was injected. These are repeatable operator tests, not a study of first-time viewers.

## Watch

- [32.6-second working cut of the main interaction](ring-walkthrough.mp4). Actual screen captures, shortened waits, explanatory captions and a still of the actual offline export. This is a product segment for review; it does not include the Kiro development story or claim to be the submission video.
- [7-second recording of the stale-axis scoring bug](axis-change-reproduction.mp4).
- Uncut app views: [Guide Forge](guide-forge-browser.mp4) and [Unbolt Blitz](unbolt-blitz-browser.mp4). The guide was opened in a separate offline browser context: [offline screenshot](gf-04-offline-manual.png) and [actual downloaded HTML](exported-service-guide.html).
- Displayed values and event timings: [Guide Forge](session-guide-forge.json) and [Blitz](session-unbolt-blitz.json).

## What passed

| Action | Guide Forge | Blitz, explicit +Y |
| --- | --- | --- |
| Try to pull the ring upward on the integral-cap revision | Blocked by Spindle | Blocked by Spindle; 0 points, 0/2 removed |
| Try to pull the ring upward on the removable-cap revision | Blocked by Service cap | Blocked by Service Cap; 0 points, 0/3 removed |
| Remove the cap, then try the ring again | Clear; present parts listed as Spindle and Service ring | Cap removed: 100 points, 1/3. Ring removed: 300 points, 2/3; spindle visible on pedestal |

Guide Forge used the same 20 model units for all three checks. Blitz chose the extraction distance for the selected axis. They agree on the blocker and the result; the two apps did not request identical travel distances.

The HTML download opened with networking disabled, and both images decoded. The export documents the full **three-step teardown**: cap, ring, spindle. It carries “Full guide not verified.” It does not currently export just the two-step service task or attest that the whole guide is clear. For the submission, say “offline teardown manual.”

## What a viewer can see

Blitz’s final lift gives the clearest visual evidence: the ring comes off and the spindle stays on the pedestal. Guide Forge gives the clearest explanation of *why*: the selected part, axis, travel and named blocker. Use **Hide Removed** after the cap step in Guide Forge; otherwise the short cap travel can look as though the cap is still fitted. The assembled and revised models are small controlled examples; no repair-time or physical-safety claim follows from this test.

## Bounded release pass for Kiro

**Reproduced in two browser runs:** upload the removable-cap revision in Blitz. Select +Y, click Service Cap, then actually click the +X chip while the HUD says “Checking.” The HUD switches to +X at 0 points, but the old +Y response still animates and scores the cap: 100 points, 1/3 removed. See the video and the timestamped DOM trace in the Blitz results.

1. Invalidate the pending attempt when the player changes direction or switches to Auto. Delivering the superseded result must leave score, mistakes, combo, removed parts and animation unchanged; a subsequent attempt must still work. Test with a held reply and repeat the actual browser clicks.
2. Replace the blanket “mathematically verified, zero-clash” README claim with the scoped capability: individual straight moves can be checked against parts still present; full plans and screws are not certified. The existing Auto mode selects from the blocking graph; do not present its scores as geometric verification. If its decision basis is ambiguous in the interface, label it “Auto · puzzle rules.”
3. Keep the working explicit direction feature, demo files, solver and full-guide audit out of this patch. Recheck the normal ring sequence after the fix. If it still passes, freeze the build for the video. A larger Auto verification redesign is a separate product decision.
