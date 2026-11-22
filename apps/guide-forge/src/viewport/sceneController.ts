/**
 * Imperative Three.js scene for the Viewport (Requirements 3.1 to 3.5, 3.7 to 3.11, 11.2, 11.4,
 * 12.1 to 12.6, 13.1, 13.3, 13.6, 14.4 to 14.6, 15.5).
 *
 * The controller owns every WebGL resource of the viewport. It imports no React. The React wrapper
 * creates one controller per mount, calls `update(viewModel)` whenever app state changes, and calls
 * `dispose()` on unmount.
 *
 * Rendering is on demand. A frame is scheduled only after a state update, a controls change, a
 * resize, a camera move, or while an animation needs frames (camera tween, control damping, pulsing
 * or glowing highlights). Under `reducedMotion` highlights are steady, camera moves snap, damping
 * is off, and the loop is idle between inputs.
 *
 * The renderer factory is injectable. When it throws, the controller does not touch the DOM, stays
 * `unavailable`, and every other method is a safe no-op (Requirement 3.11).
 *
 * Camera "up" stays +Y for the life of the controller. `OrbitControls` derives its orbit frame from
 * `camera.up` at construction, so changing it later would break rotation. A top view looks straight
 * down; `OrbitControls` clamps the polar angle by a tiny epsilon, which yields the same picture as
 * an explicit `(0, 0, -1)` up vector.
 */
import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import type { WebGLRenderTarget } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Vec3 } from "@unboltkit/core";
import type { MaterialDescriptor, PartRenderData, SolveResult } from "../protocol";
import { partHighlight } from "../motion/highlightStyle";
import type { HighlightContext, PartHighlight } from "../motion/highlightStyle";
import { LEADER_SAMPLES, sampleLeaderSpline, travelledSampleCount } from "../motion/leaderSpline";
import { computePartTransforms } from "../motion/partTransforms";
import type { Mat4 } from "../motion/partTransforms";
import { localParameter } from "../motion/timeline";
import { descriptorToMaterial } from "../scene/materialDescriptor";
import { selectDeadlockModel } from "../state/selectors";
import type { CameraCommand, Mode, VisibilityMode } from "../state/types";
import { VIEW_DIRECTIONS, boundsOfPosedParts, frameBounds } from "./cameraViews";
import type { Bounds, CameraFrame } from "./cameraViews";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Flat clear colour. Only visible if the studio backdrop texture cannot be built. */
const CANVAS_COLOR = 0xf6f8fb;
const ACCENT_COLOR = 0x1e3a5f;
const CRIMSON_COLOR = 0xdc143c;
const AMBER_COLOR = 0xf59e0b;

// Studio set (keep in step with `--studio-center` and `--studio-edge` in tokens.css).
/** Backdrop centre and edge, as `[r, g, b]` in sRGB 0..255. */
const STUDIO_CENTER_RGB: readonly [number, number, number] = [0xfa, 0xfb, 0xfd];
const STUDIO_EDGE_RGB: readonly [number, number, number] = [0xee, 0xf3, 0xf8];
const BACKDROP_SIZE = 512;

const KEY_LIGHT_COLOR = 0xfff8f0;
const KEY_LIGHT_INTENSITY = 1.15;
const FILL_LIGHT_COLOR = 0xcfe0ff;
const FILL_LIGHT_INTENSITY = 0.35;
const RIM_LIGHT_COLOR = 0xe6f0ff;
const RIM_LIGHT_INTENSITY = 0.55;

/**
 * Soft contact shadows. Assemblies are normalized to maxExtent 1.0 and centred on the origin, so a
 * fixed orthographic frustum of this half extent covers the assembled pose and the naive explode
 * travel (0.65) with margin.
 */
const SHADOW_MAP_SIZE = 2048;
const SHADOW_HALF_EXTENT = 1.4;
const SHADOW_BIAS = -0.0002;
const SHADOW_NORMAL_BIAS = 0.004;
const SHADOW_CATCHER_OPACITY = 0.16;
const SHADOW_CATCHER_COLOR = 0x0f172a;
/** Parts with less opacity than this (glass, films) cast no shadow, so glass does not read as solid. */
const SHADOW_MIN_OPACITY = 0.5;

// Architectural drafting grid: a fine 0.05 grid under a heavier 0.25 grid, fading out with distance.
const GRID_SIZE = 6;
const GRID_MINOR_STEP = 0.05;
const GRID_MAJOR_STEP = 0.25;
const GRID_MINOR_OPACITY = 0.07;
const GRID_MAJOR_OPACITY = 0.2;
const GRID_FADE_INNER = 0.9;
const GRID_FADE_OUTER = 2.7;
/** Gap between the assembly bottom and the ground, in normalized units. Small, so parts read as resting on it. */
const GRID_GAP = 0.004;
/** The shadow catcher floats this far above the grid so the two never fight for depth. */
const SHADOW_CATCHER_LIFT = 0.0005;
/** Ground height when no assembly is loaded. Normalized assemblies are centred on the origin. */
const GRID_DEFAULT_Y = -0.5;

const CAMERA_FOV_DEG = 35;
const CAMERA_NEAR = 0.01;
const CAMERA_FAR = 200;
const CAMERA_MOVE_MS = 300;
const FRAME_MARGIN_FOCUS = 1.6;
/** A focused Part is framed as if it were at least this wide, so a tiny Part does not zoom to its surface. */
const FOCUS_MIN_HALF_EXTENT = 0.05;

const GLASS_THICKNESS = 0.02;
const LINE_WIDTH_FULL = 2;
const LINE_WIDTH_TRAVELLED = 4;
const LINE_OPACITY_FULL = 0.55;
const ARROW_HEIGHT = 0.05;
const ARROW_RADIUS = 0.016;

const PULSE_PERIOD_SECONDS = 1.2;
const GLOW_PERIOD_SECONDS = 2;

const OUTLINE_CREASE_DEGREES = 30;

/** Opacity of a ghosted (context) Part in the `ghost-context` view mode. */
const GHOST_OPACITY = 0.12;
/** Opacity of the faint crease outline that keeps a ghosted Part readable. */
const GHOST_EDGE_OPACITY = 0.3;
const OUTLINE_OPACITY = 0.95;

const UP = new Vector3(0, 1, 0);
const CRIMSON = new Color(CRIMSON_COLOR);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Plain data the controller needs. The React wrapper derives it from App_State. */
export interface SceneViewModel {
  result: SolveResult | null;
  mode: Mode;
  /** Step_Timeline position `p`. Read in DBG mode. */
  timelineP: number;
  /** Explode_Slider value `s`. Read in Naive mode. */
  naiveExplode: number;
  selectedStepIndex: number | null;
  reducedMotion: boolean;
  cameraCommand: CameraCommand | null;
  /**
   * `hide-removed` and `ghost-context` apply in DBG mode on a solved plan. In any other case the
   * viewport draws every Part normally.
   */
  visibilityMode: VisibilityMode;
}

/**
 * Pose for `captureSnapshot`.
 * - `current`: the frame as the user sees it.
 * - `assembled`: every Part in place, isometric framing, no step highlight, no leader spline.
 * - `exploded`: every Part at the end of its removal path (DBG, solved plan) or fully exploded by
 *   the Naive Radial Explode (deadlocked plan), isometric framing.
 */
export type SnapshotPose = "current" | "assembled" | "exploded";

export interface SnapshotOptions {
  pose?: SnapshotPose;
}

export interface SceneControllerOptions {
  container: HTMLElement;
  /** Defaults to `new WebGLRenderer({ antialias: true })`. A throw marks the controller unavailable. */
  createRenderer?: () => WebGLRenderer;
  /** Clock in milliseconds. Defaults to `performance.now()`. */
  now?: () => number;
  /** Frame scheduler. Defaults to `requestAnimationFrame`. */
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Called once with a text reason when WebGL is unavailable or the context is lost. */
  onUnavailable?: (reason: string) => void;
}

export type SceneControllerState = "ready" | "unavailable" | "disposed";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Physically based material for one Part (Requirement 3.5).
 *
 * - Environment intensity grows with metalness, because metals show only the environment.
 * - A transmissive material gets a fixed thickness and double-sided shading so glass reads as glass.
 * - A clear coat is added only for glossy dielectrics (low roughness, low metalness, opaque
 *   transmission 0), which is how lacquer and paint look.
 */
export function createPartMaterial(descriptor: MaterialDescriptor): MeshPhysicalMaterial {
  const material = descriptorToMaterial(descriptor);
  const transmissive = material.transmission > 0;
  material.envMapIntensity = Math.max(transmissive ? 1 : 0, 0.8 + 0.6 * material.metalness);
  if (transmissive) {
    material.thickness = GLASS_THICKNESS;
    material.ior = 1.5;
    material.side = DoubleSide;
  }
  if (!transmissive && material.metalness < 0.5 && material.roughness <= 0.4) {
    material.clearcoat = 0.5;
    material.clearcoatRoughness = Math.min(0.3, material.roughness);
  }
  // Pushes surfaces back slightly so edge outlines drawn on them do not z-fight.
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 1;
  return material;
}

function easeInOutCubic(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/** `0..1` sine wave with the given period. */
function wave(seconds: number, period: number): number {
  return 0.5 + 0.5 * Math.sin((2 * Math.PI * seconds) / period);
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}

function expandBounds(bounds: Bounds, minHalfExtent: number): Bounds {
  const min: Vec3 = [bounds.min[0], bounds.min[1], bounds.min[2]];
  const max: Vec3 = [bounds.max[0], bounds.max[1], bounds.max[2]];
  for (let k = 0; k < 3; k += 1) {
    const centre = ((min[k] as number) + (max[k] as number)) / 2;
    if (((max[k] as number) - (min[k] as number)) / 2 < minHalfExtent) {
      min[k] = centre - minHalfExtent;
      max[k] = centre + minHalfExtent;
    }
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Internal records
// ---------------------------------------------------------------------------

interface PartRecord {
  data: PartRenderData;
  mesh: Mesh<BufferGeometry, MeshPhysicalMaterial>;
  material: MeshPhysicalMaterial;
  baseEmissive: Color;
  baseEmissiveIntensity: number;
  baseTransparent: boolean;
  baseOpacity: number;
  baseDepthWrite: boolean;
  baseTransmission: number;
  /** `true` while the Part is drawn as translucent context. */
  ghosted: boolean;
  outline: LineSegments<EdgesGeometry, LineBasicMaterial> | null;
  highlight: PartHighlight;
}

interface LeaderView {
  result: SolveResult;
  stepIndex: number;
  points: Vec3[];
  group: Group;
  fullGeometry: LineGeometry;
  arrow: Mesh<ConeGeometry, MeshBasicMaterial> | null;
  label: CSS2DObject;
  travelled: Line2 | null;
  travelKey: string;
}

interface DerivedSets {
  result: SolveResult;
  clashing: Set<string>;
  deadlocked: Set<string>;
  unassigned: Set<string>;
  /** `partId` to zero-based plan step index. */
  stepIndexByPart: Map<string, number>;
}

interface CameraTween {
  fromPosition: Vector3;
  toPosition: Vector3;
  fromTarget: Vector3;
  toTarget: Vector3;
  startMs: number;
}

/** Everything that exists only while the renderer exists. */
interface GlResources {
  renderer: WebGLRenderer;
  css2d: CSS2DRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  envTarget: WebGLRenderTarget;
  /** The only light that casts shadows. Disposed with the controller to free its shadow map. */
  keyLight: DirectionalLight;
  /** Drafting grid plane. Lives at the assembly bottom. */
  grid: Mesh<PlaneGeometry, ShaderMaterial>;
  /** Transparent ground that shows only the shadows cast by the parts. */
  shadowCatcher: Mesh<PlaneGeometry, ShadowMaterial>;
  /** Radial studio gradient used as `scene.background`. `null` when no 2D canvas is available. */
  backdrop: CanvasTexture | null;
  partsGroup: Group;
  leaderGroup: Group;
  leaderFullMaterial: LineMaterial;
  leaderTravelMaterial: LineMaterial;
  arrowGeometry: ConeGeometry;
  arrowMaterial: MeshBasicMaterial;
  resizeObserver: ResizeObserver | null;
  onControlsChange: () => void;
  onControlsStart: () => void;
  onContextLost: (event: Event) => void;
  previousContainerPosition: string | null;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class SceneController {
  private readonly container: HTMLElement;
  private readonly now: () => number;
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly onUnavailable: ((reason: string) => void) | undefined;

  private gl: GlResources | null = null;
  private disposedFlag = false;
  private reason: string | null = null;

  private vm: SceneViewModel | null = null;
  private builtResult: SolveResult | null = null;
  private parts: PartRecord[] = [];
  private partById = new Map<string, PartRecord>();
  private transforms: Map<string, Mat4> = new Map();
  private derived: DerivedSets | null = null;
  private leader: LeaderView | null = null;
  private animatedHighlights = false;
  private tween: CameraTween | null = null;
  private lastCameraSeq: number | null = null;
  private firstUpdate = true;
  private frameHandle: number | null = null;

  constructor(options: SceneControllerOptions) {
    this.container = options.container;
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
    this.onUnavailable = options.onUnavailable;

    let renderer: WebGLRenderer;
    try {
      renderer = (options.createRenderer ?? defaultCreateRenderer)();
    } catch (error) {
      // Not swallowed: the reason is exposed through `unavailableReason` and `onUnavailable`.
      this.markUnavailable(error instanceof Error ? error.message : String(error));
      return;
    }
    try {
      this.gl = this.initialize(renderer);
    } catch (error) {
      // Partial setup: release what exists, then surface the real error to the caller.
      const partial = this.gl;
      this.gl = null;
      if (partial !== null) this.releaseGl(partial, true);
      else renderer.dispose();
      throw error;
    }
  }

  // ----- Exposed state -----------------------------------------------------

  get state(): SceneControllerState {
    if (this.disposedFlag) return "disposed";
    return this.gl === null ? "unavailable" : "ready";
  }

  /** `true` when the renderer could not be created or its context was lost. */
  get unavailable(): boolean {
    return this.state === "unavailable";
  }

  get unavailableReason(): string | null {
    return this.reason;
  }

  // ----- Public API --------------------------------------------------------

  /** Applies a new view model and schedules a render. No-op when unavailable or disposed. */
  update(vm: SceneViewModel): void {
    const gl = this.gl;
    if (gl === null || this.disposedFlag) return;
    const previous = this.vm;
    this.vm = vm;

    const newResult = vm.result !== this.builtResult;
    if (newResult) this.rebuildParts(vm.result);

    gl.controls.enableDamping = !vm.reducedMotion;
    if (previous !== null && previous.reducedMotion !== vm.reducedMotion) this.tween = null;

    this.applyTransforms(vm);
    this.applyVisibility(vm);
    this.applyHighlights(vm);
    this.syncLeader(vm);

    const naiveExploded = vm.mode === "naive" && vm.naiveExplode > 0;
    if (newResult && this.parts.length > 0) {
      const bounds = naiveExploded ? this.posedBounds() : this.allBounds();
      this.moveCamera(this.frameFor(VIEW_DIRECTIONS.iso, bounds), true);
    } else if (
      naiveExploded &&
      previous !== null &&
      previous.mode !== "naive" &&
      this.parts.length > 0
    ) {
      // Entering Naive mode with the slider already open: fit the exploded pose so the clashing
      // Parts stay large instead of drifting out of frame.
      this.moveCamera(this.frameFor(this.currentDirection(), this.posedBounds()), vm.reducedMotion);
    }

    const command = vm.cameraCommand;
    if (this.firstUpdate) {
      // Mounting is not a command. A command left over from before mount is not replayed.
      this.lastCameraSeq = command === null ? null : command.seq;
      this.firstUpdate = false;
    } else if (command !== null && command.seq !== this.lastCameraSeq) {
      this.lastCameraSeq = command.seq;
      this.runCameraCommand(command, vm.reducedMotion);
    }

    this.requestRender();
  }

  /**
   * Renders a fresh frame and returns it as a PNG data URL, or `null` when the viewport is
   * unavailable, disposed, or the requested pose does not exist (for example `exploded` with no
   * trajectory and no naive report).
   *
   * The frame is drawn immediately before `toDataURL` in the same task, so the drawing buffer is
   * still valid and the renderer needs no `preserveDrawingBuffer`. For `assembled` and `exploded`
   * the controller poses the Parts and the camera temporarily and restores the live view before it
   * returns, so the user sees no change.
   */
  captureSnapshot(options: SnapshotOptions = {}): string | null {
    const gl = this.gl;
    const vm = this.vm;
    if (gl === null || this.disposedFlag) return null;
    const pose = options.pose ?? "current";
    if (pose === "current" || vm === null || vm.result === null || this.parts.length === 0) {
      return this.renderToDataUrl(gl);
    }
    const snapVm = snapshotViewModel(vm, vm.result, pose);
    if (snapVm === null) return null;

    const savedPosition = gl.camera.position.clone();
    const savedQuaternion = gl.camera.quaternion.clone();
    const savedTween = this.tween;
    const savedLeaderVisible = gl.leaderGroup.visible;
    this.tween = null;
    gl.leaderGroup.visible = false;
    try {
      this.applyTransforms(snapVm);
      this.applyVisibility(snapVm);
      this.applyHighlights(snapVm);
      const frame = this.frameFor(
        VIEW_DIRECTIONS.iso,
        boundsOfPosedParts(
          this.parts.map((p) => p.data),
          this.transforms,
        ),
      );
      gl.camera.position.set(...frame.position);
      gl.camera.lookAt(new Vector3(...frame.target));
      return this.renderToDataUrl(gl);
    } finally {
      gl.camera.position.copy(savedPosition);
      gl.camera.quaternion.copy(savedQuaternion);
      gl.leaderGroup.visible = savedLeaderVisible;
      this.tween = savedTween;
      this.applyTransforms(vm);
      this.applyVisibility(vm);
      this.applyHighlights(vm);
      this.requestRender();
    }
  }

  private renderToDataUrl(gl: GlResources): string {
    gl.renderer.render(gl.scene, gl.camera);
    return gl.renderer.domElement.toDataURL("image/png");
  }

  /** Releases every GPU and DOM resource. Safe to call more than once. */
  dispose(): void {
    if (this.disposedFlag) return;
    this.disposedFlag = true;
    if (this.frameHandle !== null) {
      this.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.tween = null;
    const gl = this.gl;
    if (gl === null) return;
    this.gl = null;
    this.releaseGl(gl, true);
    this.vm = null;
  }

  /**
   * Frees geometries, materials, textures, the environment render target, controls, listeners,
   * DOM nodes and the renderer (Requirement 3.10). `forceLoss` releases the browser GL context
   * early; it is skipped when the context is already lost.
   */
  private releaseGl(gl: GlResources, forceLoss: boolean): void {
    gl.resizeObserver?.disconnect();
    gl.controls.removeEventListener("change", gl.onControlsChange);
    gl.controls.removeEventListener("start", gl.onControlsStart);
    gl.controls.dispose();
    gl.renderer.domElement.removeEventListener("webglcontextlost", gl.onContextLost);

    this.clearLeaderIn(gl);
    this.clearPartsIn(gl);

    gl.leaderFullMaterial.dispose();
    gl.leaderTravelMaterial.dispose();
    gl.arrowGeometry.dispose();
    gl.arrowMaterial.dispose();

    gl.grid.geometry.dispose();
    gl.grid.material.dispose();
    gl.shadowCatcher.geometry.dispose();
    gl.shadowCatcher.material.dispose();

    gl.keyLight.dispose();
    gl.scene.background = null;
    gl.backdrop?.dispose();
    gl.scene.environment = null;
    gl.envTarget.dispose();

    gl.css2d.domElement.remove();
    gl.renderer.domElement.remove();
    if (forceLoss && typeof gl.renderer.forceContextLoss === "function") gl.renderer.forceContextLoss();
    gl.renderer.dispose();

    if (gl.previousContainerPosition !== null) {
      this.container.style.position = gl.previousContainerPosition;
    }
    this.parts = [];
    this.partById = new Map();
    this.derived = null;
    this.builtResult = null;
  }

  // ----- Initialization ----------------------------------------------------

  private initialize(renderer: WebGLRenderer): GlResources {
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(CANVAS_COLOR, 1);
    renderer.setPixelRatio(currentPixelRatio());
    // Soft penumbra shadows from the key light onto the shadow-catcher ground.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;

    const scene = new Scene();

    // Studio backdrop: a soft radial gradient, light in the middle and cooler at the edges.
    const backdrop = createStudioBackdrop();
    if (backdrop !== null) scene.background = backdrop;

    // Environment: RoomEnvironment through PMREM, assigned as the scene environment (Requirement 3.2).
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envTarget = pmrem.fromScene(room, 0.04);
    scene.environment = envTarget.texture;
    room.dispose();
    pmrem.dispose();

    // Three-point studio rig: a warm key light that casts the shadows, a cool fill from the opposite
    // side and a cool rim from behind that separates the edges from the backdrop.
    const keyLight = new DirectionalLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY);
    keyLight.position.set(2.2, 3.4, 1.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    keyLight.shadow.bias = SHADOW_BIAS;
    keyLight.shadow.normalBias = SHADOW_NORMAL_BIAS;
    const shadowCamera = keyLight.shadow.camera;
    shadowCamera.left = -SHADOW_HALF_EXTENT;
    shadowCamera.right = SHADOW_HALF_EXTENT;
    shadowCamera.top = SHADOW_HALF_EXTENT;
    shadowCamera.bottom = -SHADOW_HALF_EXTENT;
    shadowCamera.near = 0.5;
    shadowCamera.far = 10;
    shadowCamera.updateProjectionMatrix();
    scene.add(keyLight);

    const fillLight = new DirectionalLight(FILL_LIGHT_COLOR, FILL_LIGHT_INTENSITY);
    fillLight.position.set(-2.4, 1.6, 1.2);
    scene.add(fillLight);

    const rimLight = new DirectionalLight(RIM_LIGHT_COLOR, RIM_LIGHT_INTENSITY);
    rimLight.position.set(-1.2, 2.2, -3);
    scene.add(rimLight);

    // Drafting grid and the shadow-catcher ground sit at the assembly bottom (Requirement 3.3).
    const grid = createDraftingGrid();
    grid.position.y = GRID_DEFAULT_Y;
    grid.renderOrder = 0;
    scene.add(grid);

    const shadowCatcher = createShadowCatcher();
    shadowCatcher.position.y = GRID_DEFAULT_Y + SHADOW_CATCHER_LIFT;
    shadowCatcher.renderOrder = 1;
    scene.add(shadowCatcher);

    const partsGroup = new Group();
    const leaderGroup = new Group();
    scene.add(partsGroup, leaderGroup);

    const camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR, CAMERA_FAR);
    camera.position.set(1.4, 1.1, 1.4);
    camera.lookAt(0, 0, 0);

    const css2d = new CSS2DRenderer();
    css2d.domElement.style.position = "absolute";
    css2d.domElement.style.top = "0";
    css2d.domElement.style.left = "0";
    css2d.domElement.style.pointerEvents = "none";

    let previousContainerPosition: string | null = null;
    if (getComputedStyle(this.container).position === "static") {
      previousContainerPosition = this.container.style.position;
      this.container.style.position = "relative";
    }
    renderer.domElement.style.display = "block";
    this.container.append(renderer.domElement, css2d.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 0.05;
    controls.maxDistance = 50;

    const onControlsChange = (): void => this.requestRender();
    const onControlsStart = (): void => {
      this.tween = null;
    };
    controls.addEventListener("change", onControlsChange);
    controls.addEventListener("start", onControlsStart);

    const onContextLost = (event: Event): void => {
      event.preventDefault();
      this.markUnavailable("The WebGL context was lost.");
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);

    const leaderFullMaterial = new LineMaterial({
      color: ACCENT_COLOR,
      linewidth: LINE_WIDTH_FULL,
      transparent: true,
      opacity: LINE_OPACITY_FULL,
      depthTest: false,
    });
    const leaderTravelMaterial = new LineMaterial({
      color: ACCENT_COLOR,
      linewidth: LINE_WIDTH_TRAVELLED,
      transparent: true,
      opacity: 1,
      depthTest: false,
    });
    const arrowGeometry = new ConeGeometry(ARROW_RADIUS, ARROW_HEIGHT, 16);
    const arrowMaterial = new MeshBasicMaterial({ color: ACCENT_COLOR, depthTest: false });

    let resizeObserver: ResizeObserver | null = null;
    const resources: GlResources = {
      renderer,
      css2d,
      scene,
      camera,
      controls,
      envTarget,
      keyLight,
      grid,
      shadowCatcher,
      backdrop,
      partsGroup,
      leaderGroup,
      leaderFullMaterial,
      leaderTravelMaterial,
      arrowGeometry,
      arrowMaterial,
      resizeObserver,
      onControlsChange,
      onControlsStart,
      onContextLost,
      previousContainerPosition,
    };

    // Resize: renderer size, camera aspect, pixel ratio, line resolution (Requirement 3.9).
    this.gl = resources;
    this.resize();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        this.resize();
        this.requestRender();
      });
      resizeObserver.observe(this.container);
      resources.resizeObserver = resizeObserver;
    }
    return resources;
  }

  private markUnavailable(reason: string): void {
    if (this.reason !== null) return;
    this.reason = reason;
    if (this.frameHandle !== null) {
      this.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.onUnavailable?.(reason);
    if (this.gl !== null) {
      // Context lost: free everything else. The GPU context is already gone, so skip forceLoss.
      const gl = this.gl;
      this.gl = null;
      this.releaseGl(gl, false);
    }
  }

  private resize(): void {
    const gl = this.gl;
    if (gl === null) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const ratio = currentPixelRatio();
    gl.renderer.setPixelRatio(ratio);
    gl.renderer.setSize(width, height);
    gl.css2d.setSize(width, height);
    gl.camera.aspect = width / height;
    gl.camera.updateProjectionMatrix();
    const resolution = new Vector2(width * ratio, height * ratio);
    gl.leaderFullMaterial.resolution.copy(resolution);
    gl.leaderTravelMaterial.resolution.copy(resolution);
  }

  // ----- Parts -------------------------------------------------------------

  private rebuildParts(result: SolveResult | null): void {
    const gl = this.gl;
    if (gl === null) return;
    this.clearLeaderIn(gl);
    this.clearPartsIn(gl);
    this.builtResult = result;
    this.derived = null;
    this.transforms = new Map();
    if (result === null) {
      this.placeGround(gl, GRID_DEFAULT_Y);
      return;
    }

    for (const data of result.parts) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
      geometry.setIndex(new BufferAttribute(data.indices, 1));
      if (data.normals.length === data.positions.length) {
        geometry.setAttribute("normal", new BufferAttribute(data.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }
      geometry.computeBoundingSphere();

      const material = createPartMaterial(data.material);
      const mesh = new Mesh(geometry, material);
      mesh.name = data.partId;
      mesh.matrixAutoUpdate = false;
      // Every solid part casts a soft shadow onto the ground and receives the others' shadows, so
      // hardware reads as physically grounded. Glass and films cast none (see `castsShadow`).
      mesh.castShadow = castsShadow(material);
      mesh.receiveShadow = true;
      gl.partsGroup.add(mesh);

      const record: PartRecord = {
        data,
        mesh,
        material,
        baseEmissive: material.emissive.clone(),
        baseEmissiveIntensity: material.emissiveIntensity,
        baseTransparent: material.transparent,
        baseOpacity: material.opacity,
        baseDepthWrite: material.depthWrite,
        baseTransmission: material.transmission,
        ghosted: false,
        outline: null,
        highlight: { selected: false, emphasis: "none", animation: "none" },
      };
      this.parts.push(record);
      this.partById.set(data.partId, record);
    }

    this.placeGround(gl, result.parts.length > 0 ? this.allBounds().min[1] - GRID_GAP : GRID_DEFAULT_Y);
  }

  /** Puts the drafting grid and the shadow catcher on the same ground height, right under the assembly. */
  private placeGround(gl: GlResources, y: number): void {
    gl.grid.position.y = y;
    gl.shadowCatcher.position.y = y + SHADOW_CATCHER_LIFT;
  }

  private clearPartsIn(gl: GlResources): void {
    for (const record of this.parts) {
      gl.partsGroup.remove(record.mesh);
      record.mesh.geometry.dispose();
      disposeMaterial(record.material);
      if (record.outline !== null) {
        record.mesh.remove(record.outline);
        record.outline.geometry.dispose();
        record.outline.material.dispose();
      }
    }
    this.parts = [];
    this.partById = new Map();
    this.animatedHighlights = false;
  }

  /** Bounds of every Part at its assembled position. */
  /** Bounds of every Part at its current pose (explode and removal transforms applied). */
  private posedBounds(): Bounds {
    return boundsOfPosedParts(
      this.parts.map((record) => record.data),
      this.transforms,
    );
  }

  private allBounds(): Bounds {
    return boundsOfPosedParts(
      this.parts.map((p) => p.data),
      new Map(),
    );
  }

  private applyTransforms(vm: SceneViewModel): void {
    const result = vm.result;
    if (result === null) return;
    this.transforms = computePartTransforms({
      result,
      mode: vm.mode,
      timelineP: vm.timelineP,
      naiveExplode: vm.naiveExplode,
    });
    for (const record of this.parts) {
      const m = this.transforms.get(record.data.partId);
      if (m !== undefined) record.mesh.matrix.fromArray(m);
      else record.mesh.matrix.identity();
      record.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  // ----- Highlights --------------------------------------------------------

  private derivedSets(result: SolveResult): DerivedSets {
    if (this.derived !== null && this.derived.result === result) return this.derived;
    const clashing = new Set<string>();
    if (result.naive !== null) {
      for (const entry of result.naive.perPart) {
        if (entry.clashCount > 0) clashing.add(entry.partId);
      }
    }
    const model = selectDeadlockModel(result);
    const stepIndexByPart = new Map<string, number>();
    if (result.plan.status !== "error") {
      result.plan.steps.forEach((step, index) => stepIndexByPart.set(step.partId, index));
    }
    const derived: DerivedSets = {
      result,
      stepIndexByPart,
      clashing,
      deadlocked: model === null ? new Set() : model.deadlockedPartIds,
      unassigned:
        result.plan.status === "deadlocked"
          ? new Set(result.plan.witness.unassignedPartIds)
          : new Set(),
    };
    this.derived = derived;
    return derived;
  }

  // ----- View modes --------------------------------------------------------

  /**
   * Applies the visibility mode to every Part.
   * - `hide-removed`: a Part whose local removal parameter `t` has reached 1 is hidden.
   * - `ghost-context`: every Part except the selected step's Part turns into translucent context.
   * Both apply only in DBG mode on a solved plan, where `t` and the active step are defined.
   */
  private applyVisibility(vm: SceneViewModel): void {
    const result = vm.result;
    if (result === null) return;
    const sets = this.derivedSets(result);
    const plan = result.plan;
    const active =
      vm.mode === "dbg" && plan.status === "solved" && result.trajectory !== null;
    const activePartId =
      active && vm.selectedStepIndex !== null && plan.status === "solved"
        ? plan.steps[vm.selectedStepIndex]?.partId
        : undefined;
    for (const record of this.parts) {
      const partId = record.data.partId;
      const stepIndex = sets.stepIndexByPart.get(partId);
      const hidden =
        active &&
        vm.visibilityMode === "hide-removed" &&
        stepIndex !== undefined &&
        localParameter(vm.timelineP, stepIndex) >= 1;
      const ghost =
        active &&
        vm.visibilityMode === "ghost-context" &&
        activePartId !== undefined &&
        partId !== activePartId;
      record.mesh.visible = !hidden;
      this.setGhosted(record, ghost);
    }
  }

  private setGhosted(record: PartRecord, ghost: boolean): void {
    if (record.ghosted === ghost) return;
    record.ghosted = ghost;
    const { material } = record;
    if (ghost) {
      material.transparent = true;
      material.opacity = GHOST_OPACITY;
      material.depthWrite = false;
      material.transmission = 0;
      // A ghost is context only: it leaves no shadow and takes none.
      record.mesh.castShadow = false;
      record.mesh.receiveShadow = false;
    } else {
      material.transparent = record.baseTransparent;
      material.opacity = record.baseOpacity;
      material.depthWrite = record.baseDepthWrite;
      material.transmission = record.baseTransmission;
      record.mesh.castShadow = castsShadow(material);
      record.mesh.receiveShadow = true;
    }
    // Transparency and transmission change the shader program.
    material.needsUpdate = true;
  }

  private applyHighlights(vm: SceneViewModel): void {
    const result = vm.result;
    this.animatedHighlights = false;
    if (result === null) return;
    const sets = this.derivedSets(result);
    const context: HighlightContext = {
      mode: vm.mode,
      planStatus: result.plan.status,
      stepPartIds: result.plan.status === "error" ? [] : result.plan.steps.map((s) => s.partId),
      selectedStepIndex: vm.selectedStepIndex,
      clashingPartIds: sets.clashing,
      deadlockedPartIds: sets.deadlocked,
      unassignedPartIds: sets.unassigned,
      reducedMotion: vm.reducedMotion,
    };
    const nowSeconds = this.now() / 1000;
    for (const record of this.parts) {
      const highlight = partHighlight(record.data.partId, context);
      record.highlight = highlight;
      if (highlight.animation === "pulse" || highlight.animation === "glow") {
        this.animatedHighlights = true;
      }
      this.applyEmissive(record, nowSeconds);
      this.applyOutline(record);
    }
  }

  private applyEmissive(record: PartRecord, seconds: number): void {
    const { highlight, material } = record;
    switch (highlight.emphasis) {
      case "clash": {
        material.emissive.setHex(CRIMSON_COLOR);
        material.emissiveIntensity =
          highlight.animation === "pulse" ? 0.15 + 0.85 * wave(seconds, PULSE_PERIOD_SECONDS) : 0.8;
        return;
      }
      case "deadlocked": {
        const w = highlight.animation === "glow" ? wave(seconds, GLOW_PERIOD_SECONDS) : 0.5;
        material.emissive.setHex(AMBER_COLOR).lerp(CRIMSON, w);
        material.emissiveIntensity = highlight.animation === "glow" ? 0.5 + 0.5 * w : 0.9;
        return;
      }
      case "unassigned":
      case "none": {
        if (highlight.selected && highlight.emphasis === "none") {
          material.emissive.setHex(ACCENT_COLOR);
          material.emissiveIntensity = 0.5;
        } else {
          material.emissive.copy(record.baseEmissive);
          material.emissiveIntensity = record.baseEmissiveIntensity;
        }
        return;
      }
    }
  }

  /**
   * Amber outline for unassigned Parts, accent outline for the selected Part, and a faint accent
   * outline for a ghosted Part so its shape stays readable.
   */
  private applyOutline(record: PartRecord): void {
    const { highlight } = record;
    const emphasisColor =
      highlight.emphasis === "unassigned" ? AMBER_COLOR : highlight.selected ? ACCENT_COLOR : null;
    const faint = emphasisColor === null && record.ghosted;
    const color = emphasisColor ?? (faint ? ACCENT_COLOR : null);
    if (color === null) {
      if (record.outline !== null) record.outline.visible = false;
      return;
    }
    if (record.outline === null) {
      const outline = new LineSegments(
        new EdgesGeometry(record.mesh.geometry, OUTLINE_CREASE_DEGREES),
        new LineBasicMaterial({ color, transparent: true, opacity: OUTLINE_OPACITY }),
      );
      record.mesh.add(outline);
      record.outline = outline;
    }
    record.outline.material.color.setHex(color);
    record.outline.material.opacity = faint ? GHOST_EDGE_OPACITY : OUTLINE_OPACITY;
    record.outline.visible = true;
  }

  private applyAnimatedEmissive(seconds: number): void {
    for (const record of this.parts) {
      const a = record.highlight.animation;
      if (a === "pulse" || a === "glow") this.applyEmissive(record, seconds);
    }
  }

  // ----- Leader spline -----------------------------------------------------

  private syncLeader(vm: SceneViewModel): void {
    const gl = this.gl;
    if (gl === null) return;
    const result = vm.result;
    const index = vm.selectedStepIndex;
    if (
      vm.mode !== "dbg" ||
      result === null ||
      result.plan.status !== "solved" ||
      result.trajectory === null ||
      index === null ||
      index < 0 ||
      index >= result.trajectory.length
    ) {
      this.clearLeaderIn(gl);
      return;
    }
    const step = result.trajectory[index];
    const record = step === undefined ? undefined : this.partById.get(step.partId);
    if (step === undefined || record === undefined) {
      this.clearLeaderIn(gl);
      return;
    }

    if (this.leader === null || this.leader.result !== result || this.leader.stepIndex !== index) {
      this.clearLeaderIn(gl);
      const points = sampleLeaderSpline(step, record.data.obbCenter, LEADER_SAMPLES);
      this.leader = this.buildLeader(gl, result, index, points);
    }
    this.updateTravelled(gl, this.leader, localParameter(vm.timelineP, index));
  }

  private buildLeader(gl: GlResources, result: SolveResult, stepIndex: number, points: Vec3[]): LeaderView {
    const group = new Group();
    const fullGeometry = new LineGeometry();
    fullGeometry.setPositions(points.flat());
    const full = new Line2(fullGeometry, gl.leaderFullMaterial);
    full.renderOrder = 10;
    group.add(full);

    // Arrowhead at the final sample, along the last non-degenerate segment (Requirement 12.3).
    let arrow: Mesh<ConeGeometry, MeshBasicMaterial> | null = null;
    const tip = points[points.length - 1];
    const direction = lastSegmentDirection(points);
    if (tip !== undefined && direction !== null) {
      arrow = new Mesh(gl.arrowGeometry, gl.arrowMaterial);
      arrow.quaternion.copy(new Quaternion().setFromUnitVectors(UP, direction));
      arrow.position.set(tip[0], tip[1], tip[2]).addScaledVector(direction, -ARROW_HEIGHT / 2);
      arrow.renderOrder = 11;
      group.add(arrow);
    }

    // Numbered label at the first sample.
    const element = document.createElement("div");
    element.className = "gf-leader-label";
    element.textContent = `Step ${stepIndex + 1}`;
    Object.assign(element.style, {
      font: '600 12px ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      color: "#1E3A5F",
      background: "rgba(246, 248, 251, 0.92)",
      border: "1px solid #1E3A5F",
      padding: "1px 6px",
      whiteSpace: "nowrap",
      pointerEvents: "none",
    });
    const label = new CSS2DObject(element);
    const start = points[0];
    if (start !== undefined) label.position.set(start[0], start[1], start[2]);
    group.add(label);

    gl.leaderGroup.add(group);
    return { result, stepIndex, points, group, fullGeometry, arrow, label, travelled: null, travelKey: "" };
  }

  /** Emphasized, thicker line over the part of the spline that the Part has travelled (Requirement 12.5). */
  private updateTravelled(gl: GlResources, leader: LeaderView, localParam: number): void {
    const { points } = leader;
    const last = points.length - 1;
    let key = "none";
    let positions: number[] | null = null;
    if (localParam > 0) {
      const count = travelledSampleCount(localParam, points.length);
      const travelled = points.slice(0, count);
      let fraction = 0;
      if (count < points.length) {
        const k = count - 1;
        fraction = Math.min(1, Math.max(0, (Math.min(1, localParam) - k / last) * last));
        const a = points[k];
        const b = points[count];
        if (a !== undefined && b !== undefined && fraction > 0) {
          travelled.push([
            a[0] + (b[0] - a[0]) * fraction,
            a[1] + (b[1] - a[1]) * fraction,
            a[2] + (b[2] - a[2]) * fraction,
          ]);
        }
      }
      if (travelled.length >= 2) {
        key = `${count}:${fraction.toFixed(4)}`;
        positions = travelled.flat();
      }
    }
    if (key === leader.travelKey) return;
    leader.travelKey = key;
    if (leader.travelled !== null) {
      leader.group.remove(leader.travelled);
      leader.travelled.geometry.dispose();
      leader.travelled = null;
    }
    if (positions !== null) {
      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      const line = new Line2(geometry, gl.leaderTravelMaterial);
      line.renderOrder = 12;
      leader.group.add(line);
      leader.travelled = line;
    }
  }

  private clearLeaderIn(gl: GlResources): void {
    const leader = this.leader;
    if (leader === null) return;
    this.leader = null;
    gl.leaderGroup.remove(leader.group);
    leader.fullGeometry.dispose();
    if (leader.travelled !== null) leader.travelled.geometry.dispose();
    leader.label.element.remove();
    leader.group.clear();
  }

  // ----- Camera ------------------------------------------------------------

  private frameFor(direction: Vec3, bounds: Bounds, margin?: number): CameraFrame {
    const gl = this.gl;
    if (gl === null) throw new Error("SceneController: no renderer");
    return frameBounds(bounds, direction, gl.camera.fov, gl.camera.aspect, margin);
  }

  private currentDirection(): Vec3 {
    const gl = this.gl;
    if (gl === null) return VIEW_DIRECTIONS.iso;
    const offset = gl.camera.position.clone().sub(gl.controls.target);
    if (offset.lengthSq() < 1e-12) return VIEW_DIRECTIONS.iso;
    offset.normalize();
    return [offset.x, offset.y, offset.z];
  }

  private runCameraCommand(command: CameraCommand, reducedMotion: boolean): void {
    if (this.parts.length === 0) return;
    const posed = (records: readonly PartRecord[]): Bounds =>
      boundsOfPosedParts(
        records.map((r) => r.data),
        this.transforms,
      );
    let frame: CameraFrame;
    switch (command.kind) {
      case "iso":
      case "front":
      case "top":
        frame = this.frameFor(VIEW_DIRECTIONS[command.kind], posed(this.parts));
        break;
      case "fit":
        frame = this.frameFor(this.currentDirection(), posed(this.parts));
        break;
      case "focus": {
        const record = command.partId === undefined ? undefined : this.partById.get(command.partId);
        if (record === undefined) return;
        frame = this.frameFor(
          this.currentDirection(),
          expandBounds(posed([record]), FOCUS_MIN_HALF_EXTENT),
          FRAME_MARGIN_FOCUS,
        );
        break;
      }
    }
    this.moveCamera(frame, reducedMotion);
  }

  /** Snaps under reduced motion (or when `snap`), else eases over about 300 ms (Requirements 3.7, 3.8). */
  private moveCamera(frame: CameraFrame, snap: boolean): void {
    const gl = this.gl;
    if (gl === null) return;
    const toPosition = new Vector3(...frame.position);
    const toTarget = new Vector3(...frame.target);
    if (snap || this.vm?.reducedMotion === true) {
      this.tween = null;
      gl.camera.position.copy(toPosition);
      gl.controls.target.copy(toTarget);
      gl.controls.update();
      return;
    }
    this.tween = {
      fromPosition: gl.camera.position.clone(),
      toPosition,
      fromTarget: gl.controls.target.clone(),
      toTarget,
      startMs: this.now(),
    };
  }

  /** Returns `true` while the tween still needs frames. */
  private stepTween(gl: GlResources, nowMs: number): boolean {
    const tween = this.tween;
    if (tween === null) return false;
    const u = Math.min(1, Math.max(0, (nowMs - tween.startMs) / CAMERA_MOVE_MS));
    const e = easeInOutCubic(u);
    gl.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, e);
    gl.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
    if (u >= 1) {
      this.tween = null;
      return false;
    }
    return true;
  }

  // ----- Render loop -------------------------------------------------------

  private requestRender(): void {
    if (this.gl === null || this.disposedFlag || this.frameHandle !== null) return;
    this.frameHandle = this.requestFrame(() => this.frame());
  }

  private frame(): void {
    this.frameHandle = null;
    const gl = this.gl;
    if (gl === null) return;
    const nowMs = this.now();
    let needsMore = this.stepTween(gl, nowMs);
    const controlsChanged = gl.controls.update();
    if (this.animatedHighlights) {
      this.applyAnimatedEmissive(nowMs / 1000);
      needsMore = true;
    }
    gl.renderer.render(gl.scene, gl.camera);
    gl.css2d.render(gl.scene, gl.camera);
    if (needsMore || controlsChanged) this.requestRender();
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/**
 * View model for a snapshot pose, or `null` when the pose does not exist. Step selection and the
 * visibility mode are cleared so the picture shows the plain assembly.
 */
function snapshotViewModel(
  vm: SceneViewModel,
  result: SolveResult,
  pose: Exclude<SnapshotPose, "current">,
): SceneViewModel | null {
  const plain = { ...vm, selectedStepIndex: null, visibilityMode: "all" as const };
  if (pose === "assembled") return { ...plain, mode: "dbg", timelineP: 0, naiveExplode: 0 };
  if (result.plan.status === "solved" && result.trajectory !== null && result.plan.steps.length > 0) {
    return { ...plain, mode: "dbg", timelineP: result.plan.steps.length, naiveExplode: 0 };
  }
  if (result.naive !== null) return { ...plain, mode: "naive", naiveExplode: 1 };
  return null;
}

function defaultCreateRenderer(): WebGLRenderer {
  return new WebGLRenderer({ antialias: true });
}

/** Whether a part with this material casts a shadow: solid parts do, glass and films do not. */
function castsShadow(material: MeshPhysicalMaterial): boolean {
  return material.transmission === 0 && material.opacity >= SHADOW_MIN_OPACITY;
}

/** 4 x 4 Bayer matrix. Ordered dithering hides the banding of a gradient this gentle in 8 bits. */
const BAYER_4X4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Radial studio gradient for `scene.background`: `STUDIO_CENTER_RGB` in the middle, easing to
 * `STUDIO_EDGE_RGB` in the corners. The texture is stretched over the viewport, so the vignette
 * follows its aspect ratio. Returns `null` when the browser gives no 2D canvas context. The caller
 * then keeps the flat clear colour, which is the documented fallback and not a hidden failure.
 */
function createStudioBackdrop(): CanvasTexture | null {
  const size = BACKDROP_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) return null;

  const image = context.createImageData(size, size);
  const [centerR, centerG, centerB] = STUDIO_CENTER_RGB;
  const [edgeR, edgeG, edgeB] = STUDIO_EDGE_RGB;
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 0 at the centre, 1 in the corners, eased so the middle stays calm.
      const r = Math.min(1, Math.hypot(x + 0.5 - half, y + 0.5 - half) / (half * Math.SQRT2));
      const t = r * r * (3 - 2 * r);
      const threshold = ((BAYER_4X4[(y & 3) * 4 + (x & 3)] as number) + 0.5) / 16;
      const offset = (y * size + x) * 4;
      image.data[offset] = Math.min(255, Math.floor(centerR + (edgeR - centerR) * t + threshold));
      image.data[offset + 1] = Math.min(255, Math.floor(centerG + (edgeG - centerG) * t + threshold));
      image.data[offset + 2] = Math.min(255, Math.floor(centerB + (edgeB - centerB) * t + threshold));
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  const texture = new CanvasTexture(canvas);
  // Authored in sRGB. Three skips tone mapping for an sRGB background, so the colours stay exact.
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

const GRID_VERTEX_SHADER = /* glsl */ `
  varying vec2 vPlane;
  void main() {
    vPlane = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GRID_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uMinorStep;
  uniform float uMajorStep;
  uniform float uMinorOpacity;
  uniform float uMajorOpacity;
  uniform float uFadeInner;
  uniform float uFadeOuter;
  varying vec2 vPlane;

  // 1 on a grid line, 0 between lines, about one pixel wide at any distance.
  float gridLine(vec2 plane, float cellSize) {
    vec2 cell = plane / cellSize;
    vec2 width = max(fwidth(cell), vec2(1e-5));
    vec2 toLine = abs(fract(cell - 0.5) - 0.5);
    vec2 line = 1.0 - smoothstep(vec2(0.0), width * 1.25, toLine);
    // Once a cell is thinner than about half a pixel the lines would merge into a solid sheet.
    float detail = 1.0 - smoothstep(0.3, 0.6, max(width.x, width.y));
    return max(line.x, line.y) * detail;
  }

  void main() {
    float minor = gridLine(vPlane, uMinorStep) * uMinorOpacity;
    float major = gridLine(vPlane, uMajorStep) * uMajorOpacity;
    float fade = 1.0 - smoothstep(uFadeInner, uFadeOuter, length(vPlane));
    float alpha = max(minor, major) * fade;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * Architectural drafting grid on the ground: a fine minor grid under a heavier major grid, in the
 * blueprint accent colour, fading out with distance from the origin. Drawn with one anti-aliased
 * shader plane, so the lines stay crisp at every zoom.
 */
function createDraftingGrid(): Mesh<PlaneGeometry, ShaderMaterial> {
  const geometry = new PlaneGeometry(GRID_SIZE, GRID_SIZE);
  geometry.rotateX(-Math.PI / 2);
  const material = new ShaderMaterial({
    vertexShader: GRID_VERTEX_SHADER,
    fragmentShader: GRID_FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: new Color(ACCENT_COLOR) },
      uMinorStep: { value: GRID_MINOR_STEP },
      uMajorStep: { value: GRID_MAJOR_STEP },
      uMinorOpacity: { value: GRID_MINOR_OPACITY },
      uMajorOpacity: { value: GRID_MAJOR_OPACITY },
      uFadeInner: { value: GRID_FADE_INNER },
      uFadeOuter: { value: GRID_FADE_OUTER },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  return new Mesh(geometry, material);
}

/** Invisible ground that draws only the shadows cast onto it, at the configured opacity. */
function createShadowCatcher(): Mesh<PlaneGeometry, ShadowMaterial> {
  const geometry = new PlaneGeometry(GRID_SIZE, GRID_SIZE);
  geometry.rotateX(-Math.PI / 2);
  const material = new ShadowMaterial({
    color: SHADOW_CATCHER_COLOR,
    opacity: SHADOW_CATCHER_OPACITY,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function currentPixelRatio(): number {
  const ratio = globalThis.devicePixelRatio;
  return Math.min(typeof ratio === "number" && ratio > 0 ? ratio : 1, 2);
}

/** Unit direction of the last segment with non-zero length, or `null` for a degenerate path. */
function lastSegmentDirection(points: readonly Vec3[]): Vector3 | null {
  for (let k = points.length - 1; k >= 1; k -= 1) {
    const a = points[k - 1];
    const b = points[k];
    if (a === undefined || b === undefined) continue;
    const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (d.lengthSq() > 1e-18) return d.normalize();
  }
  return null;
}
