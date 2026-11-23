# Make the first action discoverable

Implement this focused UI pass in the existing Guide Forge and Unbolt Blitz apps. The PNGs and JSON reports next to this file show the local production builds on a fresh visit at 1280 × 800. Keep these as before captures; save any after captures under new names.

## Guide Forge

- Keep the whole move form visible together at 1280 × 800: part, direction, distance and units, and the “Check this move” button. Today the adjacent Steps list makes the form look finished below Distance. Give the steps their own scroll area. Keep the short full-guide verification status visible; put longer diagnostics behind Details if space is tight. The result of a move should appear where the user ran it.
- Put a visible “Try the ring example” action next to Upload. Load the existing three-part removable-cap model. Ask “Can the red ring slide up with the cap in place?” Select the ring, Up, and the travel distance from the existing accepted ring check. Show the values and let the user run the real checker. Keep this setup specific to the example; uploading a different model must clear it.

## Unbolt Blitz

- On the first visit to the opening lockbox, reuse the existing hint arrow to point to a removable lid screw and show “Click the highlighted lid screw to remove it.” Dismiss the cue after the first successful removal. This cue uses zero hints and leaves three stars attainable. Show the star cost of optional hints before a player uses one.

## Verify and stop

1. In a fresh 1280 × 800 browser, capture Guide Forge's default screen and ring example. Check that the complete button is visible before scrolling and that pressing it in the example returns a blocked move naming the Service Cap. Confirm Upload still allows a user to choose a different move.
2. In a fresh browser, open Stage 1 and follow the free cue. Check 1/13 removed, zero hints used, and no star penalty from the cue. Optional hints keep their existing scoring rule.
3. Run the affected checks. Report what you actually observed and the paths to the screenshots. Keep the current palettes, geometry algorithms, and demo assets as they are. No new screens or general redesign.
