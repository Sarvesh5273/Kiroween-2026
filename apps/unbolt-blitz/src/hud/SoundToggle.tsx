import { useSyncExternalStore } from "react";
import type { SoundModule } from "../modules/soundModule";

/** "Sound" / "Muted" toggle. Every sound cue also has a visual cue, so muting never hides information. */
export function SoundToggle({ sound }: { sound: SoundModule }) {
  const muted = useSyncExternalStore(sound.subscribe, sound.isMuted, sound.isMuted);
  return (
    <button
      type="button"
      className={muted ? "bz-chip bz-chip--muted" : "bz-chip"}
      aria-pressed={muted}
      aria-keyshortcuts="M"
      onClick={() => {
        sound.toggleMuted();
      }}
    >
      <span className="bz-chip__icon" aria-hidden="true">
        ♪
      </span>
      <span className="bz-chip__label">{muted ? "Muted (M)" : "Sound (M)"}</span>
    </button>
  );
}
