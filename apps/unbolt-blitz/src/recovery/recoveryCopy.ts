import type { RecoveryCause } from "./recoveryCause";

export type { RecoveryCause } from "./recoveryCause";

/** Text shown on a Recovery_Screen. */
export interface RecoveryCopy {
  title: string;
  body: string;
}

/** Accepted upload extensions, named in the unsupported-extension copy. */
export const ACCEPTED_EXTENSIONS: readonly string[] = [".glb", ".gltf"];

function formatCount(count: number): string {
  return Number.isFinite(count) ? Math.round(count).toLocaleString("en-US") : String(count);
}

/**
 * Pure mapping from a recovery cause to its title and body.
 * A monolithic cause always yields the single-solid-piece copy, whatever the triangle count.
 */
export function recoveryCopyFor(cause: RecoveryCause): RecoveryCopy {
  switch (cause.reason) {
    case "monolithic":
      return {
        title: "Single solid piece",
        body:
          "This file is a single solid piece, so it cannot be taken apart. " +
          `It has ${formatCount(cause.totalTriangles)} triangles in one connected shape. ` +
          "Load an assembly made of several separate parts to play.",
      };
    case "no-geometry":
      return {
        title: "No playable geometry",
        body: `This file holds no playable geometry. ${cause.detail}`.trimEnd(),
      };
    case "unsupported-extension":
      return {
        title: "Unsupported file type",
        body:
          `"${cause.fileName}" is not a supported file. ` +
          `Unbolt Blitz accepts ${ACCEPTED_EXTENSIONS.join(" and ")} files.`,
      };
    case "unexpected":
      return {
        title: "Something jammed the gears",
        body: `An unexpected error stopped the level from loading: ${cause.message}`,
      };
  }
}
