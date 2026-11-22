/**
 * Arena configuration constants (Req 9.1, 9.2, 9.5, 9.6).
 *
 * Plain values and `three` constants only: no renderer, no DOM, no WebGL. The
 * Arena class and the configuration test (task 13.5) both read these, so the
 * test can check the setup in Node without a GL context.
 */
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";

/** Palette colors the Arena uses, as 0xRRGGBB. */
export const ARENA_PALETTE = Object.freeze({
  obsidian: 0x0d0f14,
  brass: 0xd99b38,
  amber: 0xf5b942,
  teal: 0x2dd4bf,
  crimson: 0xe5484d,
});

/** Renderer tone mapping (Req 9.1). */
export const ARENA_TONE_MAPPING = ACESFilmicToneMapping;
export const ARENA_OUTPUT_COLOR_SPACE = SRGBColorSpace;
export const ARENA_MAX_PIXEL_RATIO = 2;

/** Canvas and scene background: obsidian (Req 9.5). */
export const ARENA_BACKGROUND_COLOR = 0x0d0f14;

/** OrbitControls damping (Req 9.6). */
export const ORBIT_ENABLE_DAMPING = true;
export const ORBIT_DAMPING_FACTOR = 0.08;

/** Camera field of view in degrees, used for `frameBounds`. */
export const ARENA_CAMERA_FOV_DEG = 40;
export const ARENA_FRAMING_MARGIN = 1.25;

/** Warm brass key light from the upper front-left (Req 9.2). */
export const BRASS_KEY_LIGHT_COLOR = 0xd99b38;
/** Studio light intensities are 1.35x the original 2.4, 1.8 and 0.18 so dark hardware pops off the turntable. */
export const BRASS_KEY_LIGHT_INTENSITY = 3.24;
export const BRASS_KEY_LIGHT_POSITION: readonly [number, number, number] = [-2.2, 3.2, 2.6];

/** Cool teal rim light from behind-right (Req 9.2). */
export const TEAL_RIM_LIGHT_COLOR = 0x2dd4bf;
export const TEAL_RIM_LIGHT_INTENSITY = 2.43;
export const TEAL_RIM_LIGHT_POSITION: readonly [number, number, number] = [2.6, 1.4, -3.0];

/** Low ambient fill so the shadow side stays readable but dark. */
export const AMBIENT_FILL_COLOR = 0x3a4560;
export const AMBIENT_FILL_INTENSITY = 0.243;

/** Sigma passed to `PMREMGenerator.fromScene` for the RoomEnvironment (Req 9.3). */
export const PMREM_BLUR_SIGMA = 0.04;
/** Dark studio: the environment map only adds a faint reflection. */
export const ENVIRONMENT_INTENSITY = 0.45;

/** One frozen object for tests and for the Arena constructor. */
export const ARENA_CONFIG = Object.freeze({
  toneMapping: ARENA_TONE_MAPPING,
  outputColorSpace: ARENA_OUTPUT_COLOR_SPACE,
  maxPixelRatio: ARENA_MAX_PIXEL_RATIO,
  backgroundColor: ARENA_BACKGROUND_COLOR,
  enableDamping: ORBIT_ENABLE_DAMPING,
  dampingFactor: ORBIT_DAMPING_FACTOR,
  cameraFovDeg: ARENA_CAMERA_FOV_DEG,
  framingMargin: ARENA_FRAMING_MARGIN,
  keyLightColor: BRASS_KEY_LIGHT_COLOR,
  rimLightColor: TEAL_RIM_LIGHT_COLOR,
  pmremBlurSigma: PMREM_BLUR_SIGMA,
  environmentIntensity: ENVIRONMENT_INTENSITY,
});
