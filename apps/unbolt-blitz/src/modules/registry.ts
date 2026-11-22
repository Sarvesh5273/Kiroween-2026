/**
 * Registered game modules. Part 2 adds hints, sound, star ratings and personal bests here,
 * without editing `reducer.ts` or `blitzEngine.ts`.
 *
 * The modules are app-wide singletons so the HUD and the Arena can reach the same instances
 * that the bus drives. Each one keeps its subscriptions across `dispose()`, because React
 * StrictMode mounts, disposes and mounts the controller again.
 *
 * Order matters on the bus: the hint session runs first, so `hintsUsed` is final
 * when the campaign store rates a finished run.
 */
import { createCampaignStore } from "./campaignStore";
import { createHintSession } from "./ghostHint";
import { createSoundModule } from "./soundModule";
import type { GameModule } from "./types";

export const hintSession = createHintSession();
export const soundModule = createSoundModule();
export const campaignStore = createCampaignStore({ getHintsUsed: () => hintSession.getHintsUsed() });

export const GAME_MODULES: readonly GameModule[] = [hintSession, soundModule, campaignStore];
