import {
  AmbientLight,
  CanvasTexture,
  DirectionalLight,
  PMREMGenerator,
  SRGBColorSpace,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  AMBIENT_FILL_COLOR,
  AMBIENT_FILL_INTENSITY,
  BRASS_KEY_LIGHT_COLOR,
  BRASS_KEY_LIGHT_INTENSITY,
  BRASS_KEY_LIGHT_POSITION,
  ENVIRONMENT_INTENSITY,
  KEY_SHADOW_BIAS,
  KEY_SHADOW_FRUSTUM_MARGIN,
  KEY_SHADOW_MAP_SIZE,
  KEY_SHADOW_NORMAL_BIAS,
  PMREM_BLUR_SIGMA,
  STUDIO_BACKDROP,
  TEAL_RIM_LIGHT_COLOR,
  TEAL_RIM_LIGHT_INTENSITY,
  TEAL_RIM_LIGHT_POSITION,
} from "./arenaConfig";
import { createCanvas2d, createSeededRandom } from "./proceduralCanvas";
import type { Disposable } from "./resourceTracker";

/** The PMREM environment texture and everything that must be disposed with it (Req 9.3, 9.9). */
export interface ArenaEnvironment {
  texture: Texture;
  /** Render target, generator and RoomEnvironment, in disposal order. */
  disposables: Disposable[];
}

/**
 * Builds the image-based lighting map from `RoomEnvironment` through a
 * `PMREMGenerator`. The caller owns the returned disposables, normally by
 * tracking each one in a `ResourceTracker`.
 */
export function createArenaEnvironment(renderer: WebGLRenderer): ArenaEnvironment {
  const generator = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const target = generator.fromScene(room, PMREM_BLUR_SIGMA);
  return { texture: target.texture, disposables: [target, generator, room] };
}

/**
 * The studio backdrop: a warm-charcoal to obsidian radial gradient in an in-memory `CanvasTexture`,
 * for `scene.background`. Returns null when there is no `document` (headless Node tests) or no 2D
 * context, and the Arena then keeps the flat obsidian background color.
 */
export function createStudioBackdrop(): CanvasTexture | null {
  const { size, center, mid, edge, centerY, radius, ditherSeed } = STUDIO_BACKDROP;
  const surface = createCanvas2d(size, size);
  if (surface === null) return null;
  const { canvas, ctx } = surface;

  const cx = size / 2;
  const cy = size * centerY;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * radius);
  gradient.addColorStop(0, center);
  gradient.addColorStop(0.5, mid);
  gradient.addColorStop(1, edge);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // The ramp spans only a few dozen 8-bit levels, which bands. One level of seeded luma noise hides it.
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  const random = createSeededRandom(ditherSeed);
  for (let i = 0; i < data.length; i += 4) {
    const noise = Math.floor(random() * 3) - 1;
    data[i] = (data[i] as number) + noise;
    data[i + 1] = (data[i + 1] as number) + noise;
    data[i + 2] = (data[i + 2] as number) + noise;
  }
  ctx.putImageData(image, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.name = "studio-backdrop";
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Sets the scene environment map at the dark-studio intensity. */
export function applyArenaEnvironment(scene: Scene, environment: ArenaEnvironment): void {
  scene.environment = environment.texture;
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;
}

/** The three lights of the dark studio. */
export interface StudioLights {
  /** Warm brass key from the upper front-left. */
  key: DirectionalLight;
  /** Cool teal rim from behind-right. */
  rim: DirectionalLight;
  /** Low ambient fill. */
  ambient: AmbientLight;
  all: [DirectionalLight, DirectionalLight, AmbientLight];
}

/**
 * Brass key, teal rim and a low ambient fill (Req 9.2). Only the key casts a (soft) shadow, from a
 * 2048 map. Its frustum is refitted to each level by `fitKeyShadow`. The caller adds `key.target`
 * to the scene so the target keeps a world matrix.
 */
export function createStudioLights(): StudioLights {
  const key = new DirectionalLight(BRASS_KEY_LIGHT_COLOR, BRASS_KEY_LIGHT_INTENSITY);
  key.position.set(...BRASS_KEY_LIGHT_POSITION);
  key.name = "brass-key-light";
  key.target.name = "brass-key-light-target";
  key.castShadow = true;
  key.shadow.mapSize.set(KEY_SHADOW_MAP_SIZE, KEY_SHADOW_MAP_SIZE);
  key.shadow.bias = KEY_SHADOW_BIAS;
  key.shadow.normalBias = KEY_SHADOW_NORMAL_BIAS;

  const rim = new DirectionalLight(TEAL_RIM_LIGHT_COLOR, TEAL_RIM_LIGHT_INTENSITY);
  rim.position.set(...TEAL_RIM_LIGHT_POSITION);
  rim.name = "teal-rim-light";

  const ambient = new AmbientLight(AMBIENT_FILL_COLOR, AMBIENT_FILL_INTENSITY);
  ambient.name = "ambient-fill";

  return { key, rim, ambient, all: [key, rim, ambient] };
}

/** Placement and orthographic frustum of the key light's shadow camera. */
export interface KeyShadowFit {
  /** World position of the key light. */
  position: [number, number, number];
  /** Half width and half height of the orthographic frustum. */
  half: number;
  near: number;
  far: number;
}

/**
 * Fits the key light's shadow frustum around a sphere. The light keeps its direction and distance
 * from `BRASS_KEY_LIGHT_POSITION` and looks at `center`. The sphere's centre sits `distance` along
 * the view axis, so `[distance - half, distance + half]` covers its whole depth range, and the
 * square `half` covers its silhouette. Throws `RangeError` for a non-finite or non-positive radius.
 */
export function keyShadowFit(center: readonly [number, number, number], radius: number): KeyShadowFit {
  if (!(Number.isFinite(radius) && radius > 0)) {
    throw new RangeError(`Shadow fit radius must be positive and finite, got ${radius}.`);
  }
  const [kx, ky, kz] = BRASS_KEY_LIGHT_POSITION;
  const distance = Math.hypot(kx, ky, kz);
  const half = radius * KEY_SHADOW_FRUSTUM_MARGIN;
  return {
    position: [center[0] + kx, center[1] + ky, center[2] + kz],
    half,
    near: Math.max(0.05, distance - half),
    far: distance + half,
  };
}

/**
 * Points the key light at `center` and sizes its shadow frustum to cover a sphere of `radius`
 * (the assembly plus the turntable), so the 2048 map spends its texels on the scene and not on empty space.
 */
export function fitKeyShadow(key: DirectionalLight, center: readonly [number, number, number], radius: number): void {
  const fit = keyShadowFit(center, radius);
  key.position.set(...fit.position);
  key.target.position.set(center[0], center[1], center[2]);
  key.updateMatrixWorld();
  key.target.updateMatrixWorld();
  const camera = key.shadow.camera;
  camera.left = -fit.half;
  camera.right = fit.half;
  camera.top = fit.half;
  camera.bottom = -fit.half;
  camera.near = fit.near;
  camera.far = fit.far;
  camera.updateProjectionMatrix();
}
