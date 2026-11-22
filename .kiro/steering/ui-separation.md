---
inclusion: fileMatch
fileMatchPattern: "apps/**/*"
---

# UI Separation

## Distinct identities
- `apps/guide-forge` is a light-blueprint CAD manual studio.
- `apps/unbolt-blitz` is a dark clockwork disassembly puzzle game.
- Keep their visual identities, CSS themes, and interaction loops completely separate.
- Share no dashboard shell between them. Shared code belongs in `packages/`, and it must not carry app chrome or theme.

## Accessibility
- Both apps must be 100% playable and understandable on mute.
- Convey every audio cue through a visual or textual signal as well.

## Upload recovery states
- Both apps must show a clear recovery state for a true 1-island monolithic `.glb` upload.
- Both apps must show a clear recovery state for an oversized `.glb` upload.
- Each recovery state explains what happened and offers a next step, such as trying another file or loading a sample kit.
