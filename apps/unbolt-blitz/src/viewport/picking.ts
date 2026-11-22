import { Raycaster, Vector2, Vector3 } from "three";
import type { Camera, Mesh } from "three";

/** Maximum pointer drift in CSS pixels for a press to count as a click. */
export const CLICK_MAX_DRIFT_PX = 5;

/** Maximum press duration in milliseconds for a press to count as a click. */
export const CLICK_MAX_DURATION_MS = 600;

export interface PointerSample {
  x: number;
  y: number;
  /** Timestamp in milliseconds. */
  t: number;
  /** `PointerEvent.button`: 0 is the primary button. */
  button: number;
}

/**
 * True exactly when both samples are the primary button, the pointer moved at
 * most 5 px, and at most 600 ms passed (Req 10.5). A drag that orbits the
 * camera is never a click.
 */
export function isClick(down: PointerSample, up: PointerSample): boolean {
  if (down.button !== 0 || up.button !== 0) return false;
  const drift = Math.hypot(up.x - down.x, up.y - down.y);
  const elapsed = up.t - down.t;
  return drift <= CLICK_MAX_DRIFT_PX && elapsed <= CLICK_MAX_DURATION_MS;
}

export interface PickHit {
  partId: string;
  mesh: Mesh;
  /** Distance along the ray to the nearest intersection. */
  distance: number;
  point: Vector3;
}

/**
 * Resolves rays to the nearest live part mesh with `Raycaster.intersectObjects`.
 * Brute-force triangle tests only: no BVH is built on the main thread (Req 10.6).
 * Removed parts are excluded (Req 10.7).
 */
export class Picker {
  private readonly raycaster = new Raycaster();
  private readonly meshes = new Map<string, Mesh>();
  private readonly partIdsByObjectId = new Map<number, string>();
  private liveList: Mesh[] = [];

  /** Adds a live part. Throws `RangeError` for an id that is already live. */
  add(partId: string, mesh: Mesh): void {
    if (this.meshes.has(partId)) {
      throw new RangeError(`Part "${partId}" is already pickable.`);
    }
    this.meshes.set(partId, mesh);
    this.partIdsByObjectId.set(mesh.id, partId);
    this.liveList = [...this.meshes.values()];
  }

  /** Removes a part from picking. Returns false when it was not live. */
  remove(partId: string): boolean {
    const mesh = this.meshes.get(partId);
    if (mesh === undefined) return false;
    this.meshes.delete(partId);
    this.partIdsByObjectId.delete(mesh.id);
    this.liveList = [...this.meshes.values()];
    return true;
  }

  has(partId: string): boolean {
    return this.meshes.has(partId);
  }

  clear(): void {
    this.meshes.clear();
    this.partIdsByObjectId.clear();
    this.liveList = [];
  }

  /** Ids of the pickable parts, in insertion order. */
  livePartIds(): string[] {
    return [...this.meshes.keys()];
  }

  get size(): number {
    return this.meshes.size;
  }

  /** Nearest live part hit by the ray, or null. `direction` need not be normalized. */
  pickRay(origin: Vector3, direction: Vector3): PickHit | null {
    this.raycaster.set(origin, direction.clone().normalize());
    return this.firstHit();
  }

  /** Nearest live part under a pointer given in normalized device coordinates. */
  pickNdc(ndc: Vector2, camera: Camera): PickHit | null {
    this.raycaster.setFromCamera(ndc, camera);
    return this.firstHit();
  }

  private firstHit(): PickHit | null {
    if (this.liveList.length === 0) return null;
    // `intersectObjects` returns hits sorted by ascending distance.
    const hits = this.raycaster.intersectObjects(this.liveList, false);
    for (const hit of hits) {
      const partId = this.partIdsByObjectId.get(hit.object.id);
      if (partId === undefined) continue;
      return { partId, mesh: hit.object as Mesh, distance: hit.distance, point: hit.point };
    }
    return null;
  }
}
