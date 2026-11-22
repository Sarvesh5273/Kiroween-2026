/**
 * Clockwork Campaign, star ratings and personal bests (Part 2, module 3).
 *
 * - `CAMPAIGN_STAGES`: the five bundled kits in play order, with a difficulty badge and a mission line.
 * - `computeStars`: 3 stars for a clean run without hints, 2 for at most two slips, otherwise 1.
 * - `createCampaignStore`: personal bests per bundled level in an injectable `StorageAdapter`.
 *   The store is also a `GameModule`: on `level_completed` it rates the run, records it for a
 *   bundled level and keeps the result for the completion overlay.
 *
 * Type-only imports from the game layer: no DOM, React or Three.js.
 */
import type { CompletionSummary, GameEvent } from "../game/events";
import type { BundledLevelId } from "../protocol";
import { defaultStorage } from "./storage";
import type { StorageAdapter } from "./storage";
import type { GameModule, ModuleContext } from "./types";

export type Difficulty = "Apprentice" | "Deadlock Inspection" | "Journeyman" | "Grandmaster Blitz";

export interface CampaignStage {
  /** 1 to 5. */
  stage: number;
  levelId: BundledLevelId;
  title: string;
  difficulty: Difficulty;
  subtitle: string;
}

export const CAMPAIGN_STAGES: readonly CampaignStage[] = [
  {
    stage: 1,
    levelId: "lockbox",
    title: "Haunted Clockwork Lockbox",
    difficulty: "Apprentice",
    subtitle: "Unscrew the lid bolts, then free the gears from their haunted housing.",
  },
  {
    stage: 2,
    levelId: "dumbbell-cage",
    title: "Dumbbell & Captive Ring",
    difficulty: "Deadlock Inspection",
    subtitle: "A dumbbell is locked inside a ring. Free what you can, then flag the interlock.",
  },
  {
    stage: 3,
    levelId: "planetary-gearbox",
    title: "3-Stage Planetary Gearbox",
    difficulty: "Journeyman",
    subtitle: "Plan the order: sun, planets and ring gears all block each other.",
  },
  {
    stage: 4,
    levelId: "ship-in-bottle",
    title: "Ship in a Bottle",
    difficulty: "Deadlock Inspection",
    subtitle: "The hull will never fit through the neck. Prove it by flagging the trap.",
  },
  {
    stage: 5,
    levelId: "keyboard-65",
    title: "65% Mechanical Keyboard",
    difficulty: "Grandmaster Blitz",
    subtitle: "Dozens of keys and switches. Keep the combo alive and beat the clock.",
  },
];

export const MAX_STARS_PER_STAGE = 3;
export const MAX_CAMPAIGN_STARS = CAMPAIGN_STAGES.length * MAX_STARS_PER_STAGE;

export function findStage(levelId: BundledLevelId): CampaignStage | undefined {
  return CAMPAIGN_STAGES.find((stage) => stage.levelId === levelId);
}

/** The stage after `levelId`, or null for the last stage or a level outside the campaign. */
export function nextStageAfter(levelId: BundledLevelId): CampaignStage | null {
  const index = CAMPAIGN_STAGES.findIndex((stage) => stage.levelId === levelId);
  if (index < 0) return null;
  return CAMPAIGN_STAGES[index + 1] ?? null;
}

export type Stars = 1 | 2 | 3;

/**
 * 3 stars: no mistakes, no false alarms and no hints.
 * 2 stars: at most two mistakes and false alarms together.
 * Otherwise 1 star. Both outcomes (victory and interlock exposed) are rated the same way.
 */
export function computeStars(
  summary: Pick<CompletionSummary, "mistakes" | "falseAlarms">,
  hintsUsed: number,
): Stars {
  if (summary.mistakes === 0 && summary.falseAlarms === 0 && hintsUsed === 0) return 3;
  if (summary.mistakes + summary.falseAlarms <= 2) return 2;
  return 1;
}

export interface LevelRecord {
  bestScore: number;
  /** Fastest Elapsed_Time in milliseconds. */
  bestTimeMs: number;
  bestStars: number;
}

export interface NewBestFlags {
  score: boolean;
  time: boolean;
  stars: boolean;
}

export interface CampaignResult {
  /** Null for a custom upload, which is rated but never saved. */
  levelId: BundledLevelId | null;
  stars: Stars;
  hintsUsed: number;
  /** True when the run set at least one personal record (a first clear counts). */
  isNewBest: boolean;
  newBest: NewBestFlags;
  record: LevelRecord | null;
  next: CampaignStage | null;
}

export interface CampaignSnapshot {
  records: Readonly<Partial<Record<BundledLevelId, LevelRecord>>>;
  totalStars: number;
  lastResult: CampaignResult | null;
}

export interface CampaignStore extends GameModule {
  getRecord(levelId: BundledLevelId): LevelRecord | null;
  totalStars(): number;
  /** Rates a run and, for a bundled level, saves any personal record. */
  recordRun(
    levelId: BundledLevelId | null,
    summary: CompletionSummary,
    hintsUsed: number,
  ): CampaignResult;
  getSnapshot(): CampaignSnapshot;
  /** For `useSyncExternalStore`. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export interface CampaignStoreOptions {
  /** Defaults to `defaultStorage()`. */
  storage?: StorageAdapter;
  /** Hints asked in the current run. Defaults to 0. */
  getHintsUsed?: () => number;
}

export const CAMPAIGN_STORAGE_KEY = "unbolt-blitz:campaign:v1";

const LEVEL_IDS: readonly BundledLevelId[] = CAMPAIGN_STAGES.map((stage) => stage.levelId);

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Reads saved records. Anything that is not a valid record is dropped, so bad data never reaches the HUD. */
function parseRecords(raw: string | null): Partial<Record<BundledLevelId, LevelRecord>> {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn("Unbolt Blitz: saved campaign progress is unreadable and was ignored.", error);
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const records: Partial<Record<BundledLevelId, LevelRecord>> = {};
  for (const id of LEVEL_IDS) {
    const entry = (parsed as Record<string, unknown>)[id];
    if (typeof entry !== "object" || entry === null) continue;
    const { bestScore, bestTimeMs, bestStars } = entry as Record<string, unknown>;
    if (
      isNonNegativeNumber(bestScore) &&
      isNonNegativeNumber(bestTimeMs) &&
      (bestStars === 1 || bestStars === 2 || bestStars === 3)
    ) {
      records[id] = { bestScore, bestTimeMs, bestStars };
    }
  }
  return records;
}

function sumStars(records: Readonly<Partial<Record<BundledLevelId, LevelRecord>>>): number {
  let total = 0;
  for (const id of LEVEL_IDS) total += records[id]?.bestStars ?? 0;
  return total;
}

export function createCampaignStore(options: CampaignStoreOptions = {}): CampaignStore {
  const storage = options.storage ?? defaultStorage();
  const getHintsUsed = options.getHintsUsed ?? ((): number => 0);
  const initial = parseRecords(storage.getItem(CAMPAIGN_STORAGE_KEY));
  let snapshot: CampaignSnapshot = { records: initial, totalStars: sumStars(initial), lastResult: null };
  const listeners = new Set<() => void>();
  const publish = (next: CampaignSnapshot): void => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  function recordRun(
    levelId: BundledLevelId | null,
    summary: CompletionSummary,
    hintsUsed: number,
  ): CampaignResult {
    const stars = computeStars(summary, hintsUsed);
    const next = levelId === null ? null : nextStageAfter(levelId);
    if (levelId === null) {
      const result: CampaignResult = {
        levelId: null,
        stars,
        hintsUsed,
        isNewBest: false,
        newBest: { score: false, time: false, stars: false },
        record: null,
        next,
      };
      publish({ ...snapshot, lastResult: result });
      return result;
    }
    const previous = snapshot.records[levelId] ?? null;
    const newBest: NewBestFlags = {
      score: previous === null || summary.score > previous.bestScore,
      time: previous === null || summary.elapsedMs < previous.bestTimeMs,
      stars: previous === null || stars > previous.bestStars,
    };
    const record: LevelRecord = {
      bestScore: Math.max(previous?.bestScore ?? 0, summary.score),
      bestTimeMs: previous === null ? summary.elapsedMs : Math.min(previous.bestTimeMs, summary.elapsedMs),
      bestStars: Math.max(previous?.bestStars ?? 0, stars),
    };
    const records = { ...snapshot.records, [levelId]: record };
    storage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(records));
    const result: CampaignResult = {
      levelId,
      stars,
      hintsUsed,
      isNewBest: newBest.score || newBest.time || newBest.stars,
      newBest,
      record,
      next,
    };
    publish({ records, totalStars: sumStars(records), lastResult: result });
    return result;
  }

  return {
    id: "campaign-store",
    onEvent(event: GameEvent, ctx: ModuleContext) {
      if (event.kind === "level_loaded") {
        if (snapshot.lastResult !== null) publish({ ...snapshot, lastResult: null });
        return;
      }
      if (event.kind !== "level_completed") return;
      const screen = ctx.getState().screen;
      const ref = screen.kind === "level" ? screen.loaded.ref : null;
      recordRun(ref !== null && ref.kind === "bundled" ? ref.levelId : null, event.summary, getHintsUsed());
    },
    getRecord: (levelId) => snapshot.records[levelId] ?? null,
    totalStars: () => snapshot.totalStars,
    recordRun,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // Saved records are already on disk and the singleton outlives StrictMode remounts: only drop the last result.
    dispose() {
      if (snapshot.lastResult !== null) publish({ ...snapshot, lastResult: null });
    },
  };
}
