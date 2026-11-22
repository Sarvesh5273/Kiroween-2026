import { describe, expect, it } from "vitest";
import type { TrajectoryStep } from "@unboltkit/core";
import type { GameEvent, GameEventKind } from "../../src/game/events";
import { comboTier, edgeFlashTone } from "../../src/hud/hudModel";
import type { ComboTier } from "../../src/hud/hudModel";
import { stageLabel, stageLabelText } from "../../src/hud/LevelSelector";
import { BUNDLED_LEVELS } from "../../src/levels";
import { CAMPAIGN_STAGES } from "../../src/modules/campaignStore";

const TIER_RANK: Readonly<Record<ComboTier, number>> = { base: 0, amber: 1, gold: 2, spectral: 3 };

describe("comboTier", () => {
  it("maps x1 to base, x2-x3 to amber, x4-x6 to gold and x7-x8 to spectral", () => {
    const tiers = [1, 2, 3, 4, 5, 6, 7, 8].map((value) => comboTier(value));
    expect(tiers).toEqual(["base", "amber", "amber", "gold", "gold", "gold", "spectral", "spectral"]);
  });

  it("never lowers the tier as the combo grows", () => {
    for (let value = 1; value < 8; value++) {
      expect(TIER_RANK[comboTier(value + 1)]).toBeGreaterThanOrEqual(TIER_RANK[comboTier(value)]);
    }
  });

  it("treats values below x2 and non-numbers as the base tier and caps high values at spectral", () => {
    for (const value of [0, -3, 1.9, Number.NaN, -Infinity]) expect(comboTier(value)).toBe("base");
    expect(comboTier(2.5)).toBe("amber");
    expect(comboTier(99)).toBe("spectral");
  });
});

describe("edgeFlashTone", () => {
  const step: TrajectoryStep = {
    partId: "p",
    primitive: "linear_slide",
    params: { kind: "linear_slide", dir: [1, 0, 0], distance: 0.5 },
  };
  const base = { seq: 1, at: 100 } as const;
  const oneOfEachKind: Record<GameEventKind, GameEvent> = {
    level_loaded: { kind: "level_loaded", ...base, epoch: 1, label: "Lockbox", totalParts: 4 },
    level_started: { kind: "level_started", ...base, epoch: 1 },
    part_removed: {
      kind: "part_removed",
      ...base,
      partId: "p",
      step,
      points: 100,
      fastenerBonus: 0,
      awarded: 100,
      comboBefore: 1,
      comboAfter: 2,
      scoreAfter: 100,
      removed: 1,
      total: 4,
    },
    part_blocked: {
      kind: "part_blocked",
      ...base,
      partId: "p",
      blockerIds: ["q"],
      comboBefore: 3,
      comboAfter: 1,
      penaltyMs: 3000,
      mistakes: 1,
      scoreAfter: 0,
    },
    click_rejected: { kind: "click_rejected", ...base, partId: "p", reason: "not_live" },
    trap_flagged: { kind: "trap_flagged", ...base, sccs: [["a", "b"]], bonus: 1000, scoreAfter: 1000 },
    false_alarm: {
      kind: "false_alarm",
      ...base,
      penaltyApplied: 250,
      comboBefore: 2,
      scoreAfter: 0,
      penaltyMs: 3000,
      falseAlarms: 1,
    },
    level_completed: {
      kind: "level_completed",
      ...base,
      outcome: "victory",
      summary: { score: 1000, elapsedMs: 60_000, mistakes: 0, falseAlarms: 0, removed: 4, total: 4 },
      sccs: [],
    },
  };

  it("flashes crimson for a blocked attempt and a false alarm, and teal for a removed part", () => {
    expect(edgeFlashTone(oneOfEachKind.part_blocked)).toBe("crimson");
    expect(edgeFlashTone(oneOfEachKind.false_alarm)).toBe("crimson");
    expect(edgeFlashTone(oneOfEachKind.part_removed)).toBe("teal");
  });

  it("stays silent for every other event kind", () => {
    const flashing: GameEventKind[] = ["part_blocked", "false_alarm", "part_removed"];
    const quiet = (Object.keys(oneOfEachKind) as GameEventKind[]).filter((kind) => !flashing.includes(kind));
    expect(quiet.length).toBeGreaterThan(0);
    for (const kind of quiet) expect(edgeFlashTone(oneOfEachKind[kind])).toBeNull();
  });
});

describe("stage pill label", () => {
  it("names every bundled level by its campaign stage number and title", () => {
    expect(BUNDLED_LEVELS.length).toBe(CAMPAIGN_STAGES.length);
    for (const level of BUNDLED_LEVELS) {
      const label = stageLabel({ kind: "bundled", levelId: level.id });
      const stage = CAMPAIGN_STAGES.find((candidate) => candidate.levelId === level.id);
      expect(stage, `campaign stage for ${level.id}`).toBeDefined();
      expect(label.lead).toBe(`Stage ${stage?.stage}`);
      expect(label.title).toBe(stage?.title);
    }
  });

  it("reads 'Stage 1 · Haunted Clockwork Lockbox' for the default level", () => {
    expect(stageLabelText(stageLabel({ kind: "bundled", levelId: "lockbox" }))).toBe(
      "Stage 1 · Haunted Clockwork Lockbox",
    );
  });

  it("shows the file name for an upload and a prompt when no level is chosen", () => {
    expect(stageLabelText(stageLabel({ kind: "custom", fileName: "gearbox.glb" }))).toBe("Custom · gearbox.glb");
    expect(stageLabelText(stageLabel(null))).toBe("Choose a stage");
  });
});
