/**
 * The Arena: an imperative Three.js scene that shows the assembly, handles
 * hover and click picking, and plays exit animations and feedback effects
 * (Req 9.1 to 9.10, 10.1 to 10.7, 11.1 to 11.8, 12.1 to 12.3).
 *
 * `ArenaView.tsx` creates one Arena per canvas and calls `dispose()` on cleanup.
 * `arenaBridge.ts` maps `GameEvent`s onto the public methods `loadParts`,
 * `removePart`, `blockPart` and `showInterlock`. The Arena itself never reads
 * the game state and holds no animation lock: `onPartClick` fires for every
 * click on a live part, whatever animations are running (Req 11.6).
 *
 * Main thread only: picking uses the plain `Raycaster` through `Picker`, and no
 * BVH is built here (Req 10.6).
 */
import {
  Color,
  Group,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import type { DirectionalLight, Mesh, MeshPhysicalMaterial } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TrajectoryStep, Vec3 } from "@unboltkit/core";
import type { Aabb } from "../game/blitzEngine";
import type { PartRenderData } from "../protocol";
import { ARENA_CONFIG } from "./arenaConfig";
import {
  applyArenaEnvironment,
  createArenaEnvironment,
  createStudioBackdrop,
  createStudioLights,
  fitKeyShadow,
} from "./environment";
import { EffectsSystem } from "./effects";
import { ExitAnimator } from "./exitAnimations";
import { frameBounds } from "./framing";
import { GhostPreview } from "./ghostPreview";
import { HighlightManager } from "./highlights";
import { currentMotionPolicy, motionPolicy, REDUCED_MOTION_QUERY } from "./motion";
import type { MotionPolicy } from "./motion";
import { buildPartMeshes } from "./partMeshes";
import type { PartMeshSet } from "./partMeshes";
import { createPedestal, lowestAabbY, pedestalLayout, pedestalShadowFocus, releasePedestal } from "./pedestal";
import { isClick, Picker } from "./picking";
import type { PointerSample } from "./picking";
import { ResourceTracker } from "./resourceTracker";
import { WebglUnavailableError } from "./WebglUnavailableError";

/** Direction from the orbit target to the initial camera position (upper front-right). */
const INITIAL_VIEW_DIRECTION = new Vector3(0.55, 0.45, 1).normalize();

/** Closest and farthest orbit distance, as multiples of the framed radius and distance. */
const MIN_DISTANCE_RADIUS_FACTOR = 0.6;
const MAX_DISTANCE_FACTOR = 4;
/** Rendered frames between `loadParts` and `onPartsShown`. */
const SHOWN_AFTER_FRAMES = 2;

export interface ArenaOptions {
  canvas: HTMLCanvasElement;
  /**
   * A click on a live part. `atMs` is on the same clock as `now()` (by default
   * `performance.now()`) and is meant for `PART_CLICKED.at`.
   */
  onPartClick: (partId: string, atMs: number) => void;
  /** The hovered part changed, or the pointer moved over the hovered part. Null id: nothing hovered. */
  onHover?: ((partId: string | null, clientX: number, clientY: number) => void) | undefined;
  /**
   * Called once after the meshes of a `loadParts` call have been drawn and the frame that follows
   * has been scheduled by the browser, so first-use shader compilation is over and the parts are
   * on screen. The stopwatch starts here, never on solve or build time.
   */
  onPartsShown?: ((epoch: number) => void) | undefined;
  /** Called when the render loop throws. Without it the error is rethrown from the frame callback. */
  onError?: ((error: unknown) => void) | undefined;
  /** Millisecond clock. Defaults to `performance.now()`. */
  now?: (() => number) | undefined;
}

export class Arena {
  private readonly canvas: HTMLCanvasElement;
  private readonly options: ArenaOptions;
  private readonly now: () => number;
  private readonly tracker = new ResourceTracker();
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly partsGroup = new Group();
  private readonly picker = new Picker();
  private readonly animator = new ExitAnimator();
  private readonly effects: EffectsSystem;
  private readonly highlights: HighlightManager;
  private readonly ghost: GhostPreview;
  private readonly resizeObserver: ResizeObserver;
  private readonly ndc = new Vector2();

  private keyLight: DirectionalLight | null = null;
  private pedestal: Group | null = null;
  private meshSet: PartMeshSet | null = null;
  private partData = new Map<string, PartRenderData>();
  /** Parts that were removed and are still flying out. They are not live. */
  private readonly exiting = new Set<string>();
  private bounds: Aabb | null = null;
  private currentEpoch = -1;
  private pendingShownEpoch: number | null = null;
  /** Frames still to render before `pendingShownEpoch` is reported. */
  private framesUntilShown = 0;

  private policy: MotionPolicy;
  private motionQuery: MediaQueryList | null = null;

  private rafId: number | null = null;
  private disposed = false;
  private userMoved = false;

  private down: PointerSample | null = null;
  private downPointerId: number | null = null;
  private pointer: { x: number; y: number } | null = null;
  private hoveredPartId: string | null = null;
  private hoverDirty = false;
  private hoverMoved = false;

  /**
   * Creates the renderer and starts the render loop.
   * Throws `WebglUnavailableError` when the canvas cannot create a WebGL context (Req 9.10).
   */
  constructor(options: ArenaOptions) {
    this.options = options;
    this.canvas = options.canvas;
    this.now = options.now ?? (() => performance.now());
    this.policy = currentMotionPolicy();

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true });
    } catch (cause) {
      throw new WebglUnavailableError(
        cause instanceof Error
          ? `WebGL is required to render the Arena but could not be created: ${cause.message}`
          : undefined,
      );
    }
    this.renderer = renderer;

    try {
      renderer.toneMapping = ARENA_CONFIG.toneMapping;
      renderer.outputColorSpace = ARENA_CONFIG.outputColorSpace;
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, ARENA_CONFIG.maxPixelRatio));
      renderer.shadowMap.enabled = ARENA_CONFIG.shadowsEnabled;
      renderer.shadowMap.type = ARENA_CONFIG.shadowMapType;

      // Warm-charcoal to obsidian studio vignette. Without a canvas the flat obsidian color stays.
      const backdrop = createStudioBackdrop();
      this.scene.background = backdrop !== null ? this.tracker.track(backdrop) : new Color(ARENA_CONFIG.backgroundColor);
      const environment = createArenaEnvironment(renderer);
      for (const item of environment.disposables) this.tracker.track(item);
      applyArenaEnvironment(this.scene, environment);

      const lights = createStudioLights();
      this.keyLight = lights.key;
      this.scene.add(...lights.all, lights.key.target);
      this.scene.add(this.partsGroup);

      this.camera = new PerspectiveCamera(ARENA_CONFIG.cameraFovDeg, 1, 0.01, 100);
      this.camera.position.copy(INITIAL_VIEW_DIRECTION).multiplyScalar(3);

      this.controls = new OrbitControls(this.camera, this.canvas);
      this.controls.enableDamping = ARENA_CONFIG.enableDamping;
      this.controls.dampingFactor = ARENA_CONFIG.dampingFactor;
      this.controls.addEventListener("start", this.onControlsStart);
      this.controls.addEventListener("change", this.onControlsChange);
      this.tracker.track(this.controls);

      this.effects = new EffectsSystem(this.scene, this.tracker, this.policy.reduced);
      this.highlights = new HighlightManager(this.resolveMaterial, this.policy.reduced);
      this.ghost = new GhostPreview(this.scene, this.tracker, this.policy.reduced);

      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerup", this.onPointerUp);
      this.canvas.addEventListener("pointercancel", this.onPointerCancel);
      this.canvas.addEventListener("pointerleave", this.onPointerLeave);

      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.canvas);

      if (typeof globalThis.matchMedia === "function") {
        this.motionQuery = globalThis.matchMedia(REDUCED_MOTION_QUERY);
        this.motionQuery.addEventListener("change", this.onMotionPreferenceChange);
      }

      this.applySize();
      this.rafId = requestAnimationFrame(this.tick);
    } catch (error) {
      this.releaseEverything();
      throw error;
    }
  }

  /** Epoch passed to the last `loadParts` call, or -1 before the first one. */
  get epoch(): number {
    return this.currentEpoch;
  }

  /** Ids of the parts that can still be hovered and clicked. */
  livePartIds(): string[] {
    return this.picker.livePartIds();
  }

  // -------------------------------------------------------------------------
  // Level content
  // -------------------------------------------------------------------------

  /**
   * Replaces the shown assembly: disposes the old meshes, builds one mesh per
   * part, places the pedestal below the lowest point and frames the camera
   * (Req 9.7, 9.8). `onPartsShown(epoch)` fires after the first frame that
   * renders the new meshes.
   * Throws `RangeError` for no parts or a duplicate part id.
   */
  loadParts(parts: readonly PartRenderData[], epoch: number): void {
    this.assertNotDisposed();
    if (parts.length === 0) {
      throw new RangeError("Arena.loadParts needs at least one part.");
    }
    this.clearParts();

    const meshSet = buildPartMeshes(parts, this.tracker);
    this.meshSet = meshSet;
    this.partData = new Map(parts.map((part) => [part.partId, part]));
    for (const part of parts) {
      const mesh = meshSet.byPartId.get(part.partId) as Mesh;
      this.partsGroup.add(mesh);
      this.picker.add(part.partId, mesh);
    }

    this.bounds = unionAabb(parts.map((part) => part.aabb));
    const lowestY = lowestAabbY(parts.map((part) => part.aabb));
    this.pedestal = createPedestal(lowestY, this.tracker);
    this.scene.add(this.pedestal);
    if (this.keyLight !== null) {
      const focus = pedestalShadowFocus(this.bounds, pedestalLayout(lowestY).topY);
      fitKeyShadow(this.keyLight, focus.center, focus.radius);
    }

    this.currentEpoch = epoch;
    this.userMoved = false;
    this.frame();
    this.hoverDirty = true;
    this.pendingShownEpoch = epoch;
    this.framesUntilShown = SHOWN_AFTER_FRAMES;
  }
  /**
   * Removes every mesh, the pedestal, highlights and effects of the current level, and cancels a
   * pending `onPartsShown`. Called as soon as a new level is requested, so the previous kit never
   * lingers behind the loading plate. Safe to call with nothing loaded.
   */
  clear(): void {
    this.assertNotDisposed();
    this.clearParts();
    this.bounds = null;
    this.currentEpoch = -1;
  }

  /**
   * Starts the exit animation of a legal unbolt (Req 11.1, 11.4, 11.7, 11.8).
   * The part leaves the picker and loses its highlights at once, so a flying
   * part can be neither hovered nor clicked. The mesh is disposed when the
   * animation reaches t = 1. `startMs` is the `at` of the `part_removed` event.
   * Throws `RangeError` for a part that is not live.
   */
  removePart(partId: string, step: TrajectoryStep, startMs: number): void {
    this.assertNotDisposed();
    const mesh = this.liveMesh(partId);
    const data = this.partData.get(partId) as PartRenderData;

    this.ghost.clear();
    this.picker.remove(partId);
    this.exiting.add(partId);
    this.highlights.clearPart(partId);
    this.effects.cancelShudder(partId);
    if (this.hoveredPartId === partId) {
      this.hoveredPartId = null;
      this.notifyHover(null);
    }

    this.animator.start({
      partId,
      mesh,
      step,
      startMs,
      durationMs: this.policy.exitDurationMs,
    });
    this.effects.unboltBurst(data.obb.center, startMs);
    this.hoverDirty = true;
  }

  /**
   * Feedback for a Blocked_Attempt: crimson shudder and clash spark on the
   * clicked part, amber-to-crimson flash on each blocker (Req 12.1, 12.2, 12.3).
   * Throws `RangeError` when the clicked part is not live. Blockers that are
   * not live are skipped.
   */
  blockPart(partId: string, blockerIds: readonly string[], nowMs: number): void {
    this.assertNotDisposed();
    const mesh = this.liveMesh(partId);
    const data = this.partData.get(partId) as PartRenderData;
    this.effects.startShudder(partId, mesh, nowMs);
    this.effects.clashSpark(data.obb.center, nowMs);
    for (const blockerId of blockerIds) {
      if (this.isLive(blockerId)) this.highlights.flashBlocker(blockerId, nowMs);
    }
  }

  /** Pulsing crimson-amber highlight on every live part of the deadlock witness (Req 14.3). */
  showInterlock(partIds: readonly string[]): void {
    this.assertNotDisposed();
    this.highlights.setInterlock(partIds.filter((id) => this.isLive(id)));
  }

  /**
   * Hint: a pulsing translucent teal ghost of the part, moved `distance` along `dir`, and an arrow
   * along `dir`. It disappears after 2.5 s, or earlier on an unbolt, a level change or `dispose()`.
   * Under reduced motion the ghost holds a steady opacity.
   * Throws `RangeError` when the part is not live or `dir` has no length.
   */
  showGhostHint(partId: string, dir: Vec3, distance: number, firstMove = false): void {
    this.assertNotDisposed();
    const mesh = this.liveMesh(partId);
    const data = this.partData.get(partId) as PartRenderData;
    // The opening Lockbox screw head is exposed at the top of its bounds. Its OBB
    // center is inside the lid and would direct a player to click the lid itself.
    const origin: Vec3 = firstMove
      ? [data.obb.center[0], data.aabb.max[1], data.obb.center[2]]
      : data.obb.center;
    this.ghost.show(mesh.geometry, origin, dir, distance, this.now(), firstMove);
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  /**
   * Stops the loop and releases every geometry, material, texture, the PMREM
   * render target and generator, the RoomEnvironment, the controls and the
   * renderer (Req 9.9). Safe to call more than once.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseEverything();
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  private readonly tick = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.tick);
    try {
      this.renderFrame(this.now());
    } catch (error) {
      this.stopLoop();
      if (this.options.onError !== undefined) {
        this.options.onError(error);
      } else {
        throw error;
      }
    }
  };

  private renderFrame(nowMs: number): void {
    this.controls.update();
    const { finished } = this.animator.update(nowMs);
    for (const partId of finished) this.finishExit(partId);
    this.effects.update(nowMs);
    this.highlights.update(nowMs);
    this.ghost.update(nowMs);
    this.renderer.render(this.scene, this.camera);
    this.updateHover();
    if (this.pendingShownEpoch !== null) {
      // The first frame after `loadParts` pays for shader compilation and upload, which can stall
      // the main thread for seconds on a large kit. Report the parts as shown one frame later, so
      // the level clock never includes that cost.
      this.framesUntilShown -= 1;
      if (this.framesUntilShown <= 0) {
        const epoch = this.pendingShownEpoch;
        this.pendingShownEpoch = null;
        this.options.onPartsShown?.(epoch);
      }
    }
  }

  /** Removes a finished flyer from the scene and releases its resources (Req 11.3). */
  private finishExit(partId: string): void {
    this.exiting.delete(partId);
    const mesh = this.meshSet?.byPartId.get(partId);
    if (mesh === undefined) return;
    this.partsGroup.remove(mesh);
    this.tracker.release(mesh.geometry);
    this.tracker.release(mesh.material as MeshPhysicalMaterial);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // -------------------------------------------------------------------------
  // Framing and size
  // -------------------------------------------------------------------------

  private readonly onResize = (): void => {
    if (this.disposed) return;
    this.applySize();
    if (this.bounds !== null && !this.userMoved) this.frame();
    this.hoverDirty = true;
  };

  private applySize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Places the camera so the whole assembly is visible (Req 9.8). */
  private frame(): void {
    if (this.bounds === null) return;
    const result = frameBounds(
      this.bounds,
      ARENA_CONFIG.cameraFovDeg,
      this.camera.aspect,
      ARENA_CONFIG.framingMargin,
    );
    const center = new Vector3(result.center[0], result.center[1], result.center[2]);
    this.camera.position.copy(center).addScaledVector(INITIAL_VIEW_DIRECTION, result.distance);
    this.camera.near = result.near;
    this.camera.far = result.far;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = result.radius * MIN_DISTANCE_RADIUS_FACTOR;
    this.controls.maxDistance = result.distance * MAX_DISTANCE_FACTOR;
    this.controls.update();
  }

  private readonly onControlsStart = (): void => {
    this.userMoved = true;
  };

  private readonly onControlsChange = (): void => {
    this.hoverDirty = true;
  };

  // -------------------------------------------------------------------------
  // Pointer handling
  // -------------------------------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    this.down = { x: event.clientX, y: event.clientY, t: this.now(), button: event.button };
    this.downPointerId = event.pointerId;
    this.pointer = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    this.hoverDirty = true;
    this.hoverMoved = true;
  };

  /** A press counts as a click only through `isClick`. A drag orbits and dispatches nothing (Req 10.5). */
  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!event.isPrimary || this.down === null || event.pointerId !== this.downPointerId) return;
    const down = this.down;
    this.down = null;
    this.downPointerId = null;
    this.pointer = { x: event.clientX, y: event.clientY };
    this.hoverDirty = true;
    const up: PointerSample = { x: event.clientX, y: event.clientY, t: this.now(), button: event.button };
    if (!isClick(down, up)) return;
    const hit = this.pickAt(event.clientX, event.clientY);
    if (hit !== null) this.options.onPartClick(hit, up.t);
  };

  private readonly onPointerCancel = (): void => {
    this.down = null;
    this.downPointerId = null;
    this.hoverDirty = true;
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    this.pointer = null;
    this.hoverDirty = true;
    if (this.hoveredPartId !== null) {
      this.hoveredPartId = null;
      this.highlights.setHover(null);
      this.options.onHover?.(null, event.clientX, event.clientY);
    }
  };

  /** Nearest live part under a client position, or null. */
  private pickAt(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    return this.picker.pickNdc(this.ndc, this.camera)?.partId ?? null;
  }

  /**
   * One raycast at the last pointer position when something changed since the
   * last check: pointer move, camera move, a part removed, or a new level.
   * Skipped while a button is held, because that is an orbit drag or a click in progress.
   */
  private updateHover(): void {
    if (!this.hoverDirty || this.down !== null) return;
    this.hoverDirty = false;
    const moved = this.hoverMoved;
    this.hoverMoved = false;
    const pointer = this.pointer;
    const id = pointer === null ? null : this.pickAt(pointer.x, pointer.y);
    if (id !== this.hoveredPartId) {
      this.hoveredPartId = id;
      this.highlights.setHover(id);
      this.notifyHover(id);
    } else if (id !== null && moved) {
      this.notifyHover(id);
    }
  }

  private notifyHover(partId: string | null): void {
    const pointer = this.pointer;
    this.options.onHover?.(partId, pointer?.x ?? 0, pointer?.y ?? 0);
  }

  // -------------------------------------------------------------------------
  // Motion preference
  // -------------------------------------------------------------------------

  private readonly onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    this.policy = motionPolicy(event.matches);
    this.effects.setReducedMotion(this.policy.reduced);
    this.highlights.setReducedMotion(this.policy.reduced);
    this.ghost.setReducedMotion(this.policy.reduced);
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private readonly resolveMaterial = (partId: string): MeshPhysicalMaterial | undefined => {
    if (this.exiting.has(partId)) return undefined;
    return this.meshSet?.byPartId.get(partId)?.material as MeshPhysicalMaterial | undefined;
  };

  private isLive(partId: string): boolean {
    return this.picker.has(partId);
  }

  private liveMesh(partId: string): Mesh {
    const mesh = this.picker.has(partId) ? this.meshSet?.byPartId.get(partId) : undefined;
    if (mesh === undefined) {
      throw new RangeError(`Part "${partId}" is not live in the Arena.`);
    }
    return mesh;
  }

  /** Drops every mesh, animation, effect target and highlight of the current level. */
  private clearParts(): void {
    this.animator.clear();
    this.exiting.clear();
    this.ghost.clear();
    this.highlights.clearAll();
    if (this.meshSet !== null) {
      for (const [partId, mesh] of this.meshSet.byPartId) {
        this.effects.cancelShudder(partId);
        this.partsGroup.remove(mesh);
        this.tracker.release(mesh.geometry);
        this.tracker.release(mesh.material as MeshPhysicalMaterial);
      }
    }
    this.picker.clear();
    this.meshSet = null;
    this.partData = new Map();
    if (this.pedestal !== null) {
      this.scene.remove(this.pedestal);
      releasePedestal(this.pedestal, this.tracker);
      this.pedestal = null;
    }
    if (this.hoveredPartId !== null) {
      this.hoveredPartId = null;
      this.notifyHover(null);
    }
    this.pendingShownEpoch = null;
    this.framesUntilShown = 0;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("The Arena has been disposed.");
    }
  }

  /** Shared by `dispose()` and a failed constructor. Safe on a partly built Arena. */
  private releaseEverything(): void {
    this.disposed = true;
    this.stopLoop();
    this.resizeObserver?.disconnect();
    this.motionQuery?.removeEventListener("change", this.onMotionPreferenceChange);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.controls?.removeEventListener("start", this.onControlsStart);
    this.controls?.removeEventListener("change", this.onControlsChange);
    this.animator.clear();
    this.ghost?.clear();
    this.effects?.dispose();
    this.picker.clear();
    this.partsGroup.clear();
    // Geometries, materials, the PMREM target and generator, RoomEnvironment and controls.
    this.tracker.disposeAll();
    this.scene.environment = null;
    this.scene.background = null;
    this.renderer.dispose();
  }
}

/** Smallest box that contains every box. `boxes` must not be empty. */
function unionAabb(boxes: readonly { min: readonly number[]; max: readonly number[] }[]): Aabb {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i] as number, box.min[i] as number);
      max[i] = Math.max(max[i] as number, box.max[i] as number);
    }
  }
  return { min, max };
}
