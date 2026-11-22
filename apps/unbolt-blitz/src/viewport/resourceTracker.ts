/** Anything with a `dispose()` method: geometries, materials, textures, render targets, controls. */
export interface Disposable {
  dispose(): void;
}

/**
 * Remembers GPU-side resources and disposes each one exactly once (Req 9.9).
 * Tracking an item twice, or releasing it before `disposeAll`, never disposes it twice.
 */
export class ResourceTracker {
  private tracked = new Set<Disposable>();
  private readonly disposed = new WeakSet<Disposable>();

  /** Tracks `item` and returns it. Items that were already disposed are ignored. */
  track<T extends Disposable>(item: T): T {
    if (!this.disposed.has(item)) this.tracked.add(item);
    return item;
  }

  /** Disposes `item` now if it is still tracked. Returns true when it was disposed by this call. */
  release(item: Disposable): boolean {
    if (!this.tracked.has(item)) return false;
    this.tracked.delete(item);
    this.disposed.add(item);
    item.dispose();
    return true;
  }

  /** Number of items that are tracked and not yet disposed. */
  get size(): number {
    return this.tracked.size;
  }

  /** Disposes everything still tracked, in tracking order. */
  disposeAll(): void {
    const pending = [...this.tracked];
    this.tracked = new Set<Disposable>();
    for (const item of pending) {
      this.disposed.add(item);
      item.dispose();
    }
  }
}
