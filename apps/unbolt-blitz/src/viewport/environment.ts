import {
  AmbientLight,
  DirectionalLight,
  PMREMGenerator,
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
  PMREM_BLUR_SIGMA,
  TEAL_RIM_LIGHT_COLOR,
  TEAL_RIM_LIGHT_INTENSITY,
  TEAL_RIM_LIGHT_POSITION,
} from "./arenaConfig";
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

/** Brass key, teal rim and a low ambient fill (Req 9.2). Lights hold no GPU resources. */
export function createStudioLights(): StudioLights {
  const key = new DirectionalLight(BRASS_KEY_LIGHT_COLOR, BRASS_KEY_LIGHT_INTENSITY);
  key.position.set(...BRASS_KEY_LIGHT_POSITION);
  key.name = "brass-key-light";

  const rim = new DirectionalLight(TEAL_RIM_LIGHT_COLOR, TEAL_RIM_LIGHT_INTENSITY);
  rim.position.set(...TEAL_RIM_LIGHT_POSITION);
  rim.name = "teal-rim-light";

  const ambient = new AmbientLight(AMBIENT_FILL_COLOR, AMBIENT_FILL_INTENSITY);
  ambient.name = "ambient-fill";

  return { key, rim, ambient, all: [key, rim, ambient] };
}
