/** Why a Recovery_Screen is shown. Type-only, so the reducer can depend on it before the recovery UI exists. */
export type RecoveryCause =
  /** A single connected island, for any triangle count (including above 150,000). */
  | { reason: "monolithic"; totalTriangles: number }
  /** Empty, unparseable, or invalid geometry. */
  | { reason: "no-geometry"; detail: string }
  | { reason: "unsupported-extension"; fileName: string }
  | { reason: "unexpected"; message: string };
