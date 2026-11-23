/**
 * Pure selectors over `AppState` and `SolveResult`.
 *
 * No React, no DOM and no three import, so components and Node tests share one source of truth.
 * Every number and label comes from the oracle, naive and plan data in the `SolveResult`. Nothing
 * here claims the guide is verified: the legacy ray clash count is a diagnostic, zero hits is not
 * proof that a move is clear, and one checked move ("Check this move") does not verify the guide.
 */
import type { NaiveBaselineResult } from "@unboltkit/core";
import { STAGE_NAMES } from "../protocol";
import type { PartRenderData, SolveResult, StageName } from "../protocol";
import type { AppState, Mode } from "./types";

// ---------------------------------------------------------------------------
// Clash badge (Requirements 9.5, 10.3, 10.4, 10.5)
// ---------------------------------------------------------------------------

export interface ClashBadgeModel {
  icon: "check" | "warn" | "interlock" | "unverified" | "none";
  text: string;
}

/** What Guide Forge says about the whole guide until a full check of every step has completed. */
export const GUIDE_NOT_VERIFIED_TEXT = "Full guide not verified";

/** `1 legacy ray hit`, `3 legacy ray hits`. */
export function legacyRayHitsText(count: number): string {
  return `${count} legacy ray ${count === 1 ? "hit" : "hits"}`;
}

export const BADGE_NO_PLAN_TEXT = "No plan loaded";
export const BADGE_INTERLOCKED_TEXT = "Interlocked • No Valid Sequence";

export function selectClashBadge(result: SolveResult | null, mode: Mode): ClashBadgeModel {
  if (result === null || result.plan.status === "error") {
    return { icon: "none", text: BADGE_NO_PLAN_TEXT };
  }

  if (mode === "naive") {
    const naive = result.naive;
    if (naive === null) return { icon: "none", text: BADGE_NO_PLAN_TEXT };
    const obstructed = naive.perPart.filter((entry) => entry.clashCount > 0).length;
    return { icon: "warn", text: `${naive.totalClashes} Clashes • ${obstructed} Obstructed Parts` };
  }

  if (result.plan.status === "deadlocked") {
    return { icon: "interlock", text: BADGE_INTERLOCKED_TEXT };
  }

  // Solved plan in DBG mode. No full-guide check has run, so the guide is not verified whatever the
  // legacy ray count says. The count stays visible as a diagnostic.
  const oracle = result.oracle;
  if (oracle === null) return { icon: "unverified", text: GUIDE_NOT_VERIFIED_TEXT };
  return { icon: "unverified", text: `${GUIDE_NOT_VERIFIED_TEXT} • ${legacyRayHitsText(oracle.totalClashes)}` };
}

// ---------------------------------------------------------------------------
// Control enablement (Requirements 10.8, 13.7, 14.9)
// ---------------------------------------------------------------------------

export interface ControlEnablement {
  /** A result exists and its plan is not an error. */
  heroToggle: boolean;
  /** DBG mode, solved plan, at least one step. */
  timeline: boolean;
  /** DBG: same as the timeline. Naive: a naive report is present. */
  explodeSlider: boolean;
  /** Timeline enabled and the OS does not request reduced motion. */
  play: boolean;
}

export function selectControlEnablement(state: AppState): ControlEnablement {
  const result = state.solve.result;
  const heroToggle = result !== null && result.plan.status !== "error";
  const mode = state.view.mode;

  const timeline =
    heroToggle &&
    mode === "dbg" &&
    result !== null &&
    result.plan.status === "solved" &&
    result.plan.steps.length >= 1;

  const explodeSlider =
    mode === "dbg" ? timeline : heroToggle && result !== null && result.naive !== null;

  return { heroToggle, timeline, explodeSlider, play: timeline && !state.view.reducedMotion };
}

/** Same value as `selectControlEnablement(state).heroToggle`. The reducer gates `view/modeSet` on it. */
export function selectModeToggleEnabled(state: AppState): boolean {
  return selectControlEnablement(state).heroToggle;
}

// ---------------------------------------------------------------------------
// Part names and lookups
// ---------------------------------------------------------------------------

/**
 * Human-friendly Part name from the source node name (Requirement 15.3). `_` and `-` become spaces,
 * runs of whitespace collapse and the first letter is capitalized (`clock_gear_2` gives
 * `Clock gear 2`). A blank name gives `Part ` plus the Part_ID.
 */
export function partDisplayName(nodeName: string, partId: string): string {
  const trimmed = nodeName.trim();
  if (trimmed === "") return `Part ${partId}`;
  const humanized = trimmed.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  // A name made only of separators (for example "_") still is not blank, so keep it as typed.
  const base = humanized === "" ? trimmed : humanized;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export type NaivePartEntry = NaiveBaselineResult["perPart"][number];

/** `partId` to naive `perPart` entry. Empty when there is no naive report. */
export function selectNaiveLookup(result: SolveResult | null): Map<string, NaivePartEntry> {
  const lookup = new Map<string, NaivePartEntry>();
  if (result === null || result.naive === null) return lookup;
  for (const entry of result.naive.perPart) lookup.set(entry.partId, entry);
  return lookup;
}

function renderPartLookup(result: SolveResult): Map<string, PartRenderData> {
  const lookup = new Map<string, PartRenderData>();
  for (const part of result.parts) lookup.set(part.partId, part);
  return lookup;
}

function displayNameOf(partId: string, parts: ReadonlyMap<string, PartRenderData>): string {
  return partDisplayName(parts.get(partId)?.nodeName ?? "", partId);
}

/** Groups blocking edges by unique `(from, to)` pair, counting the directions of each. */
export function groupEdgesByPair(edges: readonly { from: string; to: string }[]): DeadlockEdgeGroup[] {
  const groups = new Map<string, DeadlockEdgeGroup>();
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, { from: edge.from, to: edge.to, directionCount: 1 });
    else existing.directionCount += 1;
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Deadlock model (Requirements 14.2, 14.3, 14.4, 14.5)
// ---------------------------------------------------------------------------

/** One unique `(from, to)` blocking pair of a cycle and the number of directions that block it. */
export interface DeadlockEdgeGroup {
  from: string;
  to: string;
  directionCount: number;
}

export interface DeadlockModel {
  cycles: {
    number: number;
    partNames: string[];
    edges: { from: string; to: string }[];
    /** `edges` grouped by unique `(from, to)` pair, in first-seen order. */
    edgeGroups: DeadlockEdgeGroup[];
  }[];
  /** Union of `witness.sccs[*].partIds`. */
  deadlockedPartIds: Set<string>;
  /** Unassigned and not deadlocked. */
  amberPartIds: Set<string>;
  /** Deadlocked first, then amber, no duplicates. */
  lockedPartIds: string[];
  /** `witness.unassignedPartIds.length`. */
  unassignedCount: number;
  /** Unique members across all cycles plus `witness.unassignedPartIds.length`. */
  lockedCount: number;
  /** `plan.steps.length`: steps peeled before the deadlock. */
  peeledCount: number;
  /** Display name per Part_ID for every Part named by a cycle or the locked list. */
  partNameById: Record<string, string>;
}

export function selectDeadlockModel(result: SolveResult): DeadlockModel | null {
  const plan = result.plan;
  if (plan.status !== "deadlocked") return null;

  const parts = renderPartLookup(result);
  const { sccs, unassignedPartIds } = plan.witness;

  const deadlockedOrdered: string[] = [];
  const deadlockedPartIds = new Set<string>();
  for (const scc of sccs) {
    for (const partId of scc.partIds) {
      if (!deadlockedPartIds.has(partId)) {
        deadlockedPartIds.add(partId);
        deadlockedOrdered.push(partId);
      }
    }
  }

  const amberOrdered: string[] = [];
  const amberPartIds = new Set<string>();
  for (const partId of unassignedPartIds) {
    if (!deadlockedPartIds.has(partId) && !amberPartIds.has(partId)) {
      amberPartIds.add(partId);
      amberOrdered.push(partId);
    }
  }

  const partNameById: Record<string, string> = {};
  for (const scc of sccs) {
    for (const partId of scc.partIds) partNameById[partId] = displayNameOf(partId, parts);
    for (const edge of scc.edges) {
      partNameById[edge.from] = displayNameOf(edge.from, parts);
      partNameById[edge.to] = displayNameOf(edge.to, parts);
    }
  }
  for (const partId of amberOrdered) partNameById[partId] = displayNameOf(partId, parts);

  return {
    cycles: sccs.map((scc, index) => ({
      number: index + 1,
      partNames: scc.partIds.map((partId) => displayNameOf(partId, parts)),
      edges: scc.edges.map((edge) => ({ from: edge.from, to: edge.to })),
      edgeGroups: groupEdgesByPair(scc.edges),
    })),
    deadlockedPartIds,
    amberPartIds,
    lockedPartIds: [...deadlockedOrdered, ...amberOrdered],
    unassignedCount: unassignedPartIds.length,
    lockedCount: deadlockedOrdered.length + unassignedPartIds.length,
    peeledCount: plan.steps.length,
    partNameById,
  };
}

// ---------------------------------------------------------------------------
// Manifest rows and BOM (Requirements 13.4, 14.7, 15.1, 15.2, 15.3, 15.7, 15.8)
// ---------------------------------------------------------------------------

export interface ManifestRow {
  /** Zero-based step index. */
  index: number;
  /** `index + 1`. */
  number: number;
  partId: string;
  name: string;
  /** `null` renders the "Not compiled" label. */
  primitive: string | null;
  /** `escapeDistance.toFixed(3)`, normalized units. */
  escapeDistanceText: string;
  /** Naive mode only. */
  clashCount: number | null;
  /** Naive mode and `clashCount > 0`. */
  obstructed: boolean;
  /** The Part is in a witness SCC. */
  interlocked: boolean;
  selected: boolean;
}

export function selectManifestRows(state: AppState): ManifestRow[] {
  const result = state.solve.result;
  if (result === null || result.plan.status === "error") return [];

  const plan = result.plan;
  const parts = renderPartLookup(result);
  const naive = state.view.mode === "naive" ? selectNaiveLookup(result) : null;
  const deadlock = selectDeadlockModel(result);
  const trajectory = result.trajectory;

  return plan.steps.map((step, index) => {
    const entry = naive?.get(step.partId);
    const clashCount = naive === null ? null : (entry?.clashCount ?? null);
    return {
      index,
      number: index + 1,
      partId: step.partId,
      name: displayNameOf(step.partId, parts),
      primitive: trajectory?.[index]?.primitive ?? null,
      escapeDistanceText: step.escapeDistance.toFixed(3),
      clashCount,
      obstructed: clashCount !== null && clashCount > 0,
      interlocked: deadlock?.deadlockedPartIds.has(step.partId) ?? false,
      selected: state.view.selectedStepIndex === index,
    };
  });
}

export interface LockedPartRow {
  partId: string;
  name: string;
  /** In a witness SCC (icon and "Interlocked" label). Otherwise an unassigned amber Part. */
  interlocked: boolean;
  /** Naive mode only. */
  clashCount: number | null;
  obstructed: boolean;
}

/** Rows of the "Locked Parts" list: each deadlocked Part, then each other unassigned Part (Requirement 15.8). */
export function selectLockedPartRows(state: AppState): LockedPartRow[] {
  const result = state.solve.result;
  if (result === null) return [];
  const deadlock = selectDeadlockModel(result);
  if (deadlock === null) return [];

  const naive = state.view.mode === "naive" ? selectNaiveLookup(result) : null;
  return deadlock.lockedPartIds.map((partId) => {
    const clashCount = naive === null ? null : (naive.get(partId)?.clashCount ?? null);
    return {
      partId,
      name: deadlock.partNameById[partId] ?? `Part ${partId}`,
      interlocked: deadlock.deadlockedPartIds.has(partId),
      clashCount,
      obstructed: clashCount !== null && clashCount > 0,
    };
  });
}

export interface BomSummary {
  totalParts: number;
  helical: number;
  linear: number;
  other: number;
}

export function selectBom(result: SolveResult): BomSummary {
  let helical = 0;
  let linear = 0;
  let other = 0;
  for (const step of result.trajectory ?? []) {
    if (step.primitive === "helical_unscrew") helical += 1;
    else if (step.primitive === "linear_slide") linear += 1;
    else other += 1;
  }
  return { totalParts: result.parts.length, helical, linear, other };
}

// ---------------------------------------------------------------------------
// Pipeline telemetry (Requirements 5.6, 16.2)
// ---------------------------------------------------------------------------

export interface StageDisplay {
  stage: StageName;
  state: "pending" | "started" | "completed" | "skipped";
  /** Milliseconds since the solve began, at the latest event of the stage. */
  elapsedMs: number | null;
  /** Duration of the stage itself. `null` until the stage completes, and for a skipped stage. */
  durationMs: number | null;
}

/** Stages that never run for a deadlocked plan. */
const SKIPPED_FOR_DEADLOCK: readonly StageName[] = ["stage4", "oracle"];

/** Seven entries in fixed `STAGE_NAMES` order. */
export function selectProgressStrip(state: AppState): StageDisplay[] {
  const { status, progress, result } = state.solve;
  return STAGE_NAMES.map((stage): StageDisplay => {
    const event = progress[stage];
    if (event !== undefined) {
      return { stage, state: event.state, elapsedMs: event.elapsedMs, durationMs: event.durationMs };
    }

    if (status === "ready" && result !== null) {
      const planStatus = result.plan.status;
      if (planStatus === "error") return { stage, state: "skipped", elapsedMs: null, durationMs: null };
      if (planStatus === "deadlocked" && SKIPPED_FOR_DEADLOCK.includes(stage)) {
        return { stage, state: "skipped", elapsedMs: null, durationMs: null };
      }
    }
    return { stage, state: "pending", elapsedMs: null, durationMs: null };
  });
}

/** What each pipeline stage does, as a present-participle phrase for the live progress strip. */
const STAGE_ACTIVITY: Readonly<Record<StageName, string>> = {
  stage0: "Stage 0: Parsing scene graph...",
  stage1: "Stage 1: Normalizing parts...",
  stage2: "Stage 2: Building Swept-Ray DBG...",
  stage3: "Stage 3: Peeling removal order...",
  stage4: "Stage 4: Compiling motion primitives...",
  oracle: "Legacy ray check: Counting ray hits (diagnostic)...",
  naive: "Naive baseline: Counting radial-explode clashes...",
};

/** Progress strip text for the stage that is running, for example `Stage 2: Building Swept-Ray DBG...`. */
export function stageActivityLabel(stage: StageName): string {
  return STAGE_ACTIVITY[stage];
}

export interface PipelineTelemetry {
  /** `running` while a solve is loading, `done` once a result is in, `idle` otherwise. */
  phase: "idle" | "running" | "done";
  /** The stage that has started and not yet completed. */
  activeStage: StageName | null;
  /** Text for the progress strip while running. */
  label: string;
  /** Share of stages completed, counting the running stage as half. Below 1 while running. */
  fraction: number;
  /** `timings.totalMs` of the finished solve, otherwise `null`. */
  totalMs: number | null;
  stages: StageDisplay[];
}

export function selectPipelineTelemetry(state: AppState): PipelineTelemetry {
  const { status, result } = state.solve;
  const stages = selectProgressStrip(state);
  const phase: PipelineTelemetry["phase"] =
    status === "loading" ? "running" : status === "ready" && result !== null ? "done" : "idle";

  const active = stages.find((entry) => entry.state === "started") ?? null;
  const completed = stages.filter((entry) => entry.state === "completed").length;
  const activeStage = phase === "running" && active !== null ? active.stage : null;

  let label = "Starting solver...";
  if (activeStage !== null) label = stageActivityLabel(activeStage);
  else if (completed > 0) label = "Finalizing results...";

  const fraction = Math.min(0.96, (completed + (activeStage === null ? 0 : 0.5)) / STAGE_NAMES.length);
  return {
    phase,
    activeStage,
    label,
    fraction: phase === "done" ? 1 : fraction,
    totalMs: phase === "done" && result !== null ? result.timings.totalMs : null,
    stages,
  };
}

/** `842 ms` below one second, otherwise seconds with one decimal (`5.1s`). `null` gives an en dash. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "\u2013";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Whole milliseconds with a thousands separator (`3,812 ms`), for the per-stage breakdown. `null` gives an en dash. */
export function formatStageMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "\u2013";
  return `${Math.round(ms).toLocaleString("en-US")} ms`;
}

// ---------------------------------------------------------------------------
// Comparison telemetry card: DBG against Naive for a solved plan
// ---------------------------------------------------------------------------

export interface ComparisonModel {
  dbg: {
    label: string;
    /** Legacy ray hits, `oracle.totalClashes`. `null` when the plan has no oracle report. */
    clashes: number | null;
    /** Always `unverified`: no full-guide check has completed. */
    status: "unverified";
    /** For example `0 legacy ray hits (full guide not verified)`. */
    text: string;
  };
  naive: {
    label: string;
    /** `naive.totalClashes`. */
    clashes: number;
    /** Entries of `naive.perPart` with `clashCount > 0`. */
    obstructed: number;
    /** `naive.perPart.length`: the naive report lists every part. */
    total: number;
    /** For example `54264 clashes (140/157 parts obstructed)`. */
    text: string;
  };
}

function clashText(count: number): string {
  return `${count} ${count === 1 ? "clash" : "clashes"}`;
}

/**
 * DBG next to the naive radial explode. Both numbers come from reports in the `SolveResult`: the
 * legacy ray count for DBG, a diagnostic that never makes the guide verified, and the naive
 * baseline for the radial explode. `null` unless the plan is solved and a naive report exists.
 */
export function selectComparison(result: SolveResult | null): ComparisonModel | null {
  if (result === null || result.plan.status !== "solved" || result.naive === null) return null;

  const oracle = result.oracle;
  const dbgClashes = oracle === null ? null : oracle.totalClashes;
  const notVerified = GUIDE_NOT_VERIFIED_TEXT.toLowerCase();
  const dbgText =
    dbgClashes === null ? GUIDE_NOT_VERIFIED_TEXT : `${legacyRayHitsText(dbgClashes)} (${notVerified})`;

  const naive = result.naive;
  const obstructed = naive.perPart.filter((entry) => entry.clashCount > 0).length;
  const total = naive.perPart.length;
  return {
    dbg: { label: "UnboltKit DBG", clashes: dbgClashes, status: "unverified", text: dbgText },
    naive: {
      label: "Naive Explode",
      clashes: naive.totalClashes,
      obstructed,
      total,
      text: `${clashText(naive.totalClashes)} (${obstructed}/${total} parts obstructed)`,
    },
  };
}
