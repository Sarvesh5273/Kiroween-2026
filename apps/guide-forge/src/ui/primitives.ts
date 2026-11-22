/**
 * CSS modifier for a motion-primitive badge (`gf-prim`). The same mapping colours the Step rows in
 * the manifest and the step caption, so a primitive looks the same everywhere: helical teal,
 * linear slate, any other primitive indigo.
 */
export function primitiveClass(primitive: string): string {
  if (primitive === "helical_unscrew") return "gf-prim--helical";
  if (primitive === "linear_slide") return "gf-prim--slide";
  return "gf-prim--other";
}
