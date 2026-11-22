/**
 * Procedural clockwork sound (Part 2, module 2).
 *
 * Every sound is synthesized from Web Audio oscillators and filtered noise. The module loads no
 * audio file and makes no network request. Every cue also has a visual or textual signal in the HUD,
 * so the game stays fully playable on mute.
 *
 * `soundRecipe(event)` is a pure description of the sound as a list of tones and noise bursts, so
 * the sound design is testable in Node. `createSoundModule` plays a recipe through an
 * `AudioContext`. Without one (Node, tests, old browsers) every call is a no-op.
 *
 * Noise comes from a fixed-seed generator, so the sound is the same on every run.
 */
import type { GameEvent } from "../game/events";
import { COMBO_CAP } from "../game/scoring";
import type { StorageAdapter } from "./storage";
import { defaultStorage } from "./storage";
import type { GameModule } from "./types";

export type WaveShape = "sine" | "square" | "sawtooth" | "triangle";

export interface ToneSpec {
  kind: "tone";
  wave: WaveShape;
  freq: number;
  /** When set, the frequency glides exponentially from `freq` to `freqEnd`. */
  freqEnd?: number;
  /** Start in seconds after the event. */
  at: number;
  dur: number;
  gain: number;
}

export interface NoiseSpec {
  kind: "noise";
  at: number;
  dur: number;
  gain: number;
  filter: "highpass" | "bandpass" | "lowpass";
  freq: number;
  q: number;
}

export type SoundSpec = ToneSpec | NoiseSpec;

/** Persistence key of the mute flag. */
export const MUTE_STORAGE_KEY = "unbolt-blitz:muted:v1";

const CHIME_BASE_HZ = 523.25;
/** Each combo step raises the chime by a whole tone: x1 is C5 and x8 is about 1175 Hz. */
const CHIME_STEP_SEMITONES = 2;

/** Chime pitch for a combo multiplier, clamped to x1..x8. */
export function chimeFrequency(combo: number): number {
  const step = Math.min(COMBO_CAP, Math.max(1, Math.round(combo))) - 1;
  return CHIME_BASE_HZ * 2 ** ((step * CHIME_STEP_SEMITONES) / 12);
}

function click(at: number, gain: number): SoundSpec[] {
  return [
    { kind: "noise", at, dur: 0.03, gain, filter: "highpass", freq: 3200, q: 0.7 },
    { kind: "tone", wave: "square", freq: 1900, freqEnd: 820, at, dur: 0.035, gain: gain * 0.35 },
  ];
}

function chime(freq: number, at: number, gain: number): SoundSpec[] {
  const partials: ReadonlyArray<readonly [number, number]> = [
    [1, 1],
    [2, 0.35],
    [3, 0.14],
  ];
  return partials.map(
    ([ratio, weight]): SoundSpec => ({
      kind: "tone",
      wave: "sine",
      freq: freq * ratio,
      at,
      dur: 0.38 / Math.sqrt(ratio),
      gain: gain * weight,
    }),
  );
}

function brassNote(freq: number, at: number, dur: number, gain: number): SoundSpec[] {
  return [
    { kind: "tone", wave: "sawtooth", freq, at, dur, gain },
    { kind: "tone", wave: "square", freq: freq / 2, at, dur, gain: gain * 0.4 },
  ];
}

/** Seconds that a completion fanfare waits so it does not stack on the cue just before it. */
const FANFARE_DELAY_VICTORY = 0.3;
const FANFARE_DELAY_INTERLOCK = 0.65;

/** The sound for one game event, or an empty list for an event without a cue. */
export function soundRecipe(event: GameEvent): readonly SoundSpec[] {
  switch (event.kind) {
    case "part_removed": {
      const specs = [...click(0, 0.22), ...chime(chimeFrequency(event.comboAfter), 0.04, 0.16)];
      if (event.step.primitive === "helical_unscrew") {
        // A brief ratchet: six pawl clicks that rise in pitch.
        for (let i = 0; i < 6; i += 1) {
          specs.push({
            kind: "noise",
            at: 0.02 + i * 0.045,
            dur: 0.022,
            gain: 0.16,
            filter: "bandpass",
            freq: 2200 + i * 160,
            q: 4,
          });
        }
        specs.push({ kind: "tone", wave: "triangle", freq: 340, freqEnd: 720, at: 0, dur: 0.28, gain: 0.05 });
      }
      return specs;
    }
    case "part_blocked":
      return [
        { kind: "tone", wave: "triangle", freq: 150, freqEnd: 92, at: 0, dur: 0.3, gain: 0.34 },
        { kind: "tone", wave: "sine", freq: 311, at: 0, dur: 0.45, gain: 0.14 },
        { kind: "tone", wave: "sine", freq: 487, at: 0, dur: 0.35, gain: 0.1 },
        { kind: "tone", wave: "sine", freq: 811, at: 0, dur: 0.25, gain: 0.07 },
        { kind: "noise", at: 0, dur: 0.08, gain: 0.3, filter: "lowpass", freq: 900, q: 0.8 },
      ];
    case "trap_flagged": {
      const specs: SoundSpec[] = [];
      for (const freq of [261.63, 329.63, 392, 523.25]) specs.push(...brassNote(freq, 0, 0.7, 0.07));
      return specs;
    }
    case "false_alarm":
      return [
        { kind: "tone", wave: "sawtooth", freq: 230, freqEnd: 84, at: 0, dur: 0.5, gain: 0.16 },
        { kind: "tone", wave: "square", freq: 115, freqEnd: 52, at: 0, dur: 0.5, gain: 0.09 },
      ];
    case "level_completed": {
      const delay = event.outcome === "victory" ? FANFARE_DELAY_VICTORY : FANFARE_DELAY_INTERLOCK;
      const specs: SoundSpec[] = [];
      const run: ReadonlyArray<number> = [523.25, 659.25, 783.99, 1046.5];
      run.forEach((freq, index) => {
        specs.push(...brassNote(freq, delay + index * 0.12, 0.22, 0.07));
        specs.push(...chime(freq * 2, delay + index * 0.12, 0.05));
      });
      const finish = delay + run.length * 0.12;
      for (const freq of [523.25, 659.25, 783.99, 1046.5]) specs.push(...brassNote(freq, finish, 0.9, 0.06));
      // Two ratchet ticks, like a clockwork spring settling.
      specs.push(...click(finish + 0.95, 0.12), ...click(finish + 1.02, 0.1));
      return specs;
    }
    default:
      return [];
  }
}

/** A short tick that confirms "sound on". */
const UNMUTE_RECIPE: readonly SoundSpec[] = [...click(0, 0.2), ...chime(chimeFrequency(2), 0.03, 0.12)];

// ---------------------------------------------------------------------------
// Web Audio plumbing. The interfaces list only what this file calls, so a test can pass a fake.
// ---------------------------------------------------------------------------

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}
export interface AudioNodeLike {
  connect(destination: unknown): unknown;
}
export interface OscillatorLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface GainLike extends AudioNodeLike {
  gain: AudioParamLike;
}
export interface FilterLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  Q: AudioParamLike;
}
export interface BufferLike {
  getChannelData(channel: number): Float32Array;
}
export interface BufferSourceLike extends AudioNodeLike {
  buffer: unknown;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  createBiquadFilter(): FilterLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createBufferSource(): BufferSourceLike;
}

/** Real `AudioContext` constructor of this environment, or null when there is none. */
export function defaultAudioContextFactory(): AudioContextLike | null {
  const scope = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return Ctor === undefined ? null : new Ctor();
}

export interface SoundModule extends GameModule {
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  toggleMuted(): boolean;
  /** For `useSyncExternalStore`. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export interface SoundModuleOptions {
  /** Defaults to `defaultStorage()`. */
  storage?: StorageAdapter;
  /** Returns a new context, or null when Web Audio is missing. Defaults to the browser `AudioContext`. */
  createContext?: () => AudioContextLike | null;
}

const NOISE_SECONDS = 0.5;
const NOISE_SEED = 0x9e3779b9;

function fillSeededNoise(data: Float32Array): void {
  let state = NOISE_SEED >>> 0;
  for (let i = 0; i < data.length; i += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    data[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
}

export function createSoundModule(options: SoundModuleOptions = {}): SoundModule {
  const storage = options.storage ?? defaultStorage();
  const createContext = options.createContext ?? defaultAudioContextFactory;
  let muted = storage.getItem(MUTE_STORAGE_KEY) === "1";
  const listeners = new Set<() => void>();
  let context: AudioContextLike | null = null;
  let contextUnavailable = false;
  let master: GainLike | null = null;
  let noiseBuffer: BufferLike | null = null;

  /** The shared context, created on first use (after a user gesture). Null without Web Audio. */
  function ensureContext(): AudioContextLike | null {
    if (context !== null) return context;
    if (contextUnavailable) return null;
    const created = createContext();
    if (created === null) {
      contextUnavailable = true;
      return null;
    }
    context = created;
    master = created.createGain();
    master.gain.value = 0.6;
    master.connect(created.destination);
    return created;
  }

  function noise(ctx: AudioContextLike): BufferLike {
    if (noiseBuffer === null) {
      const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      fillSeededNoise(noiseBuffer.getChannelData(0));
    }
    return noiseBuffer;
  }

  function schedule(ctx: AudioContextLike, out: GainLike, spec: SoundSpec): void {
    const start = ctx.currentTime + spec.at;
    const end = start + spec.dur;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(spec.gain, start + Math.min(0.006, spec.dur / 4));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(out);
    if (spec.kind === "tone") {
      const osc = ctx.createOscillator();
      osc.type = spec.wave;
      osc.frequency.setValueAtTime(spec.freq, start);
      if (spec.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(spec.freqEnd, end);
      osc.connect(envelope);
      osc.start(start);
      osc.stop(end + 0.02);
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = noise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = spec.filter;
    filter.frequency.setValueAtTime(spec.freq, start);
    filter.Q.setValueAtTime(spec.q, start);
    source.connect(filter);
    filter.connect(envelope);
    source.start(start);
    source.stop(end + 0.02);
  }

  function play(recipe: readonly SoundSpec[]): void {
    if (recipe.length === 0) return;
    const ctx = ensureContext();
    if (ctx === null || master === null) return;
    if (ctx.state === "suspended") {
      // A browser may refuse to resume before a gesture. The game stays playable, so log it and go on.
      ctx.resume().catch((error: unknown) => {
        console.warn("Unbolt Blitz: the audio context could not resume.", error);
      });
    }
    for (const spec of recipe) schedule(ctx, master, spec);
  }

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function setMuted(next: boolean): void {
    if (next === muted) return;
    muted = next;
    storage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
    notify();
    if (!muted) play(UNMUTE_RECIPE);
  }

  return {
    id: "clockwork-sound",
    onEvent(event) {
      if (muted) return;
      play(soundRecipe(event));
    },
    isMuted: () => muted,
    setMuted,
    toggleMuted() {
      setMuted(!muted);
      return muted;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // A singleton that survives StrictMode remounts: release the audio device, keep the subscriptions.
    dispose() {
      const closing = context;
      context = null;
      master = null;
      noiseBuffer = null;
      if (closing !== null && closing.state !== "closed") {
        closing.close().catch((error: unknown) => {
          console.warn("Unbolt Blitz: the audio context could not close.", error);
        });
      }
    },
  };
}
