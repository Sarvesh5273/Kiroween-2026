/**
 * Recursively freezes plain objects and arrays so a test can detect mutation
 * (a write to a frozen object throws in strict mode, which ES modules use).
 *
 * Typed arrays and other ArrayBuffer views cannot be frozen when non-empty,
 * so they are left as they are. Already-frozen objects are not revisited,
 * which also makes shared references and cycles safe.
 */
export function deepFreeze<T>(value: T): T {
  freezeInto(value);
  return value;
}

function freezeInto(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  if (Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    const child = (value as Record<PropertyKey, unknown>)[key];
    freezeInto(child);
  }
}
