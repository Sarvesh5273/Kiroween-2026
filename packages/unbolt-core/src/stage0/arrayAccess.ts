/**
 * Reads `array[index]` and throws when the index is out of range. Under `noUncheckedIndexedAccess`
 * a plain read is typed `number | undefined`, and an out-of-range read here is always a bug in
 * the caller, so it throws instead of returning `undefined`.
 */
export function at(array: ArrayLike<number>, index: number): number {
  const value = array[index];
  if (value === undefined) {
    throw new RangeError(`index ${index} is outside an array of length ${array.length}`);
  }
  return value;
}
