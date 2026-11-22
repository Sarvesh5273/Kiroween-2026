/**
 * Recovery cards and notices.
 *
 * Pure functions that map Core error values, worker failures, loader failures and the
 * oversize warning to plain data for the UI. No React, no DOM and no three import. Core
 * types come in through `import type` only.
 *
 * Every card and the notice carry the `load-sample-kit` and `open-file-picker` actions and
 * an icon, a heading and body text, so no state depends on colour or sound.
 */
import type {
  ConfigurationError,
  CoreError,
  InvalidGeometryError,
  MonolithicMeshError,
  NodePath,
  SamplingMetadata,
} from "@unboltkit/core";
import type { SolveFailure } from "../protocol";
import type { Notice, RecoveryAction, RecoveryCard } from "./types";

/** Kit loaded by the `load-sample-kit` action. */
export const SAMPLE_KIT_FALLBACK = "mechanical-keyboard-65";

/** Extensions the file picker and drop zone accept. */
export const ACCEPTED_EXTENSIONS = [".glb", ".gltf"] as const;

export type FileClass = "glb" | "gltf" | "unsupported";

function recoveryActions(): RecoveryAction[] {
  return [
    { id: "load-sample-kit", label: "Load sample kit" },
    { id: "open-file-picker", label: "Choose another file" },
  ];
}

/** Node path as text, for example `/` for the root and `/0/3` for child 0, then child 3. */
function formatPath(path: NodePath): string {
  return `/${path.join("/")}`;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** Case-insensitive extension check. Anything but `.glb` and `.gltf` is unsupported. */
export function classifyFile(fileName: string): FileClass {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".glb")) {
    return "glb";
  }
  if (lower.endsWith(".gltf")) {
    return "gltf";
  }
  return "unsupported";
}

const GEOMETRY_REASONS: Record<InvalidGeometryError["reason"], string> = {
  "non-finite": "contains NaN or infinite coordinates",
  malformed: "has missing or inconsistent buffers",
  "zero-extent": "has no size",
  "non-finite-scale": "is too small or too large to scale",
};

function monolithicCard(error: MonolithicMeshError): RecoveryCard {
  return {
    kind: "monolithic",
    icon: "island",
    heading: "This model is one connected island",
    body:
      `The model at ${formatPath(error.nodePath)} is a single connected island of ` +
      `${formatCount(error.totalTriangles)} triangles. No separate parts exist to disassemble. ` +
      "Load a model made of several separate parts, or try a sample kit.",
    details: [],
    actions: recoveryActions(),
  };
}

function invalidGeometryCard(error: InvalidGeometryError): RecoveryCard {
  return {
    kind: "invalid-geometry",
    icon: "geometry",
    heading: "The model geometry is not usable",
    body: `The model ${GEOMETRY_REASONS[error.reason]}. Fix the geometry in your modelling tool and export it again, or try a sample kit.`,
    details: error.nodePaths.map((path) => formatPath(path)),
    actions: recoveryActions(),
  };
}

function configurationCard(error: ConfigurationError): RecoveryCard {
  return {
    kind: "configuration",
    icon: "config",
    heading: "The solver configuration is invalid",
    body: error.message,
    details: [],
    actions: recoveryActions(),
  };
}

/** Maps a Core error value from `plan.error` to a Recovery_Card. */
export function buildRecoveryCard(error: CoreError): RecoveryCard {
  switch (error.kind) {
    case "MonolithicMeshError":
      return monolithicCard(error);
    case "EmptyAssemblyError":
      return buildEmptyAssemblyCard();
    case "InvalidGeometryError":
      return invalidGeometryCard(error);
    case "ConfigurationError":
      return configurationCard(error);
  }
}

/** Card for a failure message from the Solver_Worker, or from a worker error event. */
export function buildFailureCard(failure: SolveFailure): RecoveryCard {
  const details = [`Error: ${failure.name}`];
  if (failure.code !== null) {
    details.push(`Code: ${failure.code}`);
  }
  return {
    kind: "worker-failure",
    icon: "worker",
    heading: "The solver stopped with an error",
    body: failure.message.length > 0 ? failure.message : "The solver stopped without a message.",
    details,
    actions: recoveryActions(),
  };
}

/** Card for a `GLTFLoader` rejection. The loader message is shown as is. */
export function buildLoaderFailureCard(message: string): RecoveryCard {
  return {
    kind: "load-failure",
    icon: "file",
    heading: "The file could not be read",
    body:
      (message.length > 0 ? `The glTF loader reported: ${message}` : "The glTF loader gave no message.") +
      " Check that the file is a complete, uncompressed .glb or .gltf, or try a sample kit.",
    details: [],
    actions: recoveryActions(),
  };
}

/** Card for a file whose extension is neither `.glb` nor `.gltf`. */
export function buildUnsupportedFileCard(fileName: string): RecoveryCard {
  return {
    kind: "unsupported-extension",
    icon: "file",
    heading: "This file type is not supported",
    body:
      `"${fileName}" cannot be opened. Guide Forge accepts ${ACCEPTED_EXTENSIONS.join(" and ")} files. ` +
      "Choose one of those, or try a sample kit.",
    details: [],
    actions: recoveryActions(),
  };
}

/** Card for a file or scene that holds no triangles. */
export function buildEmptyAssemblyCard(): RecoveryCard {
  return {
    kind: "empty-assembly",
    icon: "empty",
    heading: "The file holds no triangles",
    body: "No mesh with triangles was found, so there is nothing to disassemble. Choose a model that contains solid parts, or try a sample kit.",
    details: [],
    actions: recoveryActions(),
  };
}

/** Warning for `sampling.polyBudgetExceeded`. Results stay visible while it is shown. */
export function buildPolyBudgetNotice(sampling: SamplingMetadata): Notice {
  return {
    kind: "poly-budget",
    icon: "warn",
    heading: "Large model: sampled solve",
    body:
      `The model has ${formatCount(sampling.totalTriangles)} triangles, above the budget of ` +
      `${formatCount(sampling.polyBudget)}. The solver samples triangles with a stride of ${formatCount(sampling.stride)}, ` +
      "so results are approximate. The plan below is still shown.",
    actions: recoveryActions(),
  };
}
