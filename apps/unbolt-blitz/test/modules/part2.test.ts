import { describe, expect, it, vi } from "vitest";
import type { TrajectoryStep, Vec3 } from "@unboltkit/core";
import { escapeDistance } from "../../src/game/axisMath";
import {
  attemptUnbolt,
  clearAxes,
  createEngine,
  createEngineLevel,
  genuineDeadlockSccs,
  liveParts,
} from "../../src/game/blitzEngine";
import type { EngineState } from "../../src/game/blitzEngine";
import type { CompletionSummary, GameEvent } from "../../src/game/events";
import type { GameState } from "../../src/game/gameState";
import { toEngineLevelInput } from "../../src/game/levelData";
import { createEngineDeps } from "../../src/engineDeps";
import { resolveShortcut } from "../../src/hud/shortcuts";
import {
  CAMPAIGN_STAGES,
  CAMPAIGN_STORAGE_KEY,
  MAX_CAMPAIGN_STARS,
  computeStars,
  createCampaignStore,
  nextStageAfter,
} from "../../src/modules/campaignStore";
import { createHintSession, describeDirection, pickHintTarget } from "../../src/modules/ghostHint";
import { GAME_MODULES } from "../../src/modules/registry";
import {
  MUTE_STORAGE_KEY,
  chimeFrequency,
  createSoundModule,
  soundRecipe,
} from "../../src/modules/soundModule";
import type { AudioContextLike, SoundSpec } from "../../src/modules/soundModule";
import { createMemoryStorage } from "../../src/modules/storage";
import type { ModuleContext } from "../../src/modules/types";
import { ghostOpacity, ghostTravel, GHOST_MAX_TRAVEL, GHOST_MIN_TRAVEL } from "../../src/viewport/ghostPreview";
import { readSrcFiles } from "../helpers/sourceScan";
import { requireSolveResult, solvedDefaultLockboxViaRunner, solvedDumbbellCage } from "../helpers/solved";
import type { BlitzSolveOutcome } from "../../src/worker/runBlitzSolve";

function engineOf(outcome: BlitzSolveOutcome): EngineState {
  const result = requireSolveResult(outcome);
  return createEngine(createEngineLevel(toEngineLevelInput(result), createEngineDeps()));
}

function summary(overrides: Partial<CompletionSummary> = {}): CompletionSummary {
  return { score: 1000, elapsedMs: 60_000, mistakes: 0, falseAlarms: 0, removed: 10, total: 10, ...overrides };
}

function sameDir(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Minimum escape distance over the given parts' clear axes, measured from the raw geometry. */
function bestDistanceOf(engine: EngineState, partIds: readonly string[]): number {
  let best = Infinity;
  for (const partId of partIds) {
    const part = engine.level.partsById.get(partId);
    if (part === undefined) throw new Error(`unknown part ${partId}`);
    const others = engine.level.parts
      .filter((other) => other.partId !== partId && !engine.removed.has(other.partId))
      .map((other) => other.aabb);
    for (const axis of clearAxes(engine, partId)) {
      best = Math.min(best, escapeDistance(part.aabb, part.candidateAxes[axis] as Vec3, others));
    }
  }
  return best;
}

function removable(engine: EngineState): string[] {
  return liveParts(engine).filter((partId) => clearAxes(engine, partId).length > 0);
}

describe("pickHintTarget on the real Lockbox", () => {
  const engine = engineOf(solvedDefaultLockboxViaRunner());

  it("returns a removable part with a real clear axis and the engine's own exit", () => {
    const target = pickHintTarget(engine);
    expect(target).not.toBeNull();
    if (target === null || target.kind !== "part") throw new Error("expected a part hint");
    expect(removable(engine)).toContain(target.partId);
    const part = engine.level.partsById.get(target.partId);
    const axes = clearAxes(engine, target.partId);
    expect(axes.some((axis) => sameDir(part?.candidateAxes[axis] as Vec3, target.dir))).toBe(true);
    expect(Number.isFinite(target.distance)).toBe(true);
    expect(target.distance).toBeGreaterThanOrEqual(0);
    // Clicking the hinted part is legal and exits along the hinted direction.
    const { result } = attemptUnbolt(engine, target.partId);
    expect(result.kind).toBe("legal");
    if (result.kind === "legal") {
      expect(sameDir(result.dir, target.dir)).toBe(true);
      expect(result.escapeDistance).toBeCloseTo(target.distance, 9);
    }
  });

  it("prefers a removable fastener, and otherwise the shortest escape", () => {
    const candidates = removable(engine);
    const fasteners = candidates.filter((id) => engine.level.partsById.get(id)?.isFastener === true);
    const target = pickHintTarget(engine);
    if (target === null || target.kind !== "part") throw new Error("expected a part hint");
    const pool = fasteners.length > 0 ? fasteners : candidates;
    expect(pool).toContain(target.partId);
    expect(target.distance).toBeCloseTo(bestDistanceOf(engine, pool), 9);
  });

  it("walks the whole Lockbox to victory with no mistakes by following hints", () => {
    let state = engine;
    let steps = 0;
    while (state.outcome === null) {
      const target = pickHintTarget(state);
      if (target === null || target.kind !== "part") throw new Error("a solved Lockbox must never deadlock");
      const next = attemptUnbolt(state, target.partId);
      expect(next.result.kind).toBe("legal");
      state = next.state;
      steps += 1;
      expect(steps).toBeLessThanOrEqual(engine.level.parts.length);
    }
    expect(state.outcome).toBe("victory");
    expect(state.mistakes).toBe(0);
    expect(state.removed.size).toBe(engine.level.parts.length);
    expect(pickHintTarget(state)).toBeNull();
  });
});

describe("pickHintTarget on the Dumbbell Cage", () => {
  const engine = engineOf(solvedDumbbellCage());

  it("reports a deadlock from the first move, because no part can move", () => {
    expect(pickHintTarget(engine)).toEqual({ kind: "deadlock" });
    // The verdict is true to the geometry: nothing is removable and the SCC is fully live.
    expect(removable(engine)).toEqual([]);
    expect(genuineDeadlockSccs(engine).length).toBeGreaterThan(0);
  });

  it("names the Flag Interlock Trap lever only when a hint is asked for", () => {
    const session = createHintSession();
    expect(session.getSnapshot().banner).toBeNull();
    expect(session.request(engine)).toEqual({ kind: "deadlock" });
    expect(session.getSnapshot().banner?.text).toContain("Flag Interlock Trap");
    expect(session.getHintsUsed()).toBe(1);
  });
});

describe("hint session", () => {
  const engine = engineOf(solvedDefaultLockboxViaRunner());
  const loaded: GameEvent = { kind: "level_loaded", seq: 0, at: 0, epoch: 1, label: "x", totalParts: 3 };
  const ctx = { getState: () => ({}) as GameState, engine: () => engine } as ModuleContext;

  it("counts hints, tells the Arena, and resets on level_loaded (new level and replay)", () => {
    const session = createHintSession();
    const shown: string[] = [];
    session.onShow((request) => shown.push(request.partId));
    expect(session.getHintsUsed()).toBe(0);
    const first = session.request(engine);
    session.request(engine);
    expect(session.getHintsUsed()).toBe(2);
    expect(first?.kind).toBe("part");
    expect(shown).toHaveLength(2);
    expect(session.getSnapshot().banner?.text.startsWith("HINT:")).toBe(true);
    session.onEvent(loaded, ctx);
    expect(session.getHintsUsed()).toBe(0);
    expect(session.getSnapshot().banner).toBeNull();
  });

  it("counts nothing without a level in play", () => {
    const session = createHintSession();
    expect(session.request(null)).toBeNull();
    expect(session.getHintsUsed()).toBe(0);
  });

  it("describes directions in words", () => {
    expect(describeDirection([0, 1, 0])).toBe("up");
    expect(describeDirection([-1, 0, 0])).toBe("left");
    expect(describeDirection([0, 0, 1])).toBe("toward you");
    expect(describeDirection([0.7, 0.7, 0])).toBe("up and right");
  });
});

describe("ghost preview helpers", () => {
  it("clamps travel and holds a steady opacity under reduced motion", () => {
    expect(ghostTravel(0)).toBe(GHOST_MIN_TRAVEL);
    expect(ghostTravel(5)).toBe(GHOST_MAX_TRAVEL);
    expect(ghostTravel(Infinity)).toBe(GHOST_MAX_TRAVEL);
    expect(ghostOpacity(0, true)).toBe(ghostOpacity(333, true));
    expect(ghostOpacity(0, false)).not.toBe(ghostOpacity(225, false));
  });
});

describe("computeStars", () => {
  it("gives 3 stars only for a clean run without hints", () => {
    expect(computeStars({ mistakes: 0, falseAlarms: 0 }, 0)).toBe(3);
  });
  it("gives 2 stars for up to two slips, or a clean run with a hint", () => {
    expect(computeStars({ mistakes: 1, falseAlarms: 0 }, 0)).toBe(2);
    expect(computeStars({ mistakes: 1, falseAlarms: 1 }, 0)).toBe(2);
    expect(computeStars({ mistakes: 0, falseAlarms: 2 }, 0)).toBe(2);
    expect(computeStars({ mistakes: 0, falseAlarms: 0 }, 1)).toBe(2);
  });
  it("gives 1 star for three or more slips", () => {
    expect(computeStars({ mistakes: 3, falseAlarms: 0 }, 0)).toBe(1);
    expect(computeStars({ mistakes: 2, falseAlarms: 1 }, 5)).toBe(1);
  });
  it("rates an Interlock Exposed run the same way (no mistakes, no hints is 3 stars)", () => {
    const exposed = summary({ mistakes: 0, falseAlarms: 0 });
    expect(computeStars(exposed, 0)).toBe(3);
    expect(computeStars({ ...exposed, falseAlarms: 1 }, 0)).toBe(2);
    expect(computeStars({ ...exposed, falseAlarms: 3 }, 0)).toBe(1);
  });
});

describe("campaign", () => {
  it("lists the five stages in order across all five bundled kits", () => {
    expect(CAMPAIGN_STAGES.map((stage) => stage.title)).toEqual([
      "Haunted Clockwork Lockbox",
      "Dumbbell & Captive Ring",
      "3-Stage Planetary Gearbox",
      "Ship in a Bottle",
      "65% Mechanical Keyboard",
    ]);
    expect(CAMPAIGN_STAGES.map((stage) => stage.difficulty)).toEqual([
      "Apprentice",
      "Deadlock Inspection",
      "Journeyman",
      "Deadlock Inspection",
      "Grandmaster Blitz",
    ]);
    expect(new Set(CAMPAIGN_STAGES.map((stage) => stage.levelId)).size).toBe(5);
    expect(MAX_CAMPAIGN_STARS).toBe(15);
    expect(nextStageAfter("lockbox")?.levelId).toBe("dumbbell-cage");
    expect(nextStageAfter("keyboard-65")).toBeNull();
  });
});

describe("campaignStore", () => {
  it("records bests and star totals through an in-memory adapter", () => {
    const storage = createMemoryStorage();
    const store = createCampaignStore({ storage });
    expect(store.totalStars()).toBe(0);

    const first = store.recordRun("lockbox", summary({ score: 900, elapsedMs: 70_000, mistakes: 3 }), 0);
    expect(first.stars).toBe(1);
    expect(first.isNewBest).toBe(true);
    expect(first.next?.levelId).toBe("dumbbell-cage");
    expect(store.getRecord("lockbox")).toEqual({ bestScore: 900, bestTimeMs: 70_000, bestStars: 1 });

    // Better score and stars, slower time.
    const second = store.recordRun("lockbox", summary({ score: 1200, elapsedMs: 80_000, mistakes: 1 }), 0);
    expect(second.newBest).toEqual({ score: true, time: false, stars: true });
    expect(store.getRecord("lockbox")).toEqual({ bestScore: 1200, bestTimeMs: 70_000, bestStars: 2 });

    // A worse run changes nothing and shows no badge.
    const worse = store.recordRun("lockbox", summary({ score: 100, elapsedMs: 200_000, mistakes: 5 }), 0);
    expect(worse.isNewBest).toBe(false);
    expect(store.getRecord("lockbox")).toEqual({ bestScore: 1200, bestTimeMs: 70_000, bestStars: 2 });

    store.recordRun("keyboard-65", summary(), 0);
    expect(store.totalStars()).toBe(2 + 3);
    expect(store.getSnapshot().totalStars).toBe(5);

    // A new store on the same storage sees the saved bests.
    const reloaded = createCampaignStore({ storage });
    expect(reloaded.totalStars()).toBe(5);
    expect(reloaded.getRecord("keyboard-65")?.bestStars).toBe(3);
  });

  it("rates a custom upload but never saves it", () => {
    const storage = createMemoryStorage();
    const store = createCampaignStore({ storage });
    const result = store.recordRun(null, summary(), 0);
    expect(result.stars).toBe(3);
    expect(result.isNewBest).toBe(false);
    expect(result.next).toBeNull();
    expect(storage.getItem(CAMPAIGN_STORAGE_KEY)).toBeNull();
  });

  it("ignores saved data that is corrupt or out of range, and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = createCampaignStore({ storage: createMemoryStorage({ [CAMPAIGN_STORAGE_KEY]: "{nope" }) });
    expect(broken.totalStars()).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const invalid = createCampaignStore({
      storage: createMemoryStorage({
        [CAMPAIGN_STORAGE_KEY]: JSON.stringify({
          lockbox: { bestScore: -5, bestTimeMs: 1, bestStars: 3 },
          "dumbbell-cage": { bestScore: 5, bestTimeMs: 1, bestStars: 9 },
          "keyboard-65": { bestScore: 5, bestTimeMs: 1, bestStars: 2 },
        }),
      }),
    });
    expect(invalid.totalStars()).toBe(2);
  });

  it("rates a finished run from the event, with the hints of that run", () => {
    let hints = 0;
    const store = createCampaignStore({ storage: createMemoryStorage(), getHintsUsed: () => hints });
    const state = {
      screen: { kind: "level", loaded: { ref: { kind: "bundled", levelId: "ship-in-bottle" } } },
    } as unknown as GameState;
    const ctx: ModuleContext = { getState: () => state, engine: () => null };
    const completed = (outcome: "victory" | "interlock_exposed"): GameEvent => ({
      kind: "level_completed",
      seq: 5,
      at: 10,
      outcome,
      summary: summary({ score: 1500 }),
      sccs: [],
    });
    hints = 1;
    store.onEvent(completed("interlock_exposed"), ctx);
    expect(store.getSnapshot().lastResult?.stars).toBe(2);
    expect(store.getRecord("ship-in-bottle")?.bestStars).toBe(2);
    store.onEvent({ kind: "level_loaded", seq: 0, at: 0, epoch: 2, label: "x", totalParts: 1 }, ctx);
    expect(store.getSnapshot().lastResult).toBeNull();
    hints = 0;
    store.onEvent(completed("interlock_exposed"), ctx);
    expect(store.getSnapshot().lastResult?.stars).toBe(3);
    expect(store.totalStars()).toBe(3);
  });
});

/** A fake Web Audio context that counts the nodes it creates. */
function fakeAudio() {
  const counts = { oscillators: 0, sources: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  });
  const node = () => ({ connect: () => undefined });
  const context: AudioContextLike = {
    currentTime: 0,
    sampleRate: 8000,
    state: "running",
    destination: {},
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
    createOscillator: () => {
      counts.oscillators += 1;
      return { ...node(), type: "sine", frequency: param(), start: () => undefined, stop: () => undefined };
    },
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: "lowpass", frequency: param(), Q: param() }),
    createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => {
      counts.sources += 1;
      return { ...node(), buffer: null, start: () => undefined, stop: () => undefined };
    },
  };
  return { counts, context };
}

function removedEvent(comboAfter: number, primitive: string): GameEvent {
  return {
    kind: "part_removed",
    seq: 1,
    at: 0,
    partId: "p",
    step: { partId: "p", primitive, params: {} } as unknown as TrajectoryStep,
    points: 100,
    fastenerBonus: 0,
    awarded: 100,
    comboBefore: comboAfter - 1,
    comboAfter,
    scoreAfter: 100,
    removed: 1,
    total: 2,
  };
}

const blockedEvent: GameEvent = {
  kind: "part_blocked",
  seq: 2,
  at: 0,
  partId: "p",
  blockerIds: ["q"],
  comboBefore: 3,
  comboAfter: 1,
  penaltyMs: 3000,
  mistakes: 1,
  scoreAfter: 0,
};

function fundamentalOfChime(specs: readonly SoundSpec[]): number {
  const chime = specs.find((spec) => spec.kind === "tone" && spec.wave === "sine" && spec.at > 0);
  if (chime === undefined || chime.kind !== "tone") throw new Error("no chime");
  return chime.freq;
}

describe("soundModule", () => {
  it("is a silent no-op when there is no AudioContext", () => {
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
    const sound = createSoundModule({ storage: createMemoryStorage() });
    const ctx: ModuleContext = { getState: () => ({}) as GameState, engine: () => null };
    expect(() => {
      sound.onEvent(removedEvent(2, "helical_unscrew"), ctx);
      sound.onEvent(blockedEvent, ctx);
      sound.setMuted(true);
      sound.setMuted(false);
      sound.dispose?.();
    }).not.toThrow();
  });

  it("toggles and persists the mute state, and tells subscribers", () => {
    const storage = createMemoryStorage();
    const sound = createSoundModule({ storage, createContext: () => null });
    const listener = vi.fn();
    const unsubscribe = sound.subscribe(listener);
    expect(sound.isMuted()).toBe(false);
    expect(sound.toggleMuted()).toBe(true);
    expect(sound.isMuted()).toBe(true);
    expect(storage.getItem(MUTE_STORAGE_KEY)).toBe("1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(createSoundModule({ storage, createContext: () => null }).isMuted()).toBe(true);
    expect(sound.toggleMuted()).toBe(false);
    expect(storage.getItem(MUTE_STORAGE_KEY)).toBe("0");
    unsubscribe();
    sound.setMuted(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("plays through the context unless muted, and never creates a context while muted", () => {
    const { counts, context } = fakeAudio();
    const createContext = vi.fn(() => context);
    const sound = createSoundModule({ storage: createMemoryStorage({ [MUTE_STORAGE_KEY]: "1" }), createContext });
    const ctx: ModuleContext = { getState: () => ({}) as GameState, engine: () => null };
    sound.onEvent(blockedEvent, ctx);
    expect(createContext).not.toHaveBeenCalled();
    expect(counts.oscillators).toBe(0);
    sound.setMuted(false);
    const afterUnmute = counts.oscillators;
    expect(afterUnmute).toBeGreaterThan(0);
    sound.onEvent(blockedEvent, ctx);
    expect(counts.oscillators).toBeGreaterThan(afterUnmute);
    expect(counts.sources).toBeGreaterThan(0);
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it("scales the chime with the combo from x1 to x8 and adds a ratchet for helical unscrews", () => {
    const pitches = [1, 2, 3, 4, 5, 6, 7, 8].map((combo) => fundamentalOfChime(soundRecipe(removedEvent(combo, "linear_slide"))));
    for (let i = 1; i < pitches.length; i += 1) expect(pitches[i] as number).toBeGreaterThan(pitches[i - 1] as number);
    expect(chimeFrequency(99)).toBe(chimeFrequency(8));
    expect(chimeFrequency(0)).toBe(chimeFrequency(1));
    const plain = soundRecipe(removedEvent(2, "linear_slide"));
    const ratchet = soundRecipe(removedEvent(2, "helical_unscrew"));
    expect(ratchet.length).toBeGreaterThan(plain.length);
    expect(ratchet.filter((spec) => spec.kind === "noise").length).toBeGreaterThan(
      plain.filter((spec) => spec.kind === "noise").length,
    );
  });

  it("has a cue for each sound event and none for the rest", () => {
    const base = { seq: 0, at: 0 } as const;
    const cues: GameEvent[] = [
      blockedEvent,
      { kind: "trap_flagged", ...base, sccs: [["a"]], bonus: 1000, scoreAfter: 1000 },
      { kind: "false_alarm", ...base, penaltyApplied: 250, comboBefore: 2, scoreAfter: 0, penaltyMs: 3000, falseAlarms: 1 },
      { kind: "level_completed", ...base, outcome: "victory", summary: summary(), sccs: [] },
    ];
    for (const cue of cues) expect(soundRecipe(cue).length).toBeGreaterThan(0);
    expect(soundRecipe({ kind: "level_started", ...base, epoch: 1 })).toEqual([]);
    expect(soundRecipe({ kind: "click_rejected", ...base, partId: "p", reason: "not_live" })).toEqual([]);
    // The false-alarm buzz descends and the blocked clank is low.
    const buzz = soundRecipe(cues[2] as GameEvent)[0];
    expect(buzz?.kind === "tone" && (buzz.freqEnd ?? buzz.freq) < buzz.freq).toBe(true);
  });
});

describe("registration and isolation", () => {
  it("registers the hint, sound and campaign modules", () => {
    expect(GAME_MODULES.map((module) => module.id)).toEqual(["ghost-hint", "clockwork-sound", "campaign-store"]);
  });

  it("loads no audio file, makes no network request and never imports guide-forge", () => {
    const files = readSrcFiles([".ts", ".tsx"]);
    const sound = files.find((file) => file.path.endsWith("modules/soundModule.ts"));
    expect(sound).toBeDefined();
    const banned = [/\bfetch\(/, /XMLHttpRequest/, /new Audio\(/, /\.(mp3|wav|ogg|m4a|flac)\b/, /decodeAudioData/];
    for (const pattern of banned) expect(pattern.test(sound?.text ?? "")).toBe(false);
    const offenders = files.filter((file) => /from\s+["'][^"']*guide-forge/.test(file.text));
    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});

describe("keyboard shortcuts", () => {
  const playing = { completed: false };
  const done = { completed: true };
  it("maps H, M and R, with R only after the level ends", () => {
    expect(resolveShortcut({ key: "h" }, playing)).toBe("hint");
    expect(resolveShortcut({ key: "H" }, playing)).toBe("hint");
    expect(resolveShortcut({ key: "m" }, playing)).toBe("mute");
    expect(resolveShortcut({ key: "r" }, playing)).toBeNull();
    expect(resolveShortcut({ key: "r" }, done)).toBe("replay");
    expect(resolveShortcut({ key: "x" }, done)).toBeNull();
  });
  it("ignores inputs, selects, text areas, modifiers and key repeat", () => {
    for (const tagName of ["INPUT", "SELECT", "TEXTAREA"]) {
      expect(resolveShortcut({ key: "h", target: { tagName } }, playing)).toBeNull();
    }
    expect(resolveShortcut({ key: "h", target: { tagName: "DIV", isContentEditable: true } }, playing)).toBeNull();
    expect(resolveShortcut({ key: "h", target: { tagName: "BUTTON" } }, playing)).toBe("hint");
    expect(resolveShortcut({ key: "m", metaKey: true }, playing)).toBeNull();
    expect(resolveShortcut({ key: "m", ctrlKey: true }, playing)).toBeNull();
    expect(resolveShortcut({ key: "m", repeat: true }, playing)).toBeNull();
  });
});
