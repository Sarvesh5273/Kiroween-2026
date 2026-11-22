/**
 * Mesh naming (Req 22.7, 23.8). A name is a role word of at least 3 lowercase letters, optional
 * `_word` / `-word` parts, and an optional `_<index>` suffix, 1 to 64 characters in total.
 */

export const MESH_NAME_PATTERN = /^(?=.{1,64}$)[a-z]{3,}(?:[_-][a-z]+)*(?:_\d+)?$/;

/** `role_index`, for example `clock_gear_2`. Indices are 1-based by kit convention. */
export function indexedName(role: string, index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`mesh index must be a non-negative integer, received ${index}`);
  }
  return checkedName(`${role}_${index}`);
}

/** Returns `name` after checking it against {@link MESH_NAME_PATTERN}. */
export function checkedName(name: string): string {
  if (!MESH_NAME_PATTERN.test(name)) {
    throw new RangeError(`mesh name "${name}" does not match ${String(MESH_NAME_PATTERN)}`);
  }
  return name;
}

/**
 * Guards uniqueness of node names within one Kit_Builder call. `claim` returns the name, so a
 * builder can write `mesh.name = names.claim(indexedName("lid_fastener", 1))`.
 */
export class NameRegistry {
  private readonly used = new Set<string>();

  claim(name: string): string {
    checkedName(name);
    if (this.used.has(name)) {
      throw new RangeError(`mesh name "${name}" is used twice in one kit`);
    }
    this.used.add(name);
    return name;
  }
}
